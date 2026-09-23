-- ===========================================================================
-- Qualificação da negociação.
--
-- Dados comerciais que pertencem à oportunidade, não ao cadastro do cliente:
-- temperatura, datas-chave do ciclo e a objeção principal.
--
-- `valor_estimado numeric(14,2)` já existe desde a migration original de
-- negociacoes (com check >= 0) e por isso não é recriado aqui.
-- ===========================================================================

create type public.temperatura_negociacao as enum (
  'quente',
  'morno',
  'frio'
);

alter table public.negociacoes
  add column temperatura            public.temperatura_negociacao,
  add column data_primeira_reuniao  date,
  add column data_proposta          date,
  add column objecao_principal      text;

comment on column public.negociacoes.temperatura is
  'Percepção do closer sobre a chance de fechamento. Nulo = ainda não avaliada.';
comment on column public.negociacoes.data_primeira_reuniao is
  'Data (sem hora) da primeira reunião com o cliente nesta negociação.';
comment on column public.negociacoes.data_proposta is
  'Data (sem hora) em que a proposta foi enviada.';

alter table public.negociacoes
  -- Proposta não pode ser anterior à primeira reunião.
  add constraint negociacoes_datas_ordem
    check (
      data_proposta is null
      or data_primeira_reuniao is null
      or data_proposta >= data_primeira_reuniao
    ),
  -- Objeção vazia vira NULL na aplicação; string só de espaços não é objeção.
  add constraint negociacoes_objecao_preenchida
    check (objecao_principal is null or length(btrim(objecao_principal)) > 0);

-- Filtro por temperatura no funil e nos relatórios.
create index negociacoes_temperatura_idx
  on public.negociacoes (temperatura)
  where temperatura is not null;
