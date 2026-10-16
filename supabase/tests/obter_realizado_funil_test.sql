-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) do achado desta rodada:
-- `obterRealizadoFunil` (lib/dal/funil-metricas.ts) não tinha filtro de
-- `responsavel_id` — um SDR/CLOSER com `pode_ver` em várias etapas via um
-- colega via o fechamento de QUALQUER UM visível naquele funil, enquanto
-- o card de "meta geral/individual" (`realizado_periodo`) já filtrava por
-- `responsavel_id`. Os dois lado a lado pareciam contradição.
--
-- Este arquivo não testa uma RPC (não é — `obterRealizadoFunil` é um SELECT
-- comum do Supabase client, sem SECURITY DEFINER nem migration). Em vez
-- disso, reproduz exatamente a FORMA da query (fechamentos + negociacoes,
-- filtro de funil_id e, agora, de responsavel_id) como `SET ROLE
-- authenticated` de verdade, provando que a RLS (`fechamentos_select`:
-- is_gerente() OR pode_ver_etapa) deixa um colega ver o fechamento do
-- outro, mas o filtro de `responsavel_id` adicionado agora restringe o
-- RESULTADO à pessoa certa, igual ao card de meta.
--
-- MAPA
--   1  Dois responsáveis diferentes fecham no MESMO funil — sem filtro de
--      responsavel_id (gerente), o total soma os dois.
--   2  Com filtro de responsavel_id = pessoa A, só a venda dela aparece,
--      mesmo que a RLS deixe pessoa A VER o fechamento de pessoa B (pode_ver
--      configurado nas mesmas etapas).
--   3  Com filtro de responsavel_id = pessoa B, só a venda dela aparece.
--   4  Funil selecionado não altera o total de uma pessoa fora dele (outro
--      funil, mesma pessoa, não entra na soma).
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
  v_erro text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.realizado.funil@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Realizado Funil"}'::jsonb),
    (v_pessoa_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pessoa.a.realizado.funil@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Pessoa A Funil"}'::jsonb),
    (v_pessoa_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pessoa.b.realizado.funil@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Pessoa B Funil"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Realizado Funil 1', false) returning id into v_funil_1;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_1, 'Aberta 1', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_1;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_1, 'Ganha 1', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_1;

  insert into public.funis (nome, padrao) values ('Teste Realizado Funil 2', false) returning id into v_funil_2;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_2, 'Aberta 2', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_2;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_2, 'Ganha 2', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_2;

  -- Pessoa A e Pessoa B têm `pode_ver` nas MESMAS etapas do Funil 1 — cada
  -- uma vê o fechamento da outra (igual ao cenário real do print: um SDR
  -- que vê o funil inteiro, mas só fechou uma parte das vendas dele).
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_pessoa_a, v_funil_1, null,            null, null, v_gerente),
    (v_pessoa_a, v_funil_1, v_etapa_ganha_1, true, true, v_gerente),
    (v_pessoa_b, v_funil_1, null,            null, null, v_gerente),
    (v_pessoa_b, v_funil_1, v_etapa_ganha_1, true, true, v_gerente),
    (v_pessoa_a, v_funil_2, null,            null, null, v_gerente),
    (v_pessoa_a, v_funil_2, v_etapa_ganha_2, true, true, v_gerente);

  -- Venda de Pessoa A no Funil 1.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil1 A', '11900000071', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_1, v_etapa_ganha_1, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 1000, true, true, 'pago', 'concluido', '2026-10-10', 'tcv', v_pessoa_a);

  -- Venda de Pessoa B no MESMO Funil 1 — visível pra Pessoa A via pode_ver,
  -- mas não é dela.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil1 B', '11900000072', v_pessoa_b) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_1, v_etapa_ganha_1, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 2000, true, true, 'pago', 'concluido', '2026-10-11', 'tcv', v_pessoa_b);

  -- Venda de Pessoa A no Funil 2 (outro funil) — não deve contar quando
  -- filtrando pelo Funil 1.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil2 A', '11900000073', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_2, v_etapa_ganha_2, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 9999, true, true, 'pago', 'concluido', '2026-10-12', 'tcv', v_pessoa_a);

  -- -----------------------------------------------------------------------
  -- 1. GERENTE, sem filtro de responsavel_id (visão "funil inteiro") —
  -- Funil 1 soma as DUAS vendas: 1000 + 2000 = 3000.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.data_fechamento between '2026-10-01' and '2026-10-31';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 3000, format('gerente sem filtro deveria somar as duas vendas do funil (3000), veio %s', v_total);
  insert into _log (passo) values ('ok  1  gerente (sem filtro de responsavel_id) vê o funil inteiro: 1000+2000=3000');

  -- -----------------------------------------------------------------------
  -- 2. PESSOA A, com filtro de responsavel_id = pessoa A — só a venda dela
  -- (1000), mesmo que a RLS deixe ela VER a venda de pessoa B também.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_a, 'role', 'authenticated')::text, true);
  set role authenticated;

  -- Confirma que a RLS realmente deixa pessoa A VER a venda de pessoa B
  -- (sem isso, o teste não provaria nada sobre o filtro — só sobre RLS).
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.data_fechamento between '2026-10-01' and '2026-10-31';
  assert v_total = 3000, format('pessoa A deveria VER as duas vendas via RLS (pode_ver) antes do filtro, viu %s', v_total);

  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.responsavel_id = v_pessoa_a
     and f.data_fechamento between '2026-10-01' and '2026-10-31';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 1000, format('com filtro de responsavel_id, pessoa A deveria ver só a própria venda (1000), veio %s', v_total);
  insert into _log (passo) values ('ok  2  pessoa A com filtro de responsavel_id vê só a própria venda (1000), mesmo enxergando a de pessoa B via RLS');

  -- -----------------------------------------------------------------------
  -- 3. PESSOA B, com filtro de responsavel_id = pessoa B — só a venda dela (2000).
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_b, 'role', 'authenticated')::text, true);
  set role authenticated;
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.responsavel_id = v_pessoa_b
     and f.data_fechamento between '2026-10-01' and '2026-10-31';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 2000, format('pessoa B deveria ver só a própria venda (2000), veio %s', v_total);
  insert into _log (passo) values ('ok  3  pessoa B com filtro de responsavel_id vê só a própria venda (2000)');

  -- -----------------------------------------------------------------------
  -- 4. Funil selecionado não mistura: a venda de pessoa A no Funil 2
  -- (9999) não entra quando filtrando pelo Funil 1.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_a, 'role', 'authenticated')::text, true);
  set role authenticated;
  select coalesce(sum(f.valor_vendido), 0) into v_total
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
   where n.funil_id = v_funil_1
     and f.responsavel_id = v_pessoa_a
     and f.data_fechamento between '2026-10-01' and '2026-10-31';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_total = 1000, format('venda do Funil 2 (9999) não deveria entrar ao filtrar pelo Funil 1, total veio %s', v_total);
  insert into _log (passo) values ('ok  4  funil selecionado não mistura vendas de outro funil da mesma pessoa');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - obterRealizadoFunil (filtro de responsavel_id).');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
