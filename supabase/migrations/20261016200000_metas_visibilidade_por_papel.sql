-- ===========================================================================
-- Visibilidade de metas por papel — SDR não pode ver desempenho individual
-- de CLOSER; CLOSER não pode ver o de outros CLOSERs; todo mundo pode ver
-- o agregado geral da empresa.
--
-- REGRA DEFINITIVA DESTA RODADA (não é sobre matemática — essa já foi
-- corrigida e fica intocada: geral = todos os funis; individual = todos os
-- funis + responsavel_id; TCV/MRR separados; período correto):
--   GERENTE: geral + individual de cada CLOSER (equipe completa).
--   SDR:     só o geral (nunca uma linha individual, nem a própria — SDR
--            estruturalmente nunca tem meta/venda própria, mas o gate
--            agora impede isso explicitamente, não só por acaso).
--   CLOSER:  geral + a PRÓPRIA linha individual, nunca de outro CLOSER.
--
-- ACHADO (auditoria pedida): `metas_progresso` e `realizado_periodo` já
-- restringiam corretamente as linhas INDIVIDUAIS (closer só a própria,
-- nunca a de outro) — mas a linha da EMPRESA (geral, usuario_id null, SEM
-- nenhum PII) estava atrás de `where public.is_gerente()` nas duas, o que
-- excluía SDR e CLOSER do geral inteiro — o oposto do que o produto pede
-- agora ("SDR pode ver META GERAL"). Corrigido abrindo a linha da empresa
-- pra qualquer autenticado (ela não tem nome nem valor de ninguém —
-- usuario_id/nome/role/ativo vêm null nessa linha, só os totais agregados).
--
-- A mesma lógica se aplica à tabela `metas`: a RLS (`metas_select`) só
-- deixava LER a meta da empresa (usuario_id is null) se o chamador fosse
-- gerente — `obterMetaPeriodo` (usada por /funil/metricas) nunca
-- conseguiria mostrar "Meta: R$ X" da empresa pra SDR/CLOSER, só
-- "Meta: Não definida" por falta de acesso de leitura. Estendida pra
-- qualquer autenticado ler a meta DA EMPRESA (ainda sem nenhum PII — é só
-- um número-alvo da empresa); meta INDIVIDUAL de outra pessoa continua
-- bloqueada (só o próprio dono ou gerente).
--
-- NÃO toca a matemática de nenhuma das duas funções (as CTEs `vendas`/
-- `vendas_tcv`/`vendas_mrr`, os JOINs, os filtros de data/tipo_venda — tudo
-- byte a byte igual) — só as condições de AUTORIZAÇÃO (WHERE de quem
-- recebe qual linha). NÃO toca `funil_metricas`, `criar_negociacao`,
-- atividades, observações, WhatsApp, origem, fechamento.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. metas_select — meta da empresa (usuario_id is null) passa a ser
-- legível por qualquer autenticado. Meta individual de outra pessoa
-- continua exigindo ser o próprio dono ou gerente — inalterado.
-- ---------------------------------------------------------------------------
drop policy if exists metas_select on public.metas;
create policy metas_select on public.metas
  for select
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or usuario_id is null
    or public.is_gerente()
  );

-- ---------------------------------------------------------------------------
-- 2. metas_progresso — mesma matemática de 20261014150000, só o WHERE de
-- autorização muda: linha da empresa sempre presente; linha por pessoa só
-- pra gerente (todas) ou pro próprio CLOSER (nunca SDR, nem a si mesmo).
-- ---------------------------------------------------------------------------
create or replace function public.metas_progresso(p_mes date)
returns table (
  meta_id_tcv     uuid,
  meta_id_mrr     uuid,
  usuario_id      uuid,
  nome            text,
  role            public.user_role,
  ativo           boolean,
  valor_meta_tcv  numeric,
  realizado_tcv   numeric,
  valor_meta_mrr  numeric,
  realizado_mrr   numeric
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
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join mes
    where f.data_fechamento >= mes.inicio
      and f.data_fechamento <  (mes.inicio + interval '1 month')::date
      and f.tipo_venda is not null
    group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select usuario_id, valor from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select usuario_id, valor from vendas where tipo_venda = 'mrr')
  select
    mt.id,
    mm.id,
    null::uuid,
    null::text,
    null::public.user_role,
    null::boolean,
    mt.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    mm.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  from mes
  left join public.metas mt
    on mt.usuario_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.usuario_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  -- Linha da empresa: sempre presente (geral, sem PII) — antes só pra gerente.

  union all

  select
    mt.id,
    mm.id,
    p.id,
    p.nome,
    p.role,
    p.ativo,
    mt.valor_meta,
    coalesce(vt.valor, 0),
    mm.valor_meta,
    coalesce(vm.valor, 0)
  from public.profiles p
  cross join mes
  left join public.metas mt
    on mt.usuario_id = p.id and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.usuario_id = p.id and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  left join vendas_tcv vt on vt.usuario_id = p.id
  left join vendas_mrr vm on vm.usuario_id = p.id
  where (
      public.is_gerente()
      or (p.id = (select auth.uid()) and p.role = 'closer')
    )
    and (
      (p.role = 'closer' and p.ativo)
      or mt.id is not null
      or mm.id is not null
      or vt.valor is not null
      or vm.valor is not null
    );
$$;

comment on function public.metas_progresso is
  'Meta x realizado do mês, TCV e MRR separados (empresa e por pessoa). '
  'Realizado só soma fechamentos.tipo_venda classificado. SECURITY DEFINER: '
  'a linha da empresa (geral, sem PII) é visível pra qualquer autenticado; '
  'a linha por pessoa é GERENTE (todas) ou o próprio CLOSER (nunca SDR, '
  'nem a si mesmo — SDR nunca tem meta/venda própria, e agora também não '
  'recebe a linha mesmo se tivesse).';

-- ---------------------------------------------------------------------------
-- 3. realizado_periodo — mesma mudança de autorização, mesma matemática.
-- ---------------------------------------------------------------------------
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
  -- Linha da empresa: sempre presente (geral, sem PII) — antes só pra gerente.

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
  where (
      public.is_gerente()
      or (p.id = (select auth.uid()) and p.role = 'closer')
    )
    and (
      (p.role = 'closer' and p.ativo)
      or vt.valor is not null
      or vm.valor is not null
    );
$$;

comment on function public.realizado_periodo is
  'Realizado (TCV/MRR) de um período arbitrário, SEM filtro de funil — '
  'todos os funis, atribuído por fechamentos.responsavel_id (nunca owner_id '
  'atual da negociação), só fechamentos.tipo_venda classificado. SECURITY '
  'DEFINER: a linha da empresa (geral, sem PII) é visível pra qualquer '
  'autenticado; a linha por pessoa é GERENTE (todas) ou o próprio CLOSER '
  '(nunca SDR, nem a si mesmo).';

revoke all on function public.realizado_periodo(date, date) from public, anon;
grant execute on function public.realizado_periodo(date, date) to authenticated;
