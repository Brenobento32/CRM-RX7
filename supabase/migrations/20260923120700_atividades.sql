-- ===========================================================================
-- atividades — a timeline da ficha do cliente: notas, ligações, e-mails.
--
-- A visibilidade aqui segue o CLIENTE, não o autor. Se um gerente registra uma
-- observação no cliente de um closer, o closer precisa ler aquilo — é o ponto
-- da timeline. Por isso a policy de SELECT usa cliente_owner(), e não owner_id.
-- ===========================================================================

create table public.atividades (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes (id) on delete cascade,
  negociacao_id  uuid references public.negociacoes (id) on delete set null,
  tipo           public.tipo_atividade not null default 'nota',
  descricao      text not null check (length(btrim(descricao)) > 0),
  owner_id       uuid not null default auth.uid()
                   references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now()
);

comment on table public.atividades is
  'Append-only por convenção: sem policy de UPDATE. Corrigir o passado de uma '
  'timeline comercial apaga o rastro de quem falou o quê e quando.';
comment on column public.atividades.owner_id is
  'Autor do registro. A visibilidade, porém, é herdada do cliente.';

create index atividades_cliente_idx    on public.atividades (cliente_id, created_at desc);
create index atividades_negociacao_idx on public.atividades (negociacao_id);
create index atividades_owner_idx      on public.atividades (owner_id);

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Não há policy de UPDATE: uma atividade registrada não se edita. Corrigir é
-- apagar (autor ou gerente) e registrar de novo.
-- ---------------------------------------------------------------------------
alter table public.atividades enable row level security;

create policy atividades_select on public.atividades
  for select
  to authenticated
  using (
    public.cliente_owner(cliente_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy atividades_insert on public.atividades
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      public.cliente_owner(cliente_id) = (select auth.uid())
      or public.is_gerente()
    )
    and (
      negociacao_id is null
      or public.negociacao_owner(negociacao_id) = (select auth.uid())
      or public.is_gerente()
    )
  );

create policy atividades_delete on public.atividades
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.atividades from anon;
grant select, insert, delete on table public.atividades to authenticated;
