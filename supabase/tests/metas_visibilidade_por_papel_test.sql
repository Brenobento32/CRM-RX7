-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) da migration 20261016200000
-- (visibilidade de metas por papel) — auto-instalada aqui (função + policy),
-- rollback no fim. Usuários reais simulados: GERENTE, SDR, CLOSER A,
-- CLOSER B — nunca só `postgres`.
--
-- MAPA (checklist pedido nesta rodada)
--   1  GERENTE recebe geral + individuais (das duas pessoas).
--   2  SDR recebe geral.
--   3  SDR NÃO recebe NENHUMA linha individual.
--   4  SDR não recebe nome + realizado de closer_a/closer_b especificamente.
--   5  SDR não recebe meta individual (via tabela `metas` direto, RLS).
--   6  CLOSER recebe geral.
--   7  CLOSER recebe somente a própria linha individual.
--   8  CLOSER não recebe a linha de outro CLOSER.
--   9  TCV/MRR continuam separados (sanidade, matemática intocada).
--   10 Meta da empresa (geral) continua legível por todos via `metas`
--      direto — meta individual de OUTRA pessoa continua bloqueada.
-- ===========================================================================

begin;

drop policy if exists metas_select on public.metas;
create policy metas_select on public.metas
  for select
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or usuario_id is null
    or public.is_gerente()
  );

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
    mt.id, mm.id, null::uuid, null::text, null::public.user_role, null::boolean,
    mt.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    mm.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  from mes
  left join public.metas mt on mt.usuario_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm on mm.usuario_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'

  union all

  select
    mt.id, mm.id, p.id, p.nome, p.role, p.ativo,
    mt.valor_meta, coalesce(vt.valor, 0), mm.valor_meta, coalesce(vm.valor, 0)
  from public.profiles p
  cross join mes
  left join public.metas mt on mt.usuario_id = p.id and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm on mm.usuario_id = p.id and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
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

  union all

  select
    p.id, p.nome, p.role, p.ativo,
    coalesce(vt.valor, 0), coalesce(vm.valor, 0)
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

create temp table _log (id serial primary key, passo text);

do $$
declare
  v_gerente   uuid := 'd5000000-0000-0000-0000-000000000001';
  v_sdr       uuid := 'd5000000-0000-0000-0000-000000000002';
  v_closer_a  uuid := 'd5000000-0000-0000-0000-000000000003';
  v_closer_b  uuid := 'd5000000-0000-0000-0000-000000000004';

  v_funil uuid; v_etapa_aberta uuid; v_etapa_ganha uuid;
  v_cliente uuid; v_neg uuid;

  -- Mês bem distante de qualquer dado real, pra nunca colidir com uma meta
  -- da empresa já cadastrada em produção (metas_uma_por_mes é única por
  -- mês) — o teste é sobre AUTORIZAÇÃO, o mês em si é só um rótulo.
  v_mes date := '2030-01-01';
  v_meta_empresa_id uuid;
  v_meta_closer_a_id uuid;

  v_total_linhas integer;
  v_linha record;
  v_tcv_empresa_antes numeric;
  v_mrr_empresa_antes numeric;
  v_erro text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.visib@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Visib"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.visib@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Visib"}'::jsonb),
    (v_closer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.a.visib@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer A Visib"}'::jsonb),
    (v_closer_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.b.visib@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer B Visib"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Visibilidade Metas', false) returning id into v_funil;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Aberta Visib', 'azul', 1000, 'aberta') returning id into v_etapa_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Ganha Visib', 'verde', 100000, 'ganha') returning id into v_etapa_ganha;

  -- Linha de base da empresa (banco real pode já ter vendas/metas de
  -- outubro/2026) — asserts de GERAL usam delta, igual às rodadas anteriores.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  select realizado_tcv, realizado_mrr into v_tcv_empresa_antes, v_mrr_empresa_antes
    from public.metas_progresso(v_mes) where usuario_id is null;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- Meta da empresa (TCV) e meta individual de closer_a (TCV), mês de teste.
  insert into public.metas (usuario_id, periodo_mes, valor_meta, tipo_meta, criado_por)
    values (null, v_mes, 50000, 'tcv', v_gerente) returning id into v_meta_empresa_id;
  insert into public.metas (usuario_id, periodo_mes, valor_meta, tipo_meta, criado_por)
    values (v_closer_a, v_mes, 10000, 'tcv', v_gerente) returning id into v_meta_closer_a_id;

  -- Venda de closer_a (TCV 1000) e closer_b (TCV 2000), dentro do mês de teste.
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Visib A', '11900000081', v_closer_a) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil, v_etapa_ganha, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 1000, true, true, 'pago', 'concluido', '2030-01-10', 'tcv', v_closer_a);

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Visib B', '11900000082', v_closer_b) returning id into v_cliente;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, origem) values
    (v_cliente, v_funil, v_etapa_ganha, 'manual') returning id into v_neg;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, data_fechamento, tipo_venda, fechado_por
  ) values (v_neg, 2000, true, true, 'pago', 'concluido', '2030-01-11', 'tcv', v_closer_b);

  -- -------------------------------------------------------------------
  -- 1. GERENTE recebe geral + individuais (closer_a E closer_b).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;

  select realizado_tcv into v_linha from public.metas_progresso(v_mes) where usuario_id is null;
  assert v_linha.realizado_tcv - v_tcv_empresa_antes = 3000,
    format('gerente: geral TCV deveria crescer 3000 (1000+2000), cresceu %s', v_linha.realizado_tcv - v_tcv_empresa_antes);

  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id = v_closer_a;
  assert v_total_linhas = 1, 'gerente deveria ver a linha de closer_a';
  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id = v_closer_b;
  assert v_total_linhas = 1, 'gerente deveria ver a linha de closer_b';

  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  1  GERENTE recebe geral (+3000) e as linhas individuais de closer_a E closer_b');

  -- -------------------------------------------------------------------
  -- 2/3/4. SDR recebe geral, mas NENHUMA linha individual (nem a própria,
  -- nem a de closer_a/closer_b).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  set role authenticated;

  select realizado_tcv into v_linha from public.metas_progresso(v_mes) where usuario_id is null;
  assert v_linha.realizado_tcv - v_tcv_empresa_antes = 3000,
    format('SDR: geral TCV deveria crescer 3000, cresceu %s', v_linha.realizado_tcv - v_tcv_empresa_antes);

  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id is not null;
  assert v_total_linhas = 0, format('SDR não deveria receber NENHUMA linha individual, recebeu %s', v_total_linhas);

  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id = v_closer_a;
  assert v_total_linhas = 0, 'SDR não deveria ver a linha de closer_a';
  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id = v_closer_b;
  assert v_total_linhas = 0, 'SDR não deveria ver a linha de closer_b';

  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  2/3/4  SDR recebe geral (+3000), zero linhas individuais (nem closer_a, nem closer_b)');

  -- -------------------------------------------------------------------
  -- 5. SDR não recebe meta INDIVIDUAL via tabela `metas` direto (RLS) —
  -- meta da EMPRESA continua legível.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  set role authenticated;
  select count(*) into v_total_linhas from public.metas where id = v_meta_closer_a_id;
  assert v_total_linhas = 0, 'SDR não deveria conseguir ler a meta individual de closer_a';
  select count(*) into v_total_linhas from public.metas where id = v_meta_empresa_id;
  assert v_total_linhas = 1, 'SDR deveria conseguir ler a meta da empresa (geral, sem PII)';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  5  SDR não lê meta individual de closer_a via tabela metas, mas lê a meta da empresa');

  -- -------------------------------------------------------------------
  -- 6/7/8. CLOSER A recebe geral + SÓ a própria linha, nunca a de closer_b.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  set role authenticated;

  select realizado_tcv into v_linha from public.metas_progresso(v_mes) where usuario_id is null;
  assert v_linha.realizado_tcv - v_tcv_empresa_antes = 3000,
    format('closer_a: geral TCV deveria crescer 3000, cresceu %s', v_linha.realizado_tcv - v_tcv_empresa_antes);

  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id is not null;
  assert v_total_linhas = 1, format('closer_a deveria receber EXATAMENTE 1 linha individual (a própria), recebeu %s', v_total_linhas);

  select realizado_tcv into v_linha from public.metas_progresso(v_mes) where usuario_id = v_closer_a;
  assert v_linha.realizado_tcv = 1000, format('closer_a deveria ver o próprio realizado (1000), veio %s', v_linha.realizado_tcv);

  select count(*) into v_total_linhas from public.metas_progresso(v_mes) where usuario_id = v_closer_b;
  assert v_total_linhas = 0, 'closer_a NÃO deveria ver a linha de closer_b';

  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  6/7/8  CLOSER A recebe geral (+3000) + só a própria linha (1000), nunca a de closer_b');

  -- -------------------------------------------------------------------
  -- 9. TCV/MRR continuam separados (sanidade — matemática intocada).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  set role authenticated;
  select realizado_tcv, realizado_mrr into v_linha from public.metas_progresso(v_mes) where usuario_id = v_closer_a;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert v_linha.realizado_tcv = 1000 and v_linha.realizado_mrr = 0,
    format('closer_a: esperava TCV=1000/MRR=0, veio TCV=%s/MRR=%s', v_linha.realizado_tcv, v_linha.realizado_mrr);
  insert into _log (passo) values ('ok  9  TCV e MRR continuam separados (closer_a: TCV=1000, MRR=0)');

  -- -------------------------------------------------------------------
  -- 10. Meta da empresa (geral) legível por gerente/SDR/closer; meta
  -- individual de closer_a só por ele mesmo ou gerente.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  set role authenticated;
  select count(*) into v_total_linhas from public.metas where id = v_meta_closer_a_id;
  assert v_total_linhas = 0, 'closer_b não deveria ler a meta individual de closer_a';
  select count(*) into v_total_linhas from public.metas where id = v_meta_empresa_id;
  assert v_total_linhas = 1, 'closer_b deveria ler a meta da empresa';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  10  meta da empresa legível por qualquer um; meta individual de outro CLOSER continua bloqueada');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - visibilidade de metas por papel.');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
