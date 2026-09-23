-- ===========================================================================
-- eventos — a agenda: reuniões, calls e follow-ups.
--
-- Aqui `owner_id` é quem agendou, e não é derivado do cliente. Um evento é um
-- compromisso de uma pessoa: se a carteira for transferida depois, o histórico
-- de quem esteve naquela reunião continua correto.
-- ===========================================================================

create table public.eventos (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null check (length(btrim(titulo)) > 0),
  tipo           public.tipo_evento not null default 'reuniao',
  status         public.status_evento not null default 'agendado',
  inicio         timestamptz not null,
  fim            timestamptz not null,
  cliente_id     uuid references public.clientes (id) on delete set null,
  negociacao_id  uuid references public.negociacoes (id) on delete set null,
  owner_id       uuid not null default auth.uid()
                   references public.profiles (id) on delete restrict,
  notas          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint eventos_intervalo_valido check (fim > inicio)
);

comment on column public.eventos.inicio is
  'timestamptz. A conversão para America/Sao_Paulo é feita na aplicação — '
  'guardar horário local no banco quebra qualquer relatório por período.';

create index eventos_owner_inicio_idx on public.eventos (owner_id, inicio);
create index eventos_cliente_idx      on public.eventos (cliente_id);
create index eventos_negociacao_idx   on public.eventos (negociacao_id);

create trigger eventos_set_updated_at
  before update on public.eventos
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS.
--
-- O WITH CHECK não valida apenas o dono do evento: valida também que o cliente
-- e a negociação vinculados sejam visíveis para quem está escrevendo. Sem isso
-- um closer poderia pendurar um compromisso no cliente de outra pessoa, já que
-- uma FK não exige permissão de leitura sobre o alvo.
-- ---------------------------------------------------------------------------
alter table public.eventos enable row level security;

create policy eventos_select on public.eventos
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

create policy eventos_insert on public.eventos
  for insert
  to authenticated
  with check (
    (
      owner_id = (select auth.uid())
      or public.is_gerente()
    )
    and (
      cliente_id is null
      or public.cliente_owner(cliente_id) = (select auth.uid())
      or public.is_gerente()
    )
    and (
      negociacao_id is null
      or public.negociacao_owner(negociacao_id) = (select auth.uid())
      or public.is_gerente()
    )
  );

create policy eventos_update on public.eventos
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    (
      owner_id = (select auth.uid())
      or public.is_gerente()
    )
    and (
      cliente_id is null
      or public.cliente_owner(cliente_id) = (select auth.uid())
      or public.is_gerente()
    )
    and (
      negociacao_id is null
      or public.negociacao_owner(negociacao_id) = (select auth.uid())
      or public.is_gerente()
    )
  );

create policy eventos_delete on public.eventos
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.eventos from anon;
grant select, insert, update, delete on table public.eventos to authenticated;
