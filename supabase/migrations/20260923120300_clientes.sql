-- ===========================================================================
-- clientes — cadastro. A etapa do funil NÃO mora aqui (ver negociacoes).
--
-- `owner_id` é a coluna que define a carteira: é ela que a RLS compara com
-- auth.uid() para decidir o que um closer enxerga.
-- ===========================================================================

create extension if not exists pg_trgm with schema extensions;

create table public.clientes (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (length(btrim(nome)) > 0),
  empresa      text,
  email        text,
  telefone     text,
  documento    text,
  origem       text,
  observacoes  text,
  owner_id     uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on column public.clientes.owner_id is
  'Closer dono da carteira. Base da RLS.';
comment on column public.clientes.deleted_at is
  'Soft delete. A RLS não filtra por esta coluna — quem filtra é a DAL, para '
  'que um gerente ainda consiga listar e restaurar o que foi excluído.';

create index clientes_owner_idx
  on public.clientes (owner_id)
  where deleted_at is null;

create index clientes_created_at_idx
  on public.clientes (created_at desc);

-- Busca por nome/empresa na tela de clientes, sem varrer a tabela inteira.
create index clientes_busca_idx
  on public.clientes
  using gin ((coalesce(nome, '') || ' ' || coalesce(empresa, '')) extensions.gin_trgm_ops);

create trigger clientes_set_updated_at
  before update on public.clientes
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Quem é o dono de um cliente, sem passar pela RLS.
--
-- Usada nas policies de negociacoes, eventos e atividades. Se essas policies
-- fizessem um subselect direto em `clientes`, a RLS de clientes seria aplicada
-- dentro do subselect e a regra ficaria difícil de auditar.
-- ---------------------------------------------------------------------------
create or replace function public.cliente_owner(p_cliente_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.owner_id
  from public.clientes c
  where c.id = p_cliente_id;
$$;

revoke all on function public.cliente_owner(uuid) from public, anon;
grant execute on function public.cliente_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Gerente: acesso total. Closer: apenas as linhas em que é o owner.
--
-- O WITH CHECK do UPDATE impede que um closer "dê" um cliente seu para outra
-- pessoa alterando owner_id — a linha resultante precisa continuar sendo dele.
-- Exclusão definitiva é só do gerente; o closer usa soft delete, que é UPDATE.
-- ---------------------------------------------------------------------------
alter table public.clientes enable row level security;

create policy clientes_select on public.clientes
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

create policy clientes_insert on public.clientes
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

create policy clientes_update on public.clientes
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

create policy clientes_delete on public.clientes
  for delete
  to authenticated
  using (public.is_gerente());

revoke all on table public.clientes from anon;
grant select, insert, update, delete on table public.clientes to authenticated;
