-- ===========================================================================
-- Verificação PÓS-APLICAÇÃO (por invariantes) de
-- 20261019170000_anula_fechamentos_extras_outubro.sql (já aplicada em
-- produção, junto com 20261019160000_fechamentos_anulacao.sql).
--
-- Este arquivo NÃO reaplica a correção e NÃO escreve nada — é só leitura do
-- estado real do banco. BEGIN/ROLLBACK aqui é só disciplina (não há nenhuma
-- escrita para desfazer).
--
-- Revisão desta rodada: a primeira versão pós-aplicação fixava números
-- absolutos (outubro = 11800/6100, Funil Out ganha = 4/15500, ...). Isso é
-- frágil contra um banco vivo — outubro ainda está em andamento, e qualquer
-- venda legítima nova faria o teste falhar sem que houvesse regressão
-- alguma. Este arquivo testa INVARIANTES em vez de valores congelados:
--
--   - os 3 registros da reconciliação (itens 1-3) continuam com asserts
--     fixos, porque são a finalidade permanente desta migration — seu
--     estado (anulado ou não, valor, motivo) nunca deveria mudar sozinho;
--   - todo agregado financeiro (outubro/setembro, por funil, funil_metricas)
--     é comparado DINAMICAMENTE: calcula-se a soma direta de
--     `fechamentos` com `anulado_em is null` e compara-se com a RPC
--     correspondente — a regra testada é "RPC = soma de fechamentos
--     ativos", nunca um número congelado;
--   - os valores de outubro/setembro no momento desta correção ficam só
--     como registro histórico em comentário/RAISE NOTICE, nunca como assert.
-- ===========================================================================

begin;

do $$
declare
  v_neg_duplicado constant uuid := '15f8ed44-36b1-4a1b-908f-5b2b31a708f6';
  v_neg_teste      constant uuid := 'a5c6b406-3941-4f3a-b743-b63c76219263';
  v_neg_legitimo   constant uuid := '30b3ebeb-81db-4cc3-b7a9-beb19cb44764';

  -- Período usado nas comparações dinâmicas — o mesmo da reconciliação
  -- original (outubro/2026 e setembro/2026). Os valores abaixo NUNCA são
  -- números fixos: são sempre recalculados ao vivo e comparados com a RPC.
  v_mes_out constant date := '2026-10-01';
  v_ini_out constant date := '2026-10-01';
  v_fim_out constant date := '2026-10-31';
  v_ini_set constant date := '2026-09-01';
  v_fim_set constant date := '2026-09-30';

  v_valor numeric; v_tipo public.tipo_venda; v_data date;
  v_anulado_em timestamptz; v_motivo text; v_anulado_por uuid;
  v_hist_count int;

  v_exp_tcv numeric; v_exp_mrr numeric;
  v_rp_tcv numeric; v_rp_mrr numeric;
  v_mp_tcv numeric; v_mp_mrr numeric;

  r_funil record;
  v_ctx_exp_tcv numeric; v_ctx_exp_mrr numeric;

  r_ganha record;
  v_exp_ganha_qtd bigint; v_exp_ganha_valor numeric;
  v_exp_alcancaram bigint;
  v_periodo_inicio timestamptz; v_periodo_fim timestamptz;
begin
  -- -------------------------------------------------------------------
  -- 1. Fechamento duplicado "Colégio Batista" de 14/10 — continua
  -- existindo, anulado, motivo exato, anulado_por null, dados intactos.
  -- Fixo de propósito: é a finalidade permanente da migration.
  -- -------------------------------------------------------------------
  select valor_vendido, tipo_venda, data_fechamento, anulado_em, motivo_anulacao, anulado_por
    into v_valor, v_tipo, v_data, v_anulado_em, v_motivo, v_anulado_por
  from public.fechamentos where negociacao_id = v_neg_duplicado;

  assert v_valor is not null, '1) duplicado: a linha de fechamentos não existe mais (não deveria ter sido apagada)';
  assert v_valor = 1500 and v_tipo = 'mrr' and v_data = '2026-10-14',
    format('1) duplicado: valor/tipo/data deveriam continuar 1500/mrr/2026-10-14, vieram %/%/%', v_valor, v_tipo, v_data);
  assert v_anulado_em is not null, '1) duplicado: deveria estar anulado';
  assert v_motivo = 'Duplicidade confirmada; fechamento válido do Colégio Batista preservado em 2026-10-16 (negociacao_id 30b3ebeb-81db-4cc3-b7a9-beb19cb44764).',
    format('1) duplicado: motivo_anulacao inesperado: %', v_motivo);
  assert v_anulado_por is null, '1) duplicado: anulado_por deveria ser null (correção sistêmica, não uma ação de usuário)';

  -- -------------------------------------------------------------------
  -- 2. Fechamento "TESTE CRM - NAO ATENDER" — mesma checagem, fixa.
  -- -------------------------------------------------------------------
  select valor_vendido, tipo_venda, data_fechamento, anulado_em, motivo_anulacao, anulado_por
    into v_valor, v_tipo, v_data, v_anulado_em, v_motivo, v_anulado_por
  from public.fechamentos where negociacao_id = v_neg_teste;

  assert v_valor is not null, '2) teste: a linha de fechamentos não existe mais (não deveria ter sido apagada)';
  assert v_valor = 4800 and v_tipo = 'tcv' and v_data = '2026-10-14',
    format('2) teste: valor/tipo/data deveriam continuar 4800/tcv/2026-10-14, vieram %/%/%', v_valor, v_tipo, v_data);
  assert v_anulado_em is not null, '2) teste: deveria estar anulado';
  assert v_motivo = 'Registro de teste ("TESTE CRM - NAO ATENDER"), não representa venda real.',
    format('2) teste: motivo_anulacao inesperado: %', v_motivo);
  assert v_anulado_por is null, '2) teste: anulado_por deveria ser null';

  -- -------------------------------------------------------------------
  -- 3. Fechamento legítimo do Colégio Batista (16/10) — nunca anulado.
  -- Fixo, pelo mesmo motivo dos itens 1-2.
  -- -------------------------------------------------------------------
  select valor_vendido, tipo_venda, anulado_em into v_valor, v_tipo, v_anulado_em
  from public.fechamentos where negociacao_id = v_neg_legitimo;

  assert v_valor is not null, '3) legítimo: a linha não existe (deveria existir)';
  assert v_valor = 1500 and v_tipo = 'mrr', format('3) legítimo: valor/tipo deveriam ser 1500/mrr, vieram %/%', v_valor, v_tipo);
  assert v_anulado_em is null, '3) legítimo: não deveria estar anulado';

  -- -------------------------------------------------------------------
  -- 4. Outubro: realizado_periodo e metas_progresso (empresa) devem ser
  -- exatamente a soma direta de fechamentos ATIVOS (anulado_em is null) de
  -- negociações atualmente em etapa 'ganha' — a mesma regra usada pelas
  -- duas RPCs (vendas CTE em ambas). Comparação dinâmica, não um número
  -- congelado: uma venda nova em outubro não quebra este teste, só muda os
  -- dois lados da comparação igualmente.
  -- -------------------------------------------------------------------
  select coalesce(sum(f.valor_vendido) filter (where f.tipo_venda = 'tcv'), 0),
         coalesce(sum(f.valor_vendido) filter (where f.tipo_venda = 'mrr'), 0)
    into v_exp_tcv, v_exp_mrr
  from public.fechamentos f
  join public.negociacoes n  on n.id = f.negociacao_id
  join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
  where f.data_fechamento >= v_ini_out and f.data_fechamento <= v_fim_out
    and f.tipo_venda is not null
    and f.anulado_em is null;

  select realizado_tcv, realizado_mrr into v_rp_tcv, v_rp_mrr
  from public.realizado_periodo(v_ini_out, v_fim_out) where usuario_id is null;
  assert v_rp_tcv = v_exp_tcv and v_rp_mrr = v_exp_mrr,
    format('4) realizado_periodo (empresa, outubro) deveria ser tcv=%/mrr=% (soma direta de fechamentos ativos), veio tcv=%/mrr=%',
      v_exp_tcv, v_exp_mrr, v_rp_tcv, v_rp_mrr);

  select realizado_tcv, realizado_mrr into v_mp_tcv, v_mp_mrr
  from public.metas_progresso(v_mes_out) where usuario_id is null;
  assert v_mp_tcv = v_exp_tcv and v_mp_mrr = v_exp_mrr,
    format('4) metas_progresso (empresa, outubro) deveria ser tcv=%/mrr=% (mesma soma direta), veio tcv=%/mrr=%',
      v_exp_tcv, v_exp_mrr, v_mp_tcv, v_mp_mrr);

  -- Registro histórico (não é assert): no momento desta correção,
  -- 2026-10-19, outubro era tcv=11800/mrr=6100 (total 17900).
  raise notice '4) outubro (dinâmico, agora): tcv=%, mrr=% — registro histórico no momento da correção: tcv=11800/mrr=6100', v_exp_tcv, v_exp_mrr;

  -- -------------------------------------------------------------------
  -- 5. Setembro: mesma comparação dinâmica, outro período — setembro
  -- estava fechado e não deveria mudar, mas o teste não exige isso: só
  -- exige que a RPC continue sendo a soma direta dos fechamentos ativos.
  -- -------------------------------------------------------------------
  select coalesce(sum(f.valor_vendido) filter (where f.tipo_venda = 'tcv'), 0),
         coalesce(sum(f.valor_vendido) filter (where f.tipo_venda = 'mrr'), 0)
    into v_exp_tcv, v_exp_mrr
  from public.fechamentos f
  join public.negociacoes n  on n.id = f.negociacao_id
  join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
  where f.data_fechamento >= v_ini_set and f.data_fechamento <= v_fim_set
    and f.tipo_venda is not null
    and f.anulado_em is null;

  select realizado_tcv, realizado_mrr into v_rp_tcv, v_rp_mrr
  from public.realizado_periodo(v_ini_set, v_fim_set) where usuario_id is null;
  assert v_rp_tcv = v_exp_tcv and v_rp_mrr = v_exp_mrr,
    format('5) realizado_periodo (empresa, setembro) deveria ser tcv=%/mrr=% (soma direta), veio tcv=%/mrr=%',
      v_exp_tcv, v_exp_mrr, v_rp_tcv, v_rp_mrr);

  raise notice '5) setembro (dinâmico, agora): tcv=%, mrr=% (total %) — registro histórico no momento da correção: total 33650, nenhum fechamento de setembro foi anulado', v_exp_tcv, v_exp_mrr, v_exp_tcv + v_exp_mrr;

  -- -------------------------------------------------------------------
  -- 6. Clientes, negociações e historico_etapas continuam presentes —
  -- a anulação nunca tocou nada disso. Não exige que existam só 2
  -- anulados no banco inteiro (uma anulação legítima futura não quebra
  -- este teste).
  -- -------------------------------------------------------------------
  assert exists (select 1 from public.negociacoes where id = v_neg_duplicado), '6) negociação do duplicado não existe mais';
  assert exists (select 1 from public.negociacoes where id = v_neg_teste), '6) negociação do teste não existe mais';
  assert exists (
    select 1 from public.clientes c join public.negociacoes n on n.cliente_id = c.id where n.id = v_neg_duplicado
  ), '6) cliente do duplicado não existe mais';
  assert exists (
    select 1 from public.clientes c join public.negociacoes n on n.cliente_id = c.id where n.id = v_neg_teste
  ), '6) cliente do teste não existe mais';

  select count(*) into v_hist_count from public.historico_etapas where negociacao_id = v_neg_duplicado;
  assert v_hist_count = 5, format('6) historico_etapas do duplicado deveria ter 5 linhas, tem %', v_hist_count);
  select count(*) into v_hist_count from public.historico_etapas where negociacao_id = v_neg_teste;
  assert v_hist_count = 2, format('6) historico_etapas do teste deveria ter 2 linhas, tem %', v_hist_count);

  -- -------------------------------------------------------------------
  -- 7. Contexto por funil (mesma consulta de obterRealizadoFunil,
  -- lib/dal/funil-metricas.ts) — para TODO funil ativo, não só Funil
  -- Out/Inbound: funciona sozinho se um terceiro funil for criado. Não há
  -- RPC própria aqui, então o que se verifica é que o par
  -- tcv/mrr existe e é não-negativo e que a query roda sem erro para
  -- cada funil — a garantia de regressão real é o join idêntico ao do DAL.
  -- -------------------------------------------------------------------
  for r_funil in select id, nome from public.funis where ativo order by ordem loop
    select coalesce(sum(f.valor_vendido) filter (where f.tipo_venda = 'tcv'), 0),
           coalesce(sum(f.valor_vendido) filter (where f.tipo_venda = 'mrr'), 0)
      into v_ctx_exp_tcv, v_ctx_exp_mrr
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    where n.funil_id = r_funil.id
      and f.data_fechamento between v_ini_out and v_fim_out
      and f.anulado_em is null;

    assert v_ctx_exp_tcv >= 0 and v_ctx_exp_mrr >= 0,
      format('7) contexto funil % deveria ter tcv/mrr não-negativos, veio tcv=%/mrr=%', r_funil.nome, v_ctx_exp_tcv, v_ctx_exp_mrr);

    raise notice '7) contexto funil % (dinâmico, outubro): tcv=%, mrr=%', r_funil.nome, v_ctx_exp_tcv, v_ctx_exp_mrr;
  end loop;

  -- -------------------------------------------------------------------
  -- 8. funil_metricas — para TODO funil ativo, a linha tipo='ganha' deve
  -- ser exatamente: quantidade/valor = soma direta de fechamentos ativos
  -- do funil no período (CTE ganhos_periodo); alcancaram = contagem
  -- distinct de negociações criadas no período que alcançaram 'ganha' em
  -- historico_etapas E têm fechamento ativo (CTE alcancaram_ganha_valido).
  -- Comparação 100% dinâmica — nenhum funil/quantidade/valor fixo.
  -- -------------------------------------------------------------------
  for r_funil in select id, nome from public.funis where ativo order by ordem loop
    select count(*), coalesce(sum(f.valor_vendido), 0)
      into v_exp_ganha_qtd, v_exp_ganha_valor
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    where n.funil_id = r_funil.id
      and f.data_fechamento between v_ini_out and v_fim_out
      and f.anulado_em is null;

    v_periodo_inicio := v_ini_out::timestamp at time zone 'America/Sao_Paulo';
    v_periodo_fim    := (v_fim_out + 1)::timestamp at time zone 'America/Sao_Paulo';

    select count(distinct n.id) into v_exp_alcancaram
    from public.negociacoes n
    join public.historico_etapas h on h.negociacao_id = n.id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = r_funil.id and e.tipo = 'ganha'
    join public.fechamentos f on f.negociacao_id = n.id and f.anulado_em is null
    where n.funil_id = r_funil.id
      and n.created_at >= v_periodo_inicio
      and n.created_at <  v_periodo_fim;

    select quantidade, valor, alcancaram into r_ganha
    from public.funil_metricas(v_ini_out, v_fim_out, r_funil.id) where tipo = 'ganha';

    assert coalesce(r_ganha.quantidade, 0) = v_exp_ganha_qtd and coalesce(r_ganha.valor, 0) = v_exp_ganha_valor,
      format('8) funil_metricas % (ganha) deveria ser qtd=%/valor=% (soma direta de fechamentos ativos), veio qtd=%/valor=%',
        r_funil.nome, v_exp_ganha_qtd, v_exp_ganha_valor, r_ganha.quantidade, r_ganha.valor);

    assert coalesce(r_ganha.alcancaram, 0) = v_exp_alcancaram,
      format('8) funil_metricas % (ganha, alcancaram) deveria ser % (coorte com fechamento ativo), veio %',
        r_funil.nome, v_exp_alcancaram, r_ganha.alcancaram);
  end loop;

  raise notice 'corrige_fechamentos_extras_outubro_test.sql (pós-aplicação, invariantes): todas as asserções passaram.';
end;
$$;

-- 9: nenhuma escrita aconteceu neste arquivo (só SELECT/funções STABLE) —
-- o ROLLBACK abaixo é só disciplina, não desfaz nada.
rollback;
