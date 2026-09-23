-- ===========================================================================
-- Fase 5A — atividades comerciais e próxima ação.
--
-- 1. `atividades` ganha `data` (quando aconteceu, que pode ser antes do
--    registro) e `owner_id` passa a se chamar `usuario_id`: aqui a coluna é
--    o autor, não o dono da carteira como em clientes/negociacoes.
-- 2. `proximas_acoes`: o follow-up combinado com o cliente. Fica fora de
--    `clientes`, que guarda só cadastro.
-- 3. Coerência cliente ↔ negociação nas duas tabelas.
-- 4. `nomes_de_usuarios`: nome dos usuários para a timeline.
-- 5. `funil_cards` passa a mostrar última atividade e próxima ação.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Atividades.
--
-- RENAME COLUMN atualiza sozinho as policies que citam a coluna.
-- ---------------------------------------------------------------------------
alter table public.atividades rename column owner_id to usuario_id;
alter index public.atividades_owner_idx rename to atividades_usuario_idx;

comment on column public.atividades.usuario_id is
  'Autor do registro. A visibilidade, porém, é herdada do cliente.';

alter table public.atividades
  add column data timestamptz not null default now();

-- Registros anteriores: a melhor estimativa de quando aconteceram é quando
-- foram registrados.
update public.atividades set data = created_at;

comment on column public.atividades.data is
  'Quando a atividade aconteceu. Pode ser anterior a created_at (registro tardio).';

drop index if exists public.atividades_cliente_idx;
create index atividades_cliente_data_idx
  on public.atividades (cliente_id, data desc);

-- ---------------------------------------------------------------------------
-- 2. Próximas ações.
--
-- Visibilidade segue o cliente, como em atividades: o gerente agenda um
-- follow-up no cliente de um closer e o closer precisa vê-lo e concluí-lo.
-- ---------------------------------------------------------------------------
create table public.proximas_acoes (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes (id) on delete cascade,
  negociacao_id  uuid references public.negociacoes (id) on delete set null,
  titulo         text not null check (length(btrim(titulo)) > 0),
  data           date not null,
  observacao     text,
  usuario_id     uuid not null default auth.uid()
                   references public.profiles (id) on delete restrict,
  concluida_em   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.proximas_acoes is
  'Follow-ups combinados com o cliente. Pendente = concluida_em nulo.';
comment on column public.proximas_acoes.data is
  'Dia combinado (sem hora). Horário marcado é compromisso de agenda.';

create index proximas_acoes_pendentes_idx
  on public.proximas_acoes (cliente_id, data)
  where concluida_em is null;
create index proximas_acoes_negociacao_idx
  on public.proximas_acoes (negociacao_id)
  where concluida_em is null;

create trigger proximas_acoes_set_updated_at
  before update on public.proximas_acoes
  for each row
  execute function public.set_updated_at();

alter table public.proximas_acoes enable row level security;

create policy proximas_acoes_select on public.proximas_acoes
  for select
  to authenticated
  using (
    public.cliente_owner(cliente_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy proximas_acoes_insert on public.proximas_acoes
  for insert
  to authenticated
  with check (
    usuario_id = (select auth.uid())
    and (
      public.cliente_owner(cliente_id) = (select auth.uid())
      or public.is_gerente()
    )
  );

create policy proximas_acoes_update on public.proximas_acoes
  for update
  to authenticated
  using (
    public.cliente_owner(cliente_id) = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    public.cliente_owner(cliente_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy proximas_acoes_delete on public.proximas_acoes
  for delete
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.proximas_acoes from anon;
grant select, insert, update, delete on table public.proximas_acoes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A negociação vinculada precisa ser do mesmo cliente.
--
-- As policies checam que o usuário pode ver a negociação, mas não que ela é
-- do cliente do registro — sem isto, uma atividade do cliente A poderia
-- apontar para a negociação do cliente B.
-- ---------------------------------------------------------------------------
create or replace function public.valida_negociacao_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.negociacao_id is not null
     and not exists (
       select 1
       from public.negociacoes n
       where n.id = new.negociacao_id
         and n.cliente_id = new.cliente_id
     )
  then
    raise exception 'A negociação % não pertence ao cliente %.',
      new.negociacao_id, new.cliente_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger atividades_negociacao_do_cliente
  before insert or update of cliente_id, negociacao_id on public.atividades
  for each row
  execute function public.valida_negociacao_do_cliente();

create trigger proximas_acoes_negociacao_do_cliente
  before insert or update of cliente_id, negociacao_id on public.proximas_acoes
  for each row
  execute function public.valida_negociacao_do_cliente();

-- ---------------------------------------------------------------------------
-- 4. Nome dos usuários.
--
-- A RLS de profiles deixa um closer ler só o próprio perfil. Na timeline ele
-- precisa ver o nome de quem registrou (o gerente, por exemplo). A função é
-- SECURITY DEFINER de propósito e devolve apenas id e nome dos ids pedidos —
-- nada de e-mail, papel ou status.
-- ---------------------------------------------------------------------------
create or replace function public.nomes_de_usuarios(p_ids uuid[])
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nome
  from public.profiles p
  where p.id = any (p_ids);
$$;

comment on function public.nomes_de_usuarios is
  'Nome de exibição dos usuários informados. Ignora a RLS de profiles de propósito.';

revoke all on function public.nomes_de_usuarios from public, anon;
grant execute on function public.nomes_de_usuarios to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cards do funil.
--
-- Colunas mudam de nome e tipo, então a view é recriada.
--
-- Próxima ação: a pendente mais próxima da negociação, ou do cliente quando
-- não estiver ligada a nenhuma negociação. Eventos de agenda agendados também
-- contam (pelo dia, em São Paulo), para quando a Agenda existir.
-- Última atividade: a atividade mais recente do cliente, de qualquer tipo.
-- ---------------------------------------------------------------------------
drop view public.funil_cards;

create view public.funil_cards
with (security_invoker = true)
as
select
  n.id,
  n.etapa,
  n.posicao,
  n.valor_estimado,
  n.temperatura,
  n.data_entrada_etapa,
  n.owner_id,
  p.nome            as responsavel_nome,
  c.id              as cliente_id,
  c.nome            as cliente_nome,
  c.empresa         as cliente_empresa,
  pa.titulo         as proxima_acao_titulo,
  pa.data           as proxima_acao_data,
  ua.tipo           as ultima_atividade_tipo,
  ua.data           as ultima_atividade_data,
  ua.descricao      as ultima_atividade_descricao
from public.negociacoes n
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
left join lateral (
  select x.titulo, x.data
  from (
    select a.titulo, a.data
    from public.proximas_acoes a
    where a.concluida_em is null
      and (
        a.negociacao_id = n.id
        or (a.negociacao_id is null and a.cliente_id = n.cliente_id)
      )
    union all
    select e.titulo, (e.inicio at time zone 'America/Sao_Paulo')::date
    from public.eventos e
    where e.status = 'agendado'
      and e.inicio >= now()
      and (
        e.negociacao_id = n.id
        or (e.negociacao_id is null and e.cliente_id = n.cliente_id)
      )
  ) x
  order by x.data
  limit 1
) pa on true
left join lateral (
  select a.tipo, a.data, a.descricao
  from public.atividades a
  where a.cliente_id = n.cliente_id
  order by a.data desc
  limit 1
) ua on true;

comment on view public.funil_cards is
  'Um card do Kanban por negociação. security_invoker: respeita a RLS.';

revoke all on public.funil_cards from anon;
grant select on public.funil_cards to authenticated;
