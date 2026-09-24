-- ===========================================================================
-- Fase 10 — Metas comerciais.
--
-- Uma meta por mês: da empresa (usuario_id nulo) ou de um closer.
-- Gerente cria, edita e remove; closer só lê a própria.
--
-- O realizado de cada pessoa é atribuído ao RESPONSÁVEL COMERCIAL da venda:
-- o dono da negociação no momento do fechamento (`fechamentos.responsavel_id`).
--   * não é quem clicou: gerente que fecha a venda de um closer credita o
--     closer (`fechado_por` continua guardando o gerente, para auditoria);
--   * não é o dono atual: transferir uma carteira depois não reescreve o
--     resultado de meses passados.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Responsável comercial do fechamento.
-- ---------------------------------------------------------------------------
alter table public.fechamentos
  add column responsavel_id uuid references public.profiles (id) on delete restrict;

comment on column public.fechamentos.responsavel_id is
  'Dono da negociação no momento do fechamento: a quem a venda conta na meta. '
  'Definido por trigger, nunca pela aplicação. fechado_por é quem executou.';
comment on column public.fechamentos.fechado_por is
  'Quem executou o fechamento (auditoria). Não é usado para atribuir metas.';

-- Fechamentos anteriores: não há histórico de dono, então a melhor estimativa
-- é o dono atual da negociação.
update public.fechamentos f
   set responsavel_id = n.owner_id
  from public.negociacoes n
 where n.id = f.negociacao_id;

alter table public.fechamentos
  alter column responsavel_id set not null;

create index fechamentos_responsavel_data_idx
  on public.fechamentos (responsavel_id, data_fechamento);

-- Ao fechar, fixa o dono da negociação naquele instante. Depois disso a
-- coluna só muda num NOVO fechamento — `fechar_negociacao` sempre renova
-- `fechado_em` —; qualquer outra edição mantém o responsável original, e uma
-- transferência de carteira (que só mexe em negociacoes) não chega aqui.
create or replace function public.fechamentos_define_responsavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.fechado_em is distinct from old.fechado_em then
    new.responsavel_id := public.negociacao_owner(new.negociacao_id);
  else
    new.responsavel_id := old.responsavel_id;
  end if;

  return new;
end;
$$;

create trigger fechamentos_define_responsavel
  before insert or update on public.fechamentos
  for each row
  execute function public.fechamentos_define_responsavel();

-- ---------------------------------------------------------------------------
-- 2. Metas.
-- ---------------------------------------------------------------------------
create table public.metas (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid references public.profiles (id) on delete restrict,
  periodo_mes  date not null,
  valor_meta   numeric(14, 2) not null check (valor_meta > 0),
  criado_por   uuid not null default auth.uid()
                 references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- O mês é guardado como o dia 1: "2026-09-01" = setembro/2026.
  constraint metas_periodo_primeiro_dia check (extract(day from periodo_mes) = 1),

  -- Uma meta por alvo por mês. NULLS NOT DISTINCT faz a meta da empresa
  -- também ser única — sem isso, dois NULL contariam como diferentes.
  constraint metas_uma_por_mes unique nulls not distinct (usuario_id, periodo_mes)
);

comment on table public.metas is
  'Metas mensais de venda. usuario_id nulo = meta da empresa.';
comment on column public.metas.periodo_mes is
  'Primeiro dia do mês da meta (AAAA-MM-01).';

create index metas_periodo_idx on public.metas (periodo_mes);

create trigger metas_set_updated_at
  before update on public.metas
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Regras que a RLS não expressa:
--  * meta individual só para closer. Checado ao criar: se a pessoa mudar de
--    papel depois, a meta antiga continua no histórico;
--  * editar é mudar o valor. Alvo, mês e autor não mudam.
-- ---------------------------------------------------------------------------
create or replace function public.metas_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.usuario_id is not null and not exists (
      select 1
      from public.profiles p
      where p.id = new.usuario_id
        and p.role = 'closer'
    ) then
      raise exception 'Metas individuais são apenas para closers.'
        using errcode = '23514';
    end if;
  elsif new.usuario_id is distinct from old.usuario_id
     or new.periodo_mes <> old.periodo_mes
     or new.criado_por <> old.criado_por
  then
    raise exception 'Só o valor de uma meta pode ser alterado.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger metas_regras
  before insert or update on public.metas
  for each row
  execute function public.metas_regras();

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table public.metas enable row level security;

create policy metas_select on public.metas
  for select
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or public.is_gerente()
  );

create policy metas_insert on public.metas
  for insert
  to authenticated
  with check (public.is_gerente());

create policy metas_update on public.metas
  for update
  to authenticated
  using (public.is_gerente())
  with check (public.is_gerente());

create policy metas_delete on public.metas
  for delete
  to authenticated
  using (public.is_gerente());

revoke all on table public.metas from anon;
grant select, insert, update, delete on table public.metas to authenticated;

-- ---------------------------------------------------------------------------
-- Progresso do mês.
--
-- SECURITY DEFINER, com a autorização explícita no WHERE. Motivo: a RLS de
-- fechamentos segue o dono ATUAL da negociação. Depois de uma transferência
-- de carteira, o responsável pela venda deixa de enxergar o fechamento — e,
-- como INVOKER, perderia a venda da própria meta. Aqui:
--   gerente → linha da empresa + uma por pessoa;
--   closer  → só a própria linha.
-- Nenhuma coluna do fechamento sai daqui, só a soma.
--
-- Venda: mesma regra do dashboard (negociação na etapa ganha,
-- data_fechamento no mês). O total da empresa bate com o "Vendido" do
-- dashboard no mesmo mês; por pessoa pode divergir, porque o dashboard
-- atribui ao dono atual da carteira.
--
-- Linhas por pessoa: closers ativos, mais qualquer um com meta ou venda no
-- mês (closer desativado, gerente com carteira própria). Assim a soma das linhas
-- é o realizado da empresa.
-- ---------------------------------------------------------------------------
create or replace function public.metas_progresso(p_mes date)
returns table (
  meta_id     uuid,
  usuario_id  uuid,
  nome        text,
  role        public.user_role,
  ativo       boolean,
  valor_meta  numeric,
  realizado   numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  mes as (
    select date_trunc('month', p_mes)::date as inicio
  ),
  vendas as (
    select f.responsavel_id as usuario_id, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join mes
    where f.data_fechamento >= mes.inicio
      and f.data_fechamento <  (mes.inicio + interval '1 month')::date
    group by f.responsavel_id
  )
  select
    m.id,
    null::uuid,
    null::text,
    null::public.user_role,
    null::boolean,
    m.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas v)
  from mes
  left join public.metas m
    on m.usuario_id is null
   and m.periodo_mes = mes.inicio
  where public.is_gerente()

  union all

  select
    m.id,
    p.id,
    p.nome,
    p.role,
    p.ativo,
    m.valor_meta,
    coalesce(v.valor, 0)
  from public.profiles p
  cross join mes
  left join public.metas m
    on m.usuario_id = p.id
   and m.periodo_mes = mes.inicio
  left join vendas v on v.usuario_id = p.id
  where (public.is_gerente() or p.id = (select auth.uid()))
    and (
      (p.role = 'closer' and p.ativo)
      or m.id is not null
      or v.valor is not null
    );
$$;

comment on function public.metas_progresso is
  'Meta x realizado do mês (empresa e por pessoa). Realizado por fechamentos.responsavel_id. '
  'SECURITY DEFINER com autorização explícita: closer recebe só a própria linha.';

revoke all on function public.metas_progresso from public, anon;
grant execute on function public.metas_progresso to authenticated;
