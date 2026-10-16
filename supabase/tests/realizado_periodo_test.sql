-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) da RPC `realizado_periodo`
-- (migration 20261016190000_realizado_periodo_todos_funis.sql) — ainda não
-- aplicada no banco real, auto-instalada aqui, rollback no fim.
--
-- Cenário pedido pelo usuário, literal:
--   FUNIL A: venda TCV de R$ 1.000 para pessoa A.
--   FUNIL B: venda TCV de R$ 2.000 para pessoa A.
--   FUNIL C: venda TCV de R$ 3.000 para pessoa B.
--   Esperado: GERAL = 6.000; INDIVIDUAL A = 3.000; INDIVIDUAL B = 3.000.
-- Depois MRR é testado separadamente, mais período, atribuição e
-- "venda sem tipo_venda".
--
-- Fixtures inseridas direto como postgres (superusuário) — não têm relação
-- com RLS, são só massa de dados. SET ROLE authenticated + JWT só nas
-- CHAMADAS da RPC em si, pra testar a autorização de verdade.
-- ===========================================================================

begin;

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
    null::uuid, null::text, null::public.user_role, null::boolean,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  where public.is_gerente()

  union all

  select
    p.id, p.nome, p.role, p.ativo,
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

revoke all on function public.realizado_periodo(date, date) from public, anon;
grant execute on function public.realizado_periodo(date, date) to authenticated;

create temp table _log (id serial primary key, passo text);

do $$
declare
  v_gerente   uuid := 'd3000000-0000-0000-0000-000000000001';
  v_pessoa_a  uuid := 'd3000000-0000-0000-0000-000000000002';
  v_pessoa_b  uuid := 'd3000000-0000-0000-0000-000000000003';

  v_funil_a uuid; v_etapa_ganha_a uuid; v_etapa_aberta_a uuid;
  v_funil_b uuid; v_etapa_ganha_b uuid; v_etapa_aberta_b uuid;
  v_funil_c uuid; v_etapa_ganha_c uuid; v_etapa_aberta_c uuid;
  v_funil_d uuid; v_etapa_ganha_d uuid; v_etapa_aberta_d uuid; -- NÃO faz parte do trio A/B/C

  v_cliente uuid; v_neg uuid;
  v_cliente_funil_a uuid;
  v_linha record;
  v_erro text;
  v_total integer;

  v_inicio date := '2026-10-01';
  v_fim    date := '2026-10-31';

  -- Linha de base (ANTES das fixtures): esta é uma sessão contra o banco
  -- real, que já pode ter vendas genuínas de outubro/2026 — a linha da
  -- EMPRESA soma TODO MUNDO, então os asserts de GERAL comparam a
  -- DIFERENÇA antes/depois (delta), nunca um total absoluto. v_pessoa_a/
  -- v_pessoa_b são perfis novos, sem nenhuma venda prévia — os asserts
  -- INDIVIDUAIS comparam o total absoluto deles, sem precisar de delta.
  v_tcv_geral_antes numeric;
  v_mrr_geral_antes numeric;

  -- Helper inline via variável — cada venda é um bloco de 3 inserts
  -- (cliente -> negociação -> fechamento), repetido explicitamente (mesmo
  -- padrão de todos os outros testes deste projeto, sem função auxiliar).
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.realizado@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Realizado"}'::jsonb),
    (v_pessoa_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pessoa.a.realizado@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Pessoa A"}'::jsonb),
    (v_pessoa_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pessoa.b.realizado@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Pessoa B"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Funil A Realizado', false) returning id into v_funil_a;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_a, 'Aberta A', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_a;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_a, 'Ganha A', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_a;

  insert into public.funis (nome, padrao) values ('Funil B Realizado', false) returning id into v_funil_b;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_b, 'Aberta B', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_b;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_b, 'Ganha B', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_b;

  insert into public.funis (nome, padrao) values ('Funil C Realizado', false) returning id into v_funil_c;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_c, 'Aberta C', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_c;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_c, 'Ganha C', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_c;

  insert into public.funis (nome, padrao) values ('Funil D Realizado (nao selecionado)', false) returning id into v_funil_d;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_d, 'Aberta D', 'azul', 1000, 'aberta') returning id into v_etapa_aberta_d;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_d, 'Ganha D', 'verde', 100000, 'ganha') returning id into v_etapa_ganha_d;

  -- -------------------------------------------------------------------
  -- Linha de base da EMPRESA (outubro/2026), ANTES de qualquer fixture —
  -- este é o banco real, pode já ter vendas genuínas no período.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo(v_inicio, v_fim) where usuario_id is null;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  v_tcv_geral_antes := coalesce(v_linha.realizado_tcv, 0);
  v_mrr_geral_antes := coalesce(v_linha.realizado_mrr, 0);

  -- -------------------------------------------------------------------
  -- FUNIL A: TCV R$ 1.000 — Pessoa A, dentro do período.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil A', '11900000061', v_pessoa_a) returning id into v_cliente;
  v_cliente_funil_a := v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_a, v_etapa_ganha_a, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 1000, true, true, 'pago', 'concluido', '2026-10-10', 'tcv', v_pessoa_a);

  -- -------------------------------------------------------------------
  -- FUNIL B: TCV R$ 2.000 — Pessoa A, dentro do período.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil B', '11900000062', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_b, v_etapa_ganha_b, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 2000, true, true, 'pago', 'concluido', '2026-10-15', 'tcv', v_pessoa_a);

  -- -------------------------------------------------------------------
  -- FUNIL C: TCV R$ 3.000 — Pessoa B, dentro do período.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil C', '11900000063', v_pessoa_b) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_c, v_etapa_ganha_c, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 3000, true, true, 'pago', 'concluido', '2026-10-20', 'tcv', v_pessoa_b);

  -- -------------------------------------------------------------------
  -- FUNIL D: TCV R$ 999.999 — Pessoa A, mas FORA do período (set. 2026).
  -- Nunca deveria entrar em nenhuma soma deste teste.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Funil D Fora Periodo', '11900000064', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_d, v_etapa_ganha_d, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 999999, true, true, 'pago', 'concluido', '2026-09-15', 'tcv', v_pessoa_a);

  -- -------------------------------------------------------------------
  -- Venda SEM tipo_venda (histórico "não classificado") — dentro do
  -- período, Pessoa A. Nunca deve entrar em TCV nem em MRR. O trigger
  -- `fechamentos_exige_tipo_venda_novo` só roda no INSERT (exige o tipo em
  -- toda venda NOVA) — pra simular uma venda histórica "não classificada"
  -- (como as que já existiam antes da migration que criou a coluna),
  -- insere com um tipo válido e depois reclassifica para null via UPDATE
  -- (o trigger de INSERT não se aplica a UPDATE).
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Sem Tipo Venda', '11900000065', v_pessoa_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_a, v_etapa_ganha_a, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 777, true, true, 'pago', 'concluido', '2026-10-12', 'tcv', v_pessoa_a);
  update public.fechamentos set tipo_venda = null where negociacao_id = v_neg;

  -- -------------------------------------------------------------------
  -- MRR separado — Pessoa B, R$ 500, dentro do período (funil A).
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente MRR Pessoa B', '11900000066', v_pessoa_b) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil_a, v_etapa_ganha_a, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 500, true, true, 'pago', 'concluido', '2026-10-22', 'mrr', v_pessoa_b);

  -- -------------------------------------------------------------------
  -- Responsável diferente do owner_id ATUAL: transfere a carteira do
  -- cliente do Funil A/Pessoa A DEPOIS do fechamento — fechamentos.
  -- responsavel_id fica congelado em Pessoa A (quem era owner no momento
  -- do fechamento), nunca muda para o novo dono.
  -- -------------------------------------------------------------------
  update public.clientes set owner_id = v_pessoa_b where id = v_cliente_funil_a;

  -- -------------------------------------------------------------------
  -- GERAL (gerente) — TCV = 1000+2000+3000 = 6000 (D e "sem tipo" fora).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo(v_inicio, v_fim) where usuario_id is null;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_tcv - v_tcv_geral_antes = 6000,
    format('GERAL TCV deveria crescer 6000, cresceu %s', v_linha.realizado_tcv - v_tcv_geral_antes);
  insert into _log (passo) values ('ok  1  GERAL considera todos os funis (A+B+C = +6000), ignora D (fora do período) e a venda sem tipo_venda');

  -- -------------------------------------------------------------------
  -- INDIVIDUAL A — TCV = 1000 (Funil A) + 2000 (Funil B) = 3000.
  -- Mesmo depois da transferência de carteira acima: responsavel_id
  -- continua sendo Pessoa A (congelado no fechamento).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_a, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo(v_inicio, v_fim) where usuario_id = v_pessoa_a;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_tcv = 3000, format('INDIVIDUAL A TCV deveria ser 3000, veio %s', v_linha.realizado_tcv);
  insert into _log (passo) values ('ok  2  INDIVIDUAL A considera todos os funis (A+B = 3000), não depende de funil selecionado');
  insert into _log (passo) values ('ok  responsavel_id permanece Pessoa A mesmo após transferência de carteira (owner_id mudou, responsavel_id não)');

  -- -------------------------------------------------------------------
  -- INDIVIDUAL B — TCV = 3000 (Funil C).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_b, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo(v_inicio, v_fim) where usuario_id = v_pessoa_b;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_tcv = 3000, format('INDIVIDUAL B TCV deveria ser 3000, veio %s', v_linha.realizado_tcv);
  assert v_linha.realizado_mrr = 500, format('INDIVIDUAL B MRR deveria ser 500, veio %s', v_linha.realizado_mrr);
  insert into _log (passo) values ('ok  3  INDIVIDUAL B = 3000 TCV (Funil C) + 500 MRR, TCV e MRR nunca somados juntos');

  -- -------------------------------------------------------------------
  -- MRR geral (gerente) = 500 (só a venda MRR da Pessoa B).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo(v_inicio, v_fim) where usuario_id is null;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_mrr - v_mrr_geral_antes = 500,
    format('GERAL MRR deveria crescer 500, cresceu %s', v_linha.realizado_mrr - v_mrr_geral_antes);
  insert into _log (passo) values ('ok  4  MRR testado separadamente do TCV (geral cresceu +500)');

  -- -------------------------------------------------------------------
  -- Período SEM vendas (novembro) — tudo zero, sem erro.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo('2026-11-01', '2026-11-30') where usuario_id is null;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_tcv = 0 and v_linha.realizado_mrr = 0, 'período sem vendas deveria devolver 0, não erro';
  insert into _log (passo) values ('ok  5  período sem vendas -> 0/0, sem erro');

  -- -------------------------------------------------------------------
  -- Período parcial (só 10-16/10), individual Pessoa A (sem risco de dado
  -- real pré-existente, perfil novo) — só a venda do Funil A (dia 10) e a
  -- "sem tipo_venda" (dia 12, ignorada) entram; Funil B (dia 15) também
  -- entra (15 está dentro de 10-16).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa_a, 'role', 'authenticated')::text, true);
  set role authenticated;
  select * into v_linha from public.realizado_periodo('2026-10-10', '2026-10-16') where usuario_id = v_pessoa_a;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_tcv = 3000, format('período parcial deveria somar só A+B = 3000, veio %s', v_linha.realizado_tcv);
  assert v_linha.realizado_mrr = 0, 'período parcial não deveria incluir o MRR do dia 22';
  insert into _log (passo) values ('ok  6  período personalizado (10-16/10) respeita as datas, soma só o que está dentro');

  -- -------------------------------------------------------------------
  -- Nenhuma venda duplicada: cardinalidade fechamentos (PK = negociacao_id,
  -- 1:1) já garante isso no schema; confirmando a contagem de linhas da
  -- venda do Funil A.
  -- -------------------------------------------------------------------
  select count(*) into v_total from public.fechamentos where valor_vendido = 1000 and tipo_venda = 'tcv';
  assert v_total = 1, 'a venda do Funil A não deveria estar duplicada';
  insert into _log (passo) values ('ok  7  nenhuma venda duplicada (fechamentos é 1:1 com negociação, PK garante)');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - realizado_periodo.');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
