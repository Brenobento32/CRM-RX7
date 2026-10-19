-- ===========================================================================
-- Teste transacional (PÓS-APLICAÇÃO) de META MENSAL POR FUNIL
-- (20261019180000_metas_por_funil.sql — já aplicada em produção).
--
-- Este arquivo NÃO reinstala nenhum objeto da migration: coluna
-- `metas.funil_id`, constraints, trigger `metas_regras`, e as três RPCs
-- (`metas_progresso`, `metas_funis_progresso`, `salvar_metas_funis`) já
-- existem de verdade no banco. Só cria FIXTURES (funis/usuários/
-- negociações/fechamentos/metas sintéticos) dentro de BEGIN/ROLLBACK e
-- testa os objetos REAIS contra elas.
--
-- Mês de fixture: 2030-01 (e 2030-02, para o ponto 15) — longe de qualquer
-- dado real, para que os totais agregados (metas_progresso/
-- metas_funis_progresso somam GLOBALMENTE por mês, não só pelos funis novos
-- deste teste) sejam exatamente os números construídos aqui, sem
-- contaminação de nenhuma venda real de produção.
--
-- BEGIN/ROLLBACK: nada permanece — zero fixtures depois do rollback.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Fixtures.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente uuid := gen_random_uuid();
  v_sdr     uuid := gen_random_uuid();
  v_closer1 uuid := gen_random_uuid();
  v_closer2 uuid := gen_random_uuid();

  v_funil_a uuid;
  v_funil_b uuid;
  v_funil_c uuid; -- criado DEPOIS das metas/vendas acima, para o ponto 16 (funil futuro).
  v_ganha_a uuid;
  v_ganha_b uuid;
  v_ganha_c uuid;

  v_cli uuid;
  v_neg uuid;

  v_sqlstate text; v_mensagem text;

  r_empresa record; r_a record; r_b record; r_c record;
  r_sdr record; r_closer1 record; r_closer2 record;
  v_qtd_empresa int; v_qtd_sdr int; v_qtd_closer1 int;

  v_meta_funil_dup_id uuid;

  -- Atomicidade de salvar_metas_funis (seção dedicada, funis próprios).
  v_funil_e uuid; v_funil_f uuid; v_funil_g uuid;
  v_ganha_e uuid; v_ganha_f uuid; v_ganha_g uuid;
  v_resultado int;
  v_cnt int;
  v_meta_e_tcv_id_1 uuid; v_meta_e_tcv_id_2 uuid;
  v_falhou boolean;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.metasfunil.gerente@teste.local', '', now(), now(), now(), '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste MetasFunil"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.metasfunil.sdr@teste.local', '', now(), now(), now(), '{"role":"sdr"}'::jsonb, '{"nome":"SDR Teste MetasFunil"}'::jsonb),
    (v_closer1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.metasfunil.closer1@teste.local', '', now(), now(), now(), '{}'::jsonb, '{"nome":"Closer1 Teste MetasFunil"}'::jsonb),
    (v_closer2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.metasfunil.closer2@teste.local', '', now(), now(), now(), '{}'::jsonb, '{"nome":"Closer2 Teste MetasFunil"}'::jsonb);
  -- closer1/closer2 nascem 'closer' (default da coluna); sdr nasce 'sdr' via raw_app_meta_data.

  insert into public.funis (nome, padrao) values ('Teste MetasFunil A', false) returning id into v_funil_a;
  insert into public.funis (nome, padrao) values ('Teste MetasFunil B', false) returning id into v_funil_b;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_a, 'Fechado A', 'verde', 100000, 'ganha') returning id into v_ganha_a;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_b, 'Fechado B', 'azul', 100000, 'ganha') returning id into v_ganha_b;

  -- -------------------------------------------------------------------
  -- Funil A: TCV 3000 (closer1) + 1000 (gerente) = 4000 válido;
  -- MRR 600 (closer1); + 1 fechamento TCV 9999 ANULADO (não deve contar).
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente MetasFunil A1', 'Empresa A1', v_closer1) returning id into v_cli;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cli, v_funil_a, v_ganha_a, v_closer1) returning id into v_neg;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por)
    values (v_neg, 3000, '2030-01-10', true, true, 'pago', 'concluido', 'tcv', v_closer1);

  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente MetasFunil A2', 'Empresa A2', v_gerente) returning id into v_cli;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cli, v_funil_a, v_ganha_a, v_gerente) returning id into v_neg;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por)
    values (v_neg, 1000, '2030-01-12', true, true, 'pago', 'concluido', 'tcv', v_gerente);

  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente MetasFunil A3', 'Empresa A3', v_closer1) returning id into v_cli;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cli, v_funil_a, v_ganha_a, v_closer1) returning id into v_neg;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por)
    values (v_neg, 600, '2030-01-15', true, true, 'pago', 'concluido', 'mrr', v_closer1);

  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente MetasFunil A4 Anulado', 'Empresa A4', v_closer1) returning id into v_cli;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cli, v_funil_a, v_ganha_a, v_closer1) returning id into v_neg;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por, anulado_em, motivo_anulacao, anulado_por)
    values (v_neg, 9999, '2030-01-18', true, true, 'pago', 'concluido', 'tcv', v_closer1, now(), 'teste: fechamento anulado não deve contar', v_gerente);

  -- -------------------------------------------------------------------
  -- Funil B: TCV 2000 (closer2); MRR 800 (closer2). Nunca deve aparecer
  -- somado ao Funil A.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente MetasFunil B1', 'Empresa B1', v_closer2) returning id into v_cli;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cli, v_funil_b, v_ganha_b, v_closer2) returning id into v_neg;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por)
    values (v_neg, 2000, '2030-01-11', true, true, 'pago', 'concluido', 'tcv', v_closer2);

  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente MetasFunil B2', 'Empresa B2', v_closer2) returning id into v_cli;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cli, v_funil_b, v_ganha_b, v_closer2) returning id into v_neg;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por)
    values (v_neg, 800, '2030-01-16', true, true, 'pago', 'concluido', 'mrr', v_closer2);

  -- -------------------------------------------------------------------
  -- Metas: global (funil_id null) + Funil A + Funil B, mês 2030-01.
  -- -------------------------------------------------------------------
  insert into public.metas (usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta, criado_por) values
    (null, null,      '2030-01-01', 'tcv', 10000, v_gerente),
    (null, null,      '2030-01-01', 'mrr',  3000, v_gerente),
    (null, v_funil_a,  '2030-01-01', 'tcv',  4000, v_gerente),
    (null, v_funil_a,  '2030-01-01', 'mrr',  1000, v_gerente),
    (null, v_funil_b,  '2030-01-01', 'tcv',  3000, v_gerente),
    (null, v_funil_b,  '2030-01-01', 'mrr',   800, v_gerente);

  -- ===================================================================
  -- 2/3/4/5/6/7. metas_funis_progresso: Funil A e Funil B corretos,
  -- separados, TCV/MRR nunca somados, anulado nunca conta, A nunca
  -- recebe venda do B.
  -- ===================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select * into r_a from public.metas_funis_progresso('2030-01-01') where funil_id = v_funil_a;
  assert r_a.valor_meta_tcv = 4000 and r_a.realizado_tcv = 4000,
    format('2/3) Funil A TCV: meta=4000/realizado=4000 esperado, veio meta=%/realizado=%', r_a.valor_meta_tcv, r_a.realizado_tcv);
  assert r_a.valor_meta_mrr = 1000 and r_a.realizado_mrr = 600,
    format('2/3/5) Funil A MRR: meta=1000/realizado=600 esperado (TCV e MRR não somados), veio meta=%/realizado=%', r_a.valor_meta_mrr, r_a.realizado_mrr);

  select * into r_b from public.metas_funis_progresso('2030-01-01') where funil_id = v_funil_b;
  assert r_b.valor_meta_tcv = 3000 and r_b.realizado_tcv = 2000,
    format('4/7) Funil B TCV: meta=3000/realizado=2000 esperado (sem venda do A), veio meta=%/realizado=%', r_b.valor_meta_tcv, r_b.realizado_tcv);
  assert r_b.valor_meta_mrr = 800 and r_b.realizado_mrr = 800,
    format('4) Funil B MRR: meta=800/realizado=800 esperado, veio meta=%/realizado=%', r_b.valor_meta_mrr, r_b.realizado_mrr);

  -- 6) fechamento anulado (9999 TCV em A) não entrou no realizado_tcv de A (4000, não 13999) — já provado acima.

  -- ===================================================================
  -- 1. metas_progresso (meta GLOBAL) não mistura com as metas por funil:
  -- meta geral TCV=10000/MRR=3000 (cadastradas separadamente dos funis),
  -- realizado = soma de TODOS os funis (4000+2000=6000 TCV; 600+800=1400
  -- MRR) — nunca lê a linha de um funil específico.
  -- ===================================================================
  select * into r_empresa from public.metas_progresso('2030-01-01') where usuario_id is null;
  assert r_empresa.valor_meta_tcv = 10000 and r_empresa.valor_meta_mrr = 3000,
    format('1) meta geral deveria ser tcv=10000/mrr=3000 (não contaminada pelas metas por funil), veio tcv=%/mrr=%',
      r_empresa.valor_meta_tcv, r_empresa.valor_meta_mrr);
  assert r_empresa.realizado_tcv = 6000 and r_empresa.realizado_mrr = 1400,
    format('1) realizado geral deveria ser tcv=6000/mrr=1400 (soma de A+B), veio tcv=%/mrr=%',
      r_empresa.realizado_tcv, r_empresa.realizado_mrr);
  assert r_empresa.qtd_tcv = 3 and r_empresa.qtd_mrr = 2,
    format('ticket médio: qtd_tcv=3/qtd_mrr=2 esperado, veio qtd_tcv=%/qtd_mrr=%', r_empresa.qtd_tcv, r_empresa.qtd_mrr);

  -- ===================================================================
  -- 8/9/10/11. Visibilidade de metas_funis_progresso: GERENTE, SDR e
  -- CLOSER recebem exatamente as mesmas linhas (agregado por funil, sem
  -- nenhum dado individual para restringir por papel).
  -- ===================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select * into r_sdr from public.metas_funis_progresso('2030-01-01') where funil_id = v_funil_a;
  assert r_sdr.realizado_tcv = 4000 and r_sdr.realizado_mrr = 600,
    format('9) SDR deveria ver o agregado do Funil A igual ao gerente, veio tcv=%/mrr=%', r_sdr.realizado_tcv, r_sdr.realizado_mrr);

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer1, 'role', 'authenticated')::text, true);
  select * into r_closer1 from public.metas_funis_progresso('2030-01-01') where funil_id = v_funil_a;
  assert r_closer1.realizado_tcv = 4000 and r_closer1.realizado_mrr = 600,
    format('10) CLOSER deveria ver o agregado do Funil A igual ao gerente, veio tcv=%/mrr=%', r_closer1.realizado_tcv, r_closer1.realizado_mrr);

  -- ===================================================================
  -- 18. metas_progresso GLOBAL permanece correto na visibilidade
  -- individual (closer1 não vê a linha individual de closer2; SDR não
  -- recebe nenhuma linha individual) — comportamento preexistente,
  -- confirmado intacto depois da recriação da função.
  -- ===================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer1, 'role', 'authenticated')::text, true);
  select count(*) into v_qtd_closer1 from public.metas_progresso('2030-01-01') where usuario_id = v_closer2;
  assert v_qtd_closer1 = 0, '18) closer1 não deveria ver a linha individual de closer2';

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select count(*) into v_qtd_sdr from public.metas_progresso('2030-01-01') where usuario_id is not null;
  assert v_qtd_sdr = 0, '18) SDR não deveria receber nenhuma linha individual';
  select count(*) into v_qtd_sdr from public.metas_progresso('2030-01-01') where usuario_id is null;
  assert v_qtd_sdr = 1, '18) SDR deveria continuar vendo a linha da empresa';

  -- ===================================================================
  -- 13 (upsert real): `salvarMetaFunil` (lib/dal/metas.ts) faz
  -- `.upsert(..., { onConflict: 'usuario_id,funil_id,periodo_mes,tipo_meta' })`
  -- — equivalente a este INSERT ... ON CONFLICT ... DO UPDATE. Confirma que
  -- o conflito real (metas_uma_por_mes, nulls not distinct) é resolvido
  -- pelo Postgres por essa lista de colunas, o id da meta não muda, e só
  -- valor_meta é atualizado (trigger de imutabilidade não bloqueia um
  -- upsert que repete os mesmos usuario_id/funil_id/periodo_mes/tipo_meta).
  -- ===================================================================
  declare
    v_meta_a_tcv_id_antes uuid;
    v_meta_a_tcv_id_depois uuid;
    v_meta_a_tcv_valor_depois numeric;
  begin
    select id into v_meta_a_tcv_id_antes from public.metas where funil_id = v_funil_a and tipo_meta = 'tcv';

    insert into public.metas (usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta)
    values (null, v_funil_a, '2030-01-01', 'tcv', 4500)
    on conflict (usuario_id, funil_id, periodo_mes, tipo_meta)
    do update set valor_meta = excluded.valor_meta, usuario_id = excluded.usuario_id,
      funil_id = excluded.funil_id, periodo_mes = excluded.periodo_mes, tipo_meta = excluded.tipo_meta;

    select id, valor_meta into v_meta_a_tcv_id_depois, v_meta_a_tcv_valor_depois
      from public.metas where funil_id = v_funil_a and tipo_meta = 'tcv';

    assert v_meta_a_tcv_id_depois = v_meta_a_tcv_id_antes, '13) upsert deveria atualizar a MESMA linha (id não muda)';
    assert v_meta_a_tcv_valor_depois = 4500, format('13) upsert deveria ter atualizado valor_meta para 4500, veio %', v_meta_a_tcv_valor_depois);

    -- Devolve ao valor original (4000), para não afetar as asserções seguintes que já leram r_a/r_empresa.
    update public.metas set valor_meta = 4000 where id = v_meta_a_tcv_id_antes;
  end;

  -- ===================================================================
  -- 13/14. GERENTE tem CRUD (já provado pelos INSERTs acima, que correm
  -- como owner da sessão de teste); não-gerente sem escrita — RLS
  -- (metas_insert/update/delete: is_gerente()) é testada à parte em
  -- /metas; aqui confirmamos que a trigger nova (metas_regras) bloqueia a
  -- COMBINAÇÃO invalida funil_id+usuario_id não-nulos, incondicional de
  -- quem chama.
  -- ===================================================================
  begin
    insert into public.metas (usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta, criado_por)
      values (v_closer1, v_funil_a, '2030-01-01', 'tcv', 500, v_gerente);
    raise exception 'FALHA: meta por funil com usuario_id preenchido foi aceita (deveria ter sido bloqueada)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514' and v_mensagem ilike '%sempre da empresa%',
      format('combinação inválida: esperava 23514 "sempre da empresa", veio % (%)', v_sqlstate, v_mensagem);
  end;

  -- Imutabilidade: tentar mudar o funil_id de uma meta já criada -> bloqueado.
  select id into v_meta_funil_dup_id from public.metas where funil_id = v_funil_a and tipo_meta = 'tcv';
  begin
    update public.metas set funil_id = v_funil_b where id = v_meta_funil_dup_id;
    raise exception 'FALHA: funil_id de uma meta existente foi alterado (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514' and v_mensagem ilike '%Só o valor%',
      format('imutabilidade funil_id: esperava 23514 "Só o valor...", veio % (%)', v_sqlstate, v_mensagem);
  end;

  -- ===================================================================
  -- 15. Mês anterior/seguinte são independentes: fevereiro/2030 não tem
  -- nenhuma meta nem venda — Funil A em fevereiro vem tudo zero/null, sem
  -- herdar nada de janeiro.
  -- ===================================================================
  select * into r_a from public.metas_funis_progresso('2030-02-01') where funil_id = v_funil_a;
  assert r_a.meta_id_tcv is null and r_a.valor_meta_tcv is null and r_a.realizado_tcv = 0,
    format('15) Funil A em fevereiro deveria estar sem meta e com realizado=0, veio meta_id=%/meta=%/realizado=%',
      r_a.meta_id_tcv, r_a.valor_meta_tcv, r_a.realizado_tcv);

  -- ===================================================================
  -- 16. Funil futuro (criado DEPOIS das metas/vendas acima, sem nenhuma
  -- meta) aparece automaticamente em metas_funis_progresso, com
  -- meta/realizado zerados — nunca hardcoded para 2 funis.
  -- ===================================================================
  insert into public.funis (nome, padrao) values ('Teste MetasFunil C (futuro)', false) returning id into v_funil_c;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_c, 'Fechado C', 'laranja', 100000, 'ganha') returning id into v_ganha_c;

  select * into r_c from public.metas_funis_progresso('2030-01-01') where funil_id = v_funil_c;
  assert r_c.funil_nome = 'Teste MetasFunil C (futuro)', '16) Funil C deveria aparecer automaticamente em metas_funis_progresso';
  assert r_c.meta_id_tcv is null and r_c.meta_id_mrr is null and r_c.realizado_tcv = 0 and r_c.realizado_mrr = 0,
    '16) Funil C sem nenhuma meta/venda deveria vir com meta null e realizado 0';

  -- ===================================================================
  -- 17. Soma das metas dos funis (4000+3000=7000 TCV) diverge da meta
  -- total (10000 TCV) sem quebrar nada — as duas continuam lidas
  -- corretamente e intactas (já provado nos itens 1 e 2-4 acima: a meta
  -- geral ficou 10000, as dos funis ficaram 4000/3000, nenhuma mexeu na
  -- outra). Só reconfirmando explicitamente aqui.
  -- ===================================================================
  assert r_empresa.valor_meta_tcv = 10000, '17) meta geral TCV não deveria ter sido alterada pela divergência';

  -- ===================================================================
  -- ATOMICIDADE de salvar_metas_funis — funis próprios (E/F/G), isolados
  -- dos já usados acima, para que cada cenário comece de um estado
  -- conhecido (zero metas) e as asserções de "nada mudou" sejam
  -- inequívocas.
  -- ===================================================================
  insert into public.funis (nome, padrao) values ('Teste MetasFunil E (atomicidade)', false) returning id into v_funil_e;
  insert into public.funis (nome, padrao) values ('Teste MetasFunil F (atomicidade)', false) returning id into v_funil_f;
  insert into public.funis (nome, padrao) values ('Teste MetasFunil G (inativo)', false) returning id into v_funil_g;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_e, 'Fechado E', 'ciano', 100000, 'ganha') returning id into v_ganha_e;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_f, 'Fechado F', 'rosa', 100000, 'ganha') returning id into v_ganha_f;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_g, 'Fechado G', 'cinza', 100000, 'ganha') returning id into v_ganha_g;
  update public.funis set ativo = false where id = v_funil_g; -- D) funil inativo.

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  -- -------------------------------------------------------------------
  -- F) SDR chamando salvar_metas_funis -> bloqueado (42501), nada salvo.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  begin
    perform public.salvar_metas_funis('2030-01-01',
      jsonb_build_array(jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1000)));
    raise exception 'FALHA: SDR conseguiu salvar_metas_funis (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '42501', format('F) SDR: esperava 42501, veio % (%)', v_sqlstate, v_mensagem);
  end;
  select count(*) into v_cnt from public.metas where funil_id = v_funil_e;
  assert v_cnt = 0, 'F) SDR bloqueado não deveria ter deixado nenhuma linha em metas';

  -- -------------------------------------------------------------------
  -- G) CLOSER chamando salvar_metas_funis -> bloqueado (42501), nada salvo.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer1, 'role', 'authenticated')::text, true);
  begin
    perform public.salvar_metas_funis('2030-01-01',
      jsonb_build_array(jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1000)));
    raise exception 'FALHA: CLOSER conseguiu salvar_metas_funis (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '42501', format('G) CLOSER: esperava 42501, veio % (%)', v_sqlstate, v_mensagem);
  end;
  select count(*) into v_cnt from public.metas where funil_id = v_funil_e;
  assert v_cnt = 0, 'G) CLOSER bloqueado não deveria ter deixado nenhuma linha em metas';

  -- -------------------------------------------------------------------
  -- I) anon/public SEM EXECUTE; authenticated COM EXECUTE.
  -- -------------------------------------------------------------------
  assert not has_function_privilege('anon', 'public.salvar_metas_funis(date, jsonb)', 'EXECUTE'),
    'I) anon não deveria ter EXECUTE em salvar_metas_funis';
  assert not has_function_privilege('public', 'public.salvar_metas_funis(date, jsonb)', 'EXECUTE'),
    'I) public não deveria ter EXECUTE em salvar_metas_funis';
  assert has_function_privilege('authenticated', 'public.salvar_metas_funis(date, jsonb)', 'EXECUTE'),
    'I) authenticated deveria ter EXECUTE em salvar_metas_funis';

  -- -------------------------------------------------------------------
  -- B) GERENTE: primeiro item válido + segundo inválido -> a chamada
  -- inteira falha (23514) e o primeiro item (que isoladamente seria
  -- válido) NÃO permanece — zero linhas para o Funil E.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  begin
    perform public.salvar_metas_funis('2030-01-01', jsonb_build_array(
      jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1000),
      jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'mrr', 'valor_meta', -50)
    ));
    raise exception 'FALHA: payload com item inválido foi aceito (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514', format('B) esperava 23514, veio % (%)', v_sqlstate, v_mensagem);
  end;
  select count(*) into v_cnt from public.metas where funil_id = v_funil_e;
  assert v_cnt = 0, 'B) o primeiro item (válido isoladamente) não deveria ter sido salvo — zero alteração parcial';

  -- -------------------------------------------------------------------
  -- E) Tipo duplicado para o mesmo funil no payload -> tudo falha, nada salvo.
  -- -------------------------------------------------------------------
  begin
    perform public.salvar_metas_funis('2030-01-01', jsonb_build_array(
      jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1111),
      jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 2222)
    ));
    raise exception 'FALHA: payload com funil+tipo duplicado foi aceito (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514', format('E) esperava 23514, veio % (%)', v_sqlstate, v_mensagem);
  end;
  select count(*) into v_cnt from public.metas where funil_id = v_funil_e;
  assert v_cnt = 0, 'E) duplicidade no payload não deveria ter salvo nada';

  -- -------------------------------------------------------------------
  -- C) Funil inexistente (uuid aleatório) junto com um item real -> tudo
  -- falha, o item real (Funil F) não é tocado.
  -- -------------------------------------------------------------------
  begin
    perform public.salvar_metas_funis('2030-01-01', jsonb_build_array(
      jsonb_build_object('funil_id', v_funil_f, 'tipo_meta', 'mrr', 'valor_meta', 999),
      jsonb_build_object('funil_id', gen_random_uuid(), 'tipo_meta', 'tcv', 'valor_meta', 500)
    ));
    raise exception 'FALHA: payload com funil inexistente foi aceito (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514', format('C) esperava 23514, veio % (%)', v_sqlstate, v_mensagem);
  end;
  select count(*) into v_cnt from public.metas where funil_id = v_funil_f;
  assert v_cnt = 0, 'C) funil inexistente no payload não deveria ter salvo o item real (Funil F) junto';

  -- -------------------------------------------------------------------
  -- D) Funil existente mas INATIVO (Funil G) junto com um item real ->
  -- tudo falha, o item real (Funil F) não é tocado.
  -- -------------------------------------------------------------------
  begin
    perform public.salvar_metas_funis('2030-01-01', jsonb_build_array(
      jsonb_build_object('funil_id', v_funil_f, 'tipo_meta', 'mrr', 'valor_meta', 999),
      jsonb_build_object('funil_id', v_funil_g, 'tipo_meta', 'tcv', 'valor_meta', 500)
    ));
    raise exception 'FALHA: payload com funil inativo foi aceito (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514', format('D) esperava 23514, veio % (%)', v_sqlstate, v_mensagem);
  end;
  select count(*) into v_cnt from public.metas where funil_id = v_funil_f;
  assert v_cnt = 0, 'D) funil inativo no payload não deveria ter salvo o item real (Funil F) junto';

  -- -------------------------------------------------------------------
  -- A) GERENTE (H): payload com 4 itens válidos -> os 4 são salvos
  -- atomicamente, função retorna 4.
  -- -------------------------------------------------------------------
  select public.salvar_metas_funis('2030-01-01', jsonb_build_array(
    jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1000),
    jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'mrr', 'valor_meta', 500),
    jsonb_build_object('funil_id', v_funil_f, 'tipo_meta', 'tcv', 'valor_meta', 2000),
    jsonb_build_object('funil_id', v_funil_f, 'tipo_meta', 'mrr', 'valor_meta', 1500)
  )) into v_resultado;
  assert v_resultado = 4, format('A/H) salvar_metas_funis deveria retornar 4, veio %', v_resultado);

  select count(*) into v_cnt from public.metas where funil_id in (v_funil_e, v_funil_f);
  assert v_cnt = 4, format('A/H) deveriam existir 4 linhas em metas (E+F, tcv+mrr), vieram %', v_cnt);

  select id into v_meta_e_tcv_id_1 from public.metas where funil_id = v_funil_e and tipo_meta = 'tcv';
  assert (select valor_meta from public.metas where id = v_meta_e_tcv_id_1) = 1000,
    'A) Funil E TCV deveria ser 1000 logo após o save atômico';

  -- -------------------------------------------------------------------
  -- J) Upsert: salvar de novo o MESMO funil_id+tipo_meta (Funil E TCV)
  -- com outro valor -> atualiza a MESMA linha (id não muda), só
  -- valor_meta muda.
  -- -------------------------------------------------------------------
  perform public.salvar_metas_funis('2030-01-01', jsonb_build_array(
    jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1200)
  ));
  select id into v_meta_e_tcv_id_2 from public.metas where funil_id = v_funil_e and tipo_meta = 'tcv';
  assert v_meta_e_tcv_id_2 = v_meta_e_tcv_id_1, 'J) upsert deveria atualizar a MESMA linha (id não muda)';
  assert (select valor_meta from public.metas where id = v_meta_e_tcv_id_1) = 1200,
    'J) upsert deveria ter atualizado valor_meta para 1200';

  -- Confirma que os cenários de falha anteriores (B/C/D/E, todos depois
  -- deste ponto não — eles já rodaram ANTES do save de A, contra o Funil
  -- E/F ainda vazios) realmente não deixaram nenhum resíduo: Funil E TCV
  -- é 1200 (só a sequência A -> J alterou), nunca 1000/1111/2222 de
  -- alguma tentativa abortada.
  v_falhou := false;
  begin
    perform public.salvar_metas_funis('2030-01-01', jsonb_build_array(
      jsonb_build_object('funil_id', v_funil_e, 'tipo_meta', 'tcv', 'valor_meta', 1300),
      jsonb_build_object('funil_id', v_funil_g, 'tipo_meta', 'mrr', 'valor_meta', 1)
    ));
  exception when others then
    v_falhou := true;
  end;
  assert v_falhou, 'checagem final: payload com funil inativo deveria falhar';
  assert (select valor_meta from public.metas where id = v_meta_e_tcv_id_1) = 1200,
    'checagem final: Funil E TCV deveria continuar 1200 (tentativa abortada não deixou resíduo)';

  raise notice 'metas_por_funil_test.sql: todas as asserções passaram.';
end;
$$;

set constraints all immediate;

rollback;
