-- ===========================================================================
-- RPC `realizado_periodo` — corrige o cálculo de metas (geral e individual)
-- em `/funil/metricas`.
--
-- ACHADO (auditoria pedida pelo usuário: "Metas está calculando errado
-- tanto individual quanto geral"):
--
-- `app/(app)/funil/metricas/page.tsx` monta o cartão "Financeiro do
-- período" com:
--   - `metaPeriodo` = `obterMetaPeriodo()` — CORRETO: meta (mensal, por
--     natureza do schema) proporcionada ao período, SEM filtro de funil
--     (todas as metas do alvo, em qualquer mês tocado pelo período).
--   - `realizado` = `obterRealizadoFunil(periodo, funilSelecionado.id)` —
--     ERRADO para esta finalidade: filtra `negociacoes.funil_id =
--     funilSelecionado.id`. O percentual mostrado ("Atingido: X%") dividia
--     um realizado de UM funil pela meta de TODOS os funis — mudava só de
--     trocar o funil selecionado na tela, sem a venda ter mudado.
--
-- `obterRealizadoFunil` continua existindo e correta para o que ELA
-- representa (vendido NESTE funil, ticket médio NESTE funil — métricas
-- "daquele funil", que o pedido desta rodada explicitamente mantém válidas
-- por funil). O que faltava era uma segunda fonte, SEM filtro de funil,
-- pro card de meta geral/individual.
--
-- Por que uma RPC nova (SECURITY DEFINER) em vez de um SELECT direto como
-- `obterRealizadoFunil` faz: a RLS de `fechamentos` segue o dono ATUAL da
-- negociação (`pode_ver_etapa`) — depois de uma transferência de carteira,
-- o responsável original pela venda deixaria de enxergar o próprio
-- fechamento histórico num SELECT comum (mesmo problema que `metas_
-- progresso`, 20260924120000, já resolve com SECURITY DEFINER + atribuição
-- explícita por `fechamentos.responsavel_id`). Esta RPC usa exatamente o
-- mesmo padrão: GERENTE vê a linha da empresa + todas as pessoas; closer
-- só a própria linha — e a MESMA regra de atribuição (`responsavel_id`,
-- nunca `owner_id`), para o resultado nunca divergir do `/metas`.
--
-- Diferença da `metas_progresso` existente (intocada, usada por `/metas`):
-- esta aqui recebe um PERÍODO arbitrário (p_inicio/p_fim), não um mês
-- inteiro, e devolve só o REALIZADO (sem colunas de meta) — a meta
-- proporcional ao período já é calculada certa por `metaProporcionalPeriodo`
-- (`lib/utils/financeiro-periodo.ts`, auditada e com testes já existentes)
-- a partir das metas mensais (`obterMetaPeriodo`). As duas se combinam na
-- camada TypeScript (`lib/dal/metas.ts#obterRealizadoGeral`).
--
-- NÃO cria meta por funil (schema `metas` intocado). NÃO filtra por funil
-- em lugar nenhum desta função — "todos os funis" é a ausência de qualquer
-- `funil_id` no JOIN/WHERE abaixo.
-- ===========================================================================

create or replace function public.realizado_periodo(p_inicio date, p_fim date)
returns table (
  usuario_id     uuid,
  nome           text,
  role           public.user_role,
  ativo          boolean,
  realizado_tcv  numeric,
  realizado_mrr  numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  vendas as (
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    where f.data_fechamento >= p_inicio
      and f.data_fechamento <= p_fim
      and f.tipo_venda is not null
    group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select usuario_id, valor from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select usuario_id, valor from vendas where tipo_venda = 'mrr')
  select
    null::uuid,
    null::text,
    null::public.user_role,
    null::boolean,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  where public.is_gerente()

  union all

  select
    p.id,
    p.nome,
    p.role,
    p.ativo,
    coalesce(vt.valor, 0),
    coalesce(vm.valor, 0)
  from public.profiles p
  left join vendas_tcv vt on vt.usuario_id = p.id
  left join vendas_mrr vm on vm.usuario_id = p.id
  where (public.is_gerente() or p.id = (select auth.uid()))
    and (
      (p.role = 'closer' and p.ativo)
      or vt.valor is not null
      or vm.valor is not null
    );
$$;

comment on function public.realizado_periodo is
  'Realizado (TCV/MRR) de um período arbitrário, SEM filtro de funil — '
  'todos os funis, atribuído por fechamentos.responsavel_id (nunca owner_id '
  'atual da negociação), só fechamentos.tipo_venda classificado. Mesmo '
  'padrão de autorização de metas_progresso (SECURITY DEFINER: GERENTE vê '
  'a empresa + a equipe inteira; closer só a própria linha). Usada junto '
  'com a meta proporcional ao período (obterMetaPeriodo) para corrigir o '
  'cartão de meta geral/individual em /funil/metricas, que antes comparava '
  'esse realizado de todos os funis com... um realizado de UM funil só.';

revoke all on function public.realizado_periodo(date, date) from public, anon;
grant execute on function public.realizado_periodo(date, date) to authenticated;
