-- ===========================================================================
-- Fase 11A — Serviços e propostas.
--
-- 1. `servicos`: catálogo configurável pelo gerente (sem preço), com
--    categoria opcional para organização futura.
-- 2. `negociacao_servicos`: quais serviços cada negociação envolve.
-- 3. Proposta na negociação: valor e forma de pagamento (opcionais).
-- 4. `salvar_negociacao`: a tela de edição grava qualificação, proposta e
--    serviços numa transação só.
--
-- Nada existente muda de comportamento: colunas novas são opcionais e as
-- views/funções atuais listam colunas explicitamente.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Serviços.
-- ---------------------------------------------------------------------------
create table public.servicos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null
                constraint servicos_nome_preenchido
                check (length(btrim(nome)) between 1 and 80),
  categoria   text
                constraint servicos_categoria_preenchida
                check (categoria is null or length(btrim(categoria)) between 1 and 60),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.servicos is
  'Catálogo de serviços vendidos. Sem preço: o valor é da proposta. '
  'Usado em negociação não é excluído, é desativado.';
comment on column public.servicos.categoria is
  'Agrupamento livre e opcional (ex.: "Assessoria"). Vazio vira NULL na aplicação.';

-- "Landing Page" e "landing page " são o mesmo serviço.
create unique index servicos_nome_unico on public.servicos (lower(btrim(nome)));

create trigger servicos_set_updated_at
  before update on public.servicos
  for each row
  execute function public.set_updated_at();

alter table public.servicos enable row level security;

-- Todos leem: o closer escolhe serviços nas próprias negociações.
create policy servicos_select on public.servicos
  for select
  to authenticated
  using (true);

create policy servicos_insert on public.servicos
  for insert
  to authenticated
  with check (public.is_gerente());

create policy servicos_update on public.servicos
  for update
  to authenticated
  using (public.is_gerente())
  with check (public.is_gerente());

-- Só funciona para serviço nunca usado: a FK de negociacao_servicos é
-- RESTRICT. Usado, o caminho é desativar.
create policy servicos_delete on public.servicos
  for delete
  to authenticated
  using (public.is_gerente());

revoke all on table public.servicos from anon;
grant select, insert, update, delete on table public.servicos to authenticated;

insert into public.servicos (nome) values
  ('Assessoria Comercial 1 mês'),
  ('Assessoria Comercial 3 meses'),
  ('Assessoria Comercial 6 meses'),
  ('Treinamento e configuração de CRM'),
  ('Landing Page'),
  ('CRM + IA'),
  ('Social Mídia');

-- ---------------------------------------------------------------------------
-- 2. Serviços da negociação.
-- ---------------------------------------------------------------------------
create table public.negociacao_servicos (
  negociacao_id  uuid not null references public.negociacoes (id) on delete cascade,
  servico_id     uuid not null references public.servicos (id) on delete restrict,
  created_at     timestamptz not null default now(),
  primary key (negociacao_id, servico_id)
);

comment on table public.negociacao_servicos is
  'Serviços envolvidos em cada negociação. Visibilidade herdada da negociação.';

create index negociacao_servicos_servico_idx on public.negociacao_servicos (servico_id);

-- Serviço desativado não entra em negociação; vínculos antigos continuam.
create or replace function public.negociacao_servicos_exige_ativo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.servicos s
    where s.id = new.servico_id
      and s.ativo
  ) then
    raise exception 'Serviço desativado ou inexistente.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger negociacao_servicos_exige_ativo
  before insert on public.negociacao_servicos
  for each row
  execute function public.negociacao_servicos_exige_ativo();

-- RLS herdada da negociação. Sem UPDATE: o vínculo é só a chave.
alter table public.negociacao_servicos enable row level security;

create policy negociacao_servicos_select on public.negociacao_servicos
  for select
  to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy negociacao_servicos_insert on public.negociacao_servicos
  for insert
  to authenticated
  with check (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy negociacao_servicos_delete on public.negociacao_servicos
  for delete
  to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.negociacao_servicos from anon;
grant select, insert, delete on table public.negociacao_servicos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Proposta.
-- ---------------------------------------------------------------------------
create type public.forma_pagamento as enum (
  'avista',
  'boleto_3x',
  'cartao_12x'
);

alter table public.negociacoes
  add column valor_proposta numeric(14, 2)
    constraint negociacoes_valor_proposta_positivo
    check (valor_proposta is null or valor_proposta > 0),
  add column forma_pagamento public.forma_pagamento;

comment on column public.negociacoes.valor_proposta is
  'Valor da proposta enviada. Opcional. O pipeline continua usando valor_estimado.';
comment on column public.negociacoes.forma_pagamento is
  'Forma de pagamento proposta. Opcional.';

-- ---------------------------------------------------------------------------
-- 4. Salvar a negociação (tela de edição).
--
-- SECURITY INVOKER: a RLS vale para quem chama. Closer que tente salvar
-- negociação alheia não enxerga a linha (0 linhas no UPDATE) e recebe
-- "não encontrada". As constraints de negociacoes (ordem das datas, objeção
-- preenchida, valores) continuam valendo.
--
-- Serviços: o array é o conjunto final. Remove o que saiu e insere só o que
-- ainda não estava vinculado — assim um serviço desativado que já estava na
-- negociação pode continuar nela, mas não pode ser adicionado de novo.
-- Etapa, posição, dono e motivo de perda ficam de fora: mudam pelo Kanban.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_negociacao(
  p_negociacao_id          uuid,
  p_valor_estimado         numeric,
  p_temperatura            public.temperatura_negociacao,
  p_data_primeira_reuniao  date,
  p_data_proposta          date,
  p_objecao_principal      text,
  p_valor_proposta         numeric,
  p_forma_pagamento        public.forma_pagamento,
  p_servico_ids            uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.negociacoes
     set valor_estimado         = p_valor_estimado,
         temperatura            = p_temperatura,
         data_primeira_reuniao  = p_data_primeira_reuniao,
         data_proposta          = p_data_proposta,
         objecao_principal      = p_objecao_principal,
         valor_proposta         = p_valor_proposta,
         forma_pagamento        = p_forma_pagamento
   where id = p_negociacao_id;

  if not found then
    raise exception 'Negociação não encontrada.'
      using errcode = 'P0002';
  end if;

  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;
end;
$$;

comment on function public.salvar_negociacao is
  'Grava qualificação, proposta e serviços de uma negociação numa transação. SECURITY INVOKER.';

revoke all on function public.salvar_negociacao from public, anon;
grant execute on function public.salvar_negociacao to authenticated;
