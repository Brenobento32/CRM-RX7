-- ===========================================================================
-- Correção de dados — anula os 2 fechamentos extras de outubro/2026 que
-- inflavam TCV/MRR (achado desta rodada, auditoria contra fonte externa
-- fornecida pelo usuário).
--
-- FONTE DE CONFERÊNCIA (outubro/2026): Oral Sim R$2.200 MRR, CTS R$2.400
-- MRR, Colégio Batista R$1.500 MRR, UVA R$6.800 TCV, CEAPG R$5.000 TCV ->
-- TCV=11.800, MRR=6.100, total=17.900. O banco real tinha 2 fechamentos
-- fora dessa lista:
--
--   A) "Colégio Batista" DUPLICADO — negociacao_id 15f8ed44-36b1-4a1b-908f-
--      5b2b31a708f6 (cliente "Raphael Nascimento", empresa "Colégio
--      Batista", já arquivada), R$1.500 MRR em 14/10/2026. O fechamento
--      LEGÍTIMO de "Colégio Batista" é outro registro, 2 dias depois:
--      negociacao_id 30b3ebeb-81db-4cc3-b7a9-beb19cb44764 (cliente
--      "Raphael Pereira", empresa "Colégio Batista do Rio de Janeiro"),
--      R$1.500 MRR em 16/10/2026 — esse NÃO é tocado por esta migration.
--
--   B) "TESTE CRM - NAO ATENDER" — negociacao_id a5c6b406-3941-4f3a-b743-
--      b63c76219263 (cliente "Teste Crm Final - On", email
--      testecrm@exemplo.com, já arquivada), R$4.800 TCV em 14/10/2026 —
--      registro de teste, nunca uma venda real.
--
-- Por que ANULAR (não apagar/mover etapa/zerar tipo_venda): ver o cabeçalho
-- completo em 20261019160000_fechamentos_anulacao.sql — resumo: DELETE é
-- bloqueado por `fechamentos_protege_negociacao` (a negociação ainda está
-- em `ganha`); mover para Perdida tocaria etapa_id/historico_etapas, fora
-- do escopo desta correção (só financeira); tipo_venda=NULL não corrigiria
-- o funil visual (`funil_metricas` nunca filtrou por tipo_venda). A
-- anulação (20261019160000) resolve os 3 problemas sem nenhum desses
-- efeitos colaterais.
--
-- `anulado_por` = NULL nesta migration: é uma correção SISTÊMICA (dado
-- incorreto desde a origem), não uma decisão pontual de um gerente pela UI
-- — mesma semântica documentada na coluna.
--
-- Esta migration SÓ faz UPDATE das 3 colunas de anulação, SÓ nestas 2
-- linhas, depois de validar rigidamente cada pré-condição (cliente/
-- empresa, negociação já arquivada, valor, tipo, data) — aborta com
-- RAISE EXCEPTION se qualquer coisa divergir do esperado, nunca aplica
-- "no escuro". Nunca toca negociacoes, historico_etapas, atividades,
-- clientes, ou qualquer outro fechamento.
-- ===========================================================================

do $$
declare
  v_neg_duplicado   constant uuid := '15f8ed44-36b1-4a1b-908f-5b2b31a708f6';
  v_neg_teste       constant uuid := 'a5c6b406-3941-4f3a-b743-b63c76219263';
  v_neg_legitimo    constant uuid := '30b3ebeb-81db-4cc3-b7a9-beb19cb44764';

  v_valor numeric;
  v_tipo  public.tipo_venda;
  v_data  date;
  v_empresa text;
  v_arquivada timestamptz;
  v_anulado timestamptz;

  v_qtd_anuladas int;
  v_tcv_anulado numeric;
  v_mrr_anulado numeric;
begin
  -- -------------------------------------------------------------------
  -- Pré-condições — A) duplicado "Colégio Batista" 14/10.
  -- -------------------------------------------------------------------
  select f.valor_vendido, f.tipo_venda, f.data_fechamento, c.empresa, n.arquivada_em, f.anulado_em
    into v_valor, v_tipo, v_data, v_empresa, v_arquivada, v_anulado
  from public.fechamentos f
  join public.negociacoes n on n.id = f.negociacao_id
  join public.clientes c on c.id = n.cliente_id
  where f.negociacao_id = v_neg_duplicado;

  if v_valor is null then
    raise exception 'Abortando: fechamento do Colégio Batista duplicado (%) não encontrado.', v_neg_duplicado;
  end if;
  if v_valor <> 1500 or v_tipo <> 'mrr' or v_data <> '2026-10-14' or v_empresa <> 'Colégio Batista' then
    raise exception 'Abortando: pré-condição do Colégio Batista duplicado (%) não confere — valor=%, tipo=%, data=%, empresa=%.',
      v_neg_duplicado, v_valor, v_tipo, v_data, v_empresa;
  end if;
  if v_arquivada is null then
    raise exception 'Abortando: negociação % deveria já estar arquivada.', v_neg_duplicado;
  end if;
  if v_anulado is not null then
    raise exception 'Abortando: fechamento % já está anulado — nada a fazer, revisar manualmente.', v_neg_duplicado;
  end if;

  -- -------------------------------------------------------------------
  -- Pré-condições — B) "TESTE CRM - NAO ATENDER" 14/10.
  -- -------------------------------------------------------------------
  select f.valor_vendido, f.tipo_venda, f.data_fechamento, c.empresa, n.arquivada_em, f.anulado_em
    into v_valor, v_tipo, v_data, v_empresa, v_arquivada, v_anulado
  from public.fechamentos f
  join public.negociacoes n on n.id = f.negociacao_id
  join public.clientes c on c.id = n.cliente_id
  where f.negociacao_id = v_neg_teste;

  if v_valor is null then
    raise exception 'Abortando: fechamento de teste (%) não encontrado.', v_neg_teste;
  end if;
  if v_valor <> 4800 or v_tipo <> 'tcv' or v_data <> '2026-10-14' or v_empresa <> 'TESTE CRM - NAO ATENDER' then
    raise exception 'Abortando: pré-condição do registro de teste (%) não confere — valor=%, tipo=%, data=%, empresa=%.',
      v_neg_teste, v_valor, v_tipo, v_data, v_empresa;
  end if;
  if v_arquivada is null then
    raise exception 'Abortando: negociação % deveria já estar arquivada.', v_neg_teste;
  end if;
  if v_anulado is not null then
    raise exception 'Abortando: fechamento % já está anulado — nada a fazer, revisar manualmente.', v_neg_teste;
  end if;

  -- -------------------------------------------------------------------
  -- Pré-condição — o legítimo de 16/10 existe, está ativo, e NÃO é um dos
  -- dois acima (garante que não vamos anular o registro certo por engano).
  -- -------------------------------------------------------------------
  select f.valor_vendido, f.tipo_venda, f.data_fechamento, c.empresa, f.anulado_em
    into v_valor, v_tipo, v_data, v_empresa, v_anulado
  from public.fechamentos f
  join public.negociacoes n on n.id = f.negociacao_id
  join public.clientes c on c.id = n.cliente_id
  where f.negociacao_id = v_neg_legitimo;

  if v_valor is null then
    raise exception 'Abortando: fechamento legítimo do Colégio Batista (%) não encontrado.', v_neg_legitimo;
  end if;
  if v_valor <> 1500 or v_tipo <> 'mrr' or v_data <> '2026-10-16' then
    raise exception 'Abortando: pré-condição do Colégio Batista legítimo (%) não confere — valor=%, tipo=%, data=%.',
      v_neg_legitimo, v_valor, v_tipo, v_data;
  end if;
  if v_anulado is not null then
    raise exception 'Abortando: o fechamento legítimo (%) já está anulado — isso não deveria acontecer.', v_neg_legitimo;
  end if;
  if v_neg_legitimo = v_neg_duplicado or v_neg_legitimo = v_neg_teste then
    raise exception 'Abortando: negociacao_id do legítimo colide com um dos extras — configuração da migration está errada.';
  end if;

  -- -------------------------------------------------------------------
  -- Anulação — só as 2 linhas autorizadas, só as 3 colunas de anulação.
  -- -------------------------------------------------------------------
  update public.fechamentos
     set anulado_em      = now(),
         motivo_anulacao = 'Duplicidade confirmada; fechamento válido do Colégio Batista preservado em 2026-10-16 (negociacao_id 30b3ebeb-81db-4cc3-b7a9-beb19cb44764).',
         anulado_por     = null
   where negociacao_id = v_neg_duplicado;

  update public.fechamentos
     set anulado_em      = now(),
         motivo_anulacao = 'Registro de teste ("TESTE CRM - NAO ATENDER"), não representa venda real.',
         anulado_por     = null
   where negociacao_id = v_neg_teste;

  -- -------------------------------------------------------------------
  -- Verificação pós-UPDATE: exatamente as 2 linhas, TCV/MRR exatos.
  -- -------------------------------------------------------------------
  select count(*), coalesce(sum(valor_vendido) filter (where tipo_venda = 'tcv'), 0),
         coalesce(sum(valor_vendido) filter (where tipo_venda = 'mrr'), 0)
    into v_qtd_anuladas, v_tcv_anulado, v_mrr_anulado
  from public.fechamentos
  where negociacao_id in (v_neg_duplicado, v_neg_teste)
    and anulado_em is not null;

  if v_qtd_anuladas <> 2 then
    raise exception 'Abortando: esperava exatamente 2 linhas anuladas, veio %.', v_qtd_anuladas;
  end if;
  if v_tcv_anulado <> 4800 then
    raise exception 'Abortando: TCV anulado deveria ser 4800, veio %.', v_tcv_anulado;
  end if;
  if v_mrr_anulado <> 1500 then
    raise exception 'Abortando: MRR anulado deveria ser 1500, veio %.', v_mrr_anulado;
  end if;

  -- O legítimo de 16/10 continua ativo.
  if exists (
    select 1 from public.fechamentos where negociacao_id = v_neg_legitimo and anulado_em is not null
  ) then
    raise exception 'Abortando: o fechamento legítimo (%) foi anulado por engano.', v_neg_legitimo;
  end if;

  raise notice 'anula_fechamentos_extras_outubro: 2 fechamentos anulados (TCV=4800, MRR=1500); legítimo de 16/10 intacto.';
end;
$$;
