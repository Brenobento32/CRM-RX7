-- ===========================================================================
-- negociacoes — o card do Kanban. Uma oportunidade dentro de um cliente.
--
-- `owner_id` é derivado do cliente por trigger, nunca informado pela
-- aplicação. Isso fecha um furo real: um closer poderia inserir uma negociação
-- apontando para o cliente de outra pessoa (uma FK não exige permissão de
-- leitura no alvo). Com o owner derivado, a linha resultante pertence ao outro
-- closer e o WITH CHECK da policy rejeita a escrita.
-- ===========================================================================

create table public.negociacoes (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references public.clientes (id) on delete cascade,
  owner_id            uuid not null references public.profiles (id) on delete restrict,
  titulo              text,
  etapa               public.etapa_funil not null default 'reuniao_agendada',
  valor_estimado      numeric(14, 2) check (valor_estimado is null or valor_estimado >= 0),
  posicao             numeric not null default 1000,
  data_entrada_etapa  timestamptz not null default now(),
  motivo_perda        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Espelho da regra de fechamento: sair para "perdido" exige justificativa.
  constraint negociacoes_perdido_exige_motivo check (
    etapa <> 'perdido'
    or (motivo_perda is not null and length(btrim(motivo_perda)) > 0)
  )
);

comment on column public.negociacoes.posicao is
  'Ordem do card dentro da coluna. numeric, e não integer, para que arrastar '
  'um card seja um UPDATE de uma linha só (ponto médio entre os vizinhos) em '
  'vez de reescrever a coluna inteira.';
comment on column public.negociacoes.owner_id is
  'Derivado de clientes.owner_id por trigger. Não escreva nesta coluna.';

create index negociacoes_owner_etapa_idx on public.negociacoes (owner_id, etapa);
create index negociacoes_cliente_idx     on public.negociacoes (cliente_id);
create index negociacoes_board_idx       on public.negociacoes (etapa, posicao);

create trigger negociacoes_set_updated_at
  before update on public.negociacoes
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- owner_id sempre igual ao dono do cliente.
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_sincroniza_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  v_owner := public.cliente_owner(new.cliente_id);

  if v_owner is null then
    raise exception 'Cliente % não encontrado.', new.cliente_id
      using errcode = '23503';
  end if;

  new.owner_id := v_owner;
  return new;
end;
$$;

create trigger negociacoes_owner_do_cliente
  before insert or update of cliente_id, owner_id on public.negociacoes
  for each row
  execute function public.negociacoes_sincroniza_owner();

-- Quando um gerente transfere a carteira, as negociações vão junto.
create or replace function public.clientes_propaga_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.negociacoes
       set owner_id = new.owner_id
     where cliente_id = new.id;
  end if;

  return null;
end;
$$;

create trigger clientes_propaga_owner
  after update of owner_id on public.clientes
  for each row
  execute function public.clientes_propaga_owner();

-- Registra quando o card entrou na etapa atual (tempo por etapa nos relatórios).
create or replace function public.negociacoes_marca_etapa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.etapa is distinct from old.etapa then
    new.data_entrada_etapa := now();
  end if;

  return new;
end;
$$;

create trigger negociacoes_marca_etapa
  before update of etapa on public.negociacoes
  for each row
  execute function public.negociacoes_marca_etapa();

-- Dono de uma negociação, sem passar pela RLS. Usada por fechamentos e eventos.
create or replace function public.negociacao_owner(p_negociacao_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select n.owner_id
  from public.negociacoes n
  where n.id = p_negociacao_id;
$$;

revoke all on function public.negociacao_owner(uuid) from public, anon;
grant execute on function public.negociacao_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Mover um card é um UPDATE em `etapa`, então a policy de UPDATE é exatamente
-- a regra "closer movimenta somente suas negociações".
-- ---------------------------------------------------------------------------
alter table public.negociacoes enable row level security;

create policy negociacoes_select on public.negociacoes
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

create policy negociacoes_insert on public.negociacoes
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

create policy negociacoes_update on public.negociacoes
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

create policy negociacoes_delete on public.negociacoes
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.negociacoes from anon;
grant select, insert, update, delete on table public.negociacoes to authenticated;
