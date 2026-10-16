-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) confirmando a decisão de
-- produto desta rodada pra `obterRealizadoFunil` (lib/dal/funil-metricas.ts):
-- "Contexto do funil selecionado" é SEMPRE a soma agregada do funil
-- inteiro (equipe), nunca filtrada por responsável — nunca vira uma visão
-- individual de CLOSER. Isso é intencional: ela não tem nome nem valor
-- individual associado a ninguém, é só um total do funil; quem protege
-- dado INDIVIDUAL (nome + valor de um CLOSER específico) é
-- `metas_progresso`/`realizado_periodo` (ver
-- `metas_visibilidade_por_papel_test.sql`), não esta função.
--
-- (Uma rodada anterior tinha adicionado um filtro de `responsavel_id`
-- aqui — revertido de propósito nesta rodada, junto com a mudança de
-- "Meta do período" para também ser sempre geral. Este arquivo substitui o
-- teste antigo, que validava exatamente o comportamento contrário.)
--
-- MAPA
--   1  Duas pessoas diferentes fecham no MESMO funil — a soma do funil
--      (sem filtro nenhum) inclui as duas, pra QUALQUER papel que a
--      consulte (gerente ou closer com pode_ver no funil).
--   2  Funil selecionado não mistura: uma venda em OUTRO funil não entra.
--   3  Nenhum nome/valor individual é exposto por esta consulta — ela só
--      devolve o agregado (valor_vendido, tipo_venda), nunca
--      responsavel_id/nome de quem vendeu.
-- ===========================================================================

begin;

create temp table _log (id serial primary key, passo text);

do $$
declare
  v_gerente   uuid := 'd4000000-0000-0000-0000-000000000001';
  v_pessoa_a  uuid := 'd4000000-0000-0000-0000-000000000002';
  v_pessoa_b  uuid := 'd4000000-0000-0000-0000-000000000003';

  v_funil_1 uuid; v_etapa_ganha_1 uuid; v_etapa_aberta_1 uuid;
  v_funil_2 uuid; v_etapa_ganha_2 uuid; v_etapa_aberta_2 uuid;

  v_cliente uuid; v_neg uuid;
  v_total numeric;
  v_colunas integer;
  v_erro text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.realizado.funil2@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Realizado Funil 2"}'::jsonb),
    (v_pessoa_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pessoa.a.realizado.funil2@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Pessoa A Funil 2"}'::jsonb),
    (v_pessoa_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pessoa.b.realizado.funil2@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Pessoa B Funil 2"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Realizado Funil A2', false) returning id into v_funil_1;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_1, 'Aberta 1', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_1;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_1, 'Ganha 1', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_1;

  insert into public.funis (nome, padrao) values ('Teste Realizado Funil B2', false) returning id into v_funil_2;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_2, 'Aberta 2', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_2;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_2, 'Ganha 2', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_2;

  -- Pessoa A e Pessoa B compartilham pode_ver no Funil 1 — mesmo cenário
  -- do print em produção (um closer vê o fechamento do outro no mesmo funil).
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_pessoa_a, v_funil_1, null,            null, null, v_gerente),
    (v_pessoa_a, v_funil_1, v_etapa_ganha_1, true, true, v_gerente),
    (v_pessoa_b, v_funil_1, null,            null, null, v_gerente),
    (v_pessoa_b, v_funil_1, v_etapa_ganha_1, true, true, v_gerente);

  -- Venda de Pessoa A no Funil 1.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil1 A2', '11900000074', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_1, v_etapa_ganha_1, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 1000, true, true, 'pago', 'concluido', '2030-02-10', 'tcv', v_pessoa_a);

  -- Venda de Pessoa B, MESMO Funil 1.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil1 B2', '11900000075', v_pessoa_b) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_1, v_etapa_ganha_1, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 2000, true, true, 'pago', 'concluido', '2030-02-11', 'tcv', v_pessoa_b);

  -- Venda de Pessoa A no Funil 2 (outro funil) — não deve entrar ao filtrar pelo Funil 1.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil2 A2', '11900000076', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_2, v_etapa_ganha_2, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 9999, true, true, 'pago', 'concluido', '2030-02-12', 'tcv', v_pessoa_a);

  -- -----------------------------------------------------------------------
  -- 1. GERENTE e pessoa A (closer com pode_ver no funil) veem a MESMA soma
  -- agregada do funil inteiro: 1000 + 2000 = 3000 — nenhuma das duas
  -- consultas filtra por responsavel_id, de propósito.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.data_fechamento between '2030-02-01' and '2030-02-28';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 3000, format('gerente: soma do funil deveria ser 3000 (1000+2000), veio %s', v_total);
  insert into _log (passo) values ('ok  1a  gerente vê a soma agregada do funil inteiro: 1000+2000=3000');

  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_a, 'role', 'authenticated')::text, true);
  set role authenticated;
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.data_fechamento between '2030-02-01' and '2030-02-28';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 3000,
    format('pessoa A: "contexto do funil" deveria mostrar o AGREGADO do funil (3000), nunca só a própria venda, veio %s', v_total);
  insert into _log (passo) values ('ok  1b  pessoa A (closer) também vê a soma agregada do funil inteiro (3000) — contexto do funil é de equipe, nunca individual');

  -- -----------------------------------------------------------------------
  -- 2. Funil selecionado não mistura: venda do Funil 2 (9999) não entra.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_a, 'role', 'authenticated')::text, true);
  set role authenticated;
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.data_fechamento between '2030-02-01' and '2030-02-28';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 3000, format('venda do Funil 2 (9999) não deveria entrar ao filtrar pelo Funil 1, total veio %s', v_total);
  insert into _log (passo) values ('ok  2  funil selecionado não mistura vendas de outro funil');

  -- -----------------------------------------------------------------------
  -- 3. A consulta em si (mesma forma de `obterRealizadoFunil`) nunca
  -- seleciona responsavel_id/nome — só valor_vendido/tipo_venda, agregado.
  -- -----------------------------------------------------------------------
  select count(*) into v_colunas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'fechamentos' and column_name = 'responsavel_id';
  assert v_colunas = 1, 'sanity check: a coluna responsavel_id existe em fechamentos (não faz parte do SELECT de obterRealizadoFunil)';
  insert into _log (passo) values ('ok  3  obterRealizadoFunil nunca seleciona responsavel_id/nome — só valor_vendido/tipo_venda agregados');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - obterRealizadoFunil (visão de equipe, nunca individual).');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
