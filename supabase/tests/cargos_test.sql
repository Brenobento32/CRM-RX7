-- ===========================================================================
-- Teste das propostas de cargos (100000 → 100300), POR CARGO E ENTRE EMPRESAS.
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com as quatro propostas
-- aplicadas. Termina em ROLLBACK. Nunca rodar no Supabase real.
--
--  1  cada cargo tem papel próprio (Vendedor ≠ Closer, Atendente ≠ SDR) e
--     ninguém "vira gerente" na lista da equipe
--  2  Atendente: move só entre etapas liberadas, só o que é dele/da carteira,
--     não fecha, não perde, não transfere, não passa do teto
--  3  ninguém aumenta o próprio privilégio (etapas, permissões, vínculo)
--  4  SDR/Atendente agendam para Closer ativo da empresa; nunca para outro
--     cargo nem outra empresa; quem criou fica registrado (não forjável)
--  5  Closer conduz a reunião que o SDR marcou (status, vínculo do lead)
--  6  ocupação dos Closers: só horários, só para quem agenda, só da empresa
--  7  Vendedor: ciclo completo (sem teto), meta TCV/MRR; não agenda p/ outros
--  8  metas de reuniões do SDR: quem configura, quem vê, como conta
--  9  dados da empresa: Gerente só contato/logo; nunca nome/slug/outra empresa
-- 10  quem já tinha acesso continua igual (Closer, SDR, histórico)
-- ===========================================================================

begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

create function public._como(p_uid uuid, p_slug text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._como(uuid, text) to authenticated;

create temp table _historico as
select count(*) as n, md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) as h
  from public.eventos e where escopo = 'legado';
grant select on _historico to authenticated;

do $$
declare
  u_super uuid := '70000000-0000-4000-8000-0000000000ff';
  g_a   uuid := '70000000-0000-4000-8000-0000000000a1';  -- admin_empresa A
  g2_a  uuid := '70000000-0000-4000-8000-0000000000a6';  -- gerente (não admin) A
  sdr_a uuid := '70000000-0000-4000-8000-0000000000a2';
  clo_a uuid := '70000000-0000-4000-8000-0000000000a3';
  ven_a uuid := '70000000-0000-4000-8000-0000000000a4';
  ate_a uuid := '70000000-0000-4000-8000-0000000000a5';
  g_b   uuid := '70000000-0000-4000-8000-0000000000b1';
  clo_b uuid := '70000000-0000-4000-8000-0000000000b2';
  t_a uuid; t_b uuid; f_a uuid;
  e_novo uuid; e_agendada uuid; e_realizada uuid; e_fechado uuid;
  c_ate uuid; c_clo uuid; n_ate uuid; n_clo uuid;
  ev uuid; v_n bigint; v_txt text; v_ok boolean;
begin
  insert into auth.users (id, email)
  select x, 'cargo-' || right(x::text, 2) || '@teste.invalid' from unnest(array[u_super, g_a, g2_a, sdr_a, clo_a, ven_a, ate_a, g_b, clo_b]) x;
  insert into public.profiles (id, nome, email, role)
  select u.id, 'Teste ' || right(u.id::text, 2), u.email, 'closer' from auth.users u where u.email like 'cargo-%@teste.invalid'
  on conflict (id) do nothing;
  update public.profiles set ativo = true where email like 'cargo-%@teste.invalid';
  insert into public.super_admins (user_id) values (u_super);

  perform public._como(u_super, null);
  t_a := public.provisionar_tenant('Cargos A', 'cargos-a', 'assinante', g_a);
  t_b := public.provisionar_tenant('Cargos B', 'cargos-b', 'assinante', g_b);
  perform set_config('role', 'postgres', true);
  perform public.garantir_estrutura_inicial(t_a, g_a);
  perform public.garantir_estrutura_inicial(t_b, g_b);
  insert into public.tenant_memberships (tenant_id, user_id, papel) values
    (t_a, g2_a, 'gerente'), (t_a, sdr_a, 'sdr'), (t_a, clo_a, 'closer'), (t_a, ven_a, 'vendedor'),
    (t_a, ate_a, 'atendente'), (t_b, clo_b, 'closer');

  select id into f_a from public.funis where tenant_id = t_a order by padrao desc limit 1;
  select id into e_novo     from public.etapas_funil where funil_id = f_a and etapa_inicial;
  select id into e_agendada from public.etapas_funil where funil_id = f_a and chave = 'reuniao_agendada';
  select id into e_realizada from public.etapas_funil where funil_id = f_a and chave = 'reuniao_realizada';
  select id into e_fechado  from public.etapas_funil where funil_id = f_a and tipo = 'ganha';

  -- Permissões individuais (ver/mover) para todos os não-gerentes: assim o
  -- teste isola as regras NOVAS de cada cargo.
  perform public._como(g_a, 'cargos-a');
  for v_txt in select x::text from unnest(array[sdr_a, clo_a, ven_a, ate_a]) x loop
    perform public.salvar_permissoes_colaborador(v_txt::uuid, (
      select jsonb_agg(p) from (
        select jsonb_build_object('funil_id', f_a, 'etapa_id', null, 'pode_ver', null, 'pode_mover', null) p
        union all
        select jsonb_build_object('funil_id', f_a, 'etapa_id', e.id, 'pode_ver', true, 'pode_mover', true)
          from public.etapas_funil e where e.funil_id = f_a and e.ativo) s));
  end loop;
  c_ate := public.criar_cliente('pessoa_fisica', 'Lead da Atendente', p_telefone => '11955550001', p_owner_id => ate_a, p_funil_id => f_a);
  c_clo := public.criar_cliente('pessoa_fisica', 'Lead do Closer', p_telefone => '11955550002', p_owner_id => clo_a, p_funil_id => f_a);
  select id into n_ate from public.negociacoes where cliente_id = c_ate;
  select id into n_clo from public.negociacoes where cliente_id = c_clo;

  -- 1. papéis próprios ---------------------------------------------------------
  perform set_config('role', 'postgres', true);
  assert public.papel_comercial(ven_a, t_a) = 'vendedor', 'vendedor tem papel próprio';
  assert public.papel_comercial(ate_a, t_a) = 'atendente', 'atendente tem papel próprio';
  perform public._como(g_a, 'cargos-a');
  select string_agg(role::text, ',' order by role::text) into v_txt from public.membros_empresa_atual()
   where usuario_id in (ven_a, ate_a);
  assert v_txt = 'atendente,vendedor', 'equipe: vendedor/atendente não podem aparecer como gerente (veio ' || coalesce(v_txt, 'nulo') || ')';
  raise notice 'ok 1 cargos próprios; ninguém vira gerente por acidente';

  -- 2. Atendente ---------------------------------------------------------------
  perform public._como(ate_a, 'cargos-a');
  begin
    perform public.mover_negociacao(n_ate, e_agendada, 1);
    assert false, 'sem etapa liberada, atendente não move';
  exception when insufficient_privilege then null; end;

  perform public._como(g_a, 'cargos-a');
  update public.etapas_funil set atendente_pode_mover = true where id in (e_novo, e_agendada, e_realizada);
  begin
    update public.etapas_funil set atendente_pode_mover = true where id = e_fechado;
    assert false, 'etapa de fechamento nunca é liberada para atendente';
  exception when check_violation then null; end;

  perform public._como(ate_a, 'cargos-a');
  perform public.mover_negociacao(n_ate, e_agendada, 1);
  assert (select etapa_id from public.negociacoes where id = n_ate) = e_agendada, 'atendente move a própria negociação entre etapas liberadas';
  perform public.mover_negociacao(n_ate, e_realizada, 1);
  begin
    perform public.mover_negociacao(n_clo, e_agendada, 1);
    assert false, 'atendente não move negociação de outro responsável';
  exception when insufficient_privilege then null; end;
  -- Transferir: o responsável da negociação é sempre o dono do cliente
  -- (trigger negociacoes_owner_do_cliente); a tentativa não muda nada.
  begin
    update public.negociacoes set owner_id = clo_a where id = n_ate;
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
  assert (select owner_id from public.negociacoes where id = n_ate) = ate_a, 'atendente não transfere responsável';
  perform public._como(ate_a, 'cargos-a');
  begin
    perform public.desqualificar_negociacao(n_ate, 'teste');
    assert false, 'atendente não desqualifica/arquiva';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fechar_negociacao(n_ate, 1, 1000, current_date, false, false, 'pendente', 'nao_iniciado', null, null, null, 'tcv');
    assert false, 'atendente não fecha venda';
  exception when insufficient_privilege or check_violation or raise_exception then null; end;
  -- Atalho pela API: gravar o fechamento direto na tabela ou apagar a negociação.
  begin
    insert into public.fechamentos (negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
                                    status_pagamento, status_onboarding, data_fechamento, responsavel_id, tipo_venda)
    values (n_ate, 1000, false, false, 'pendente', 'nao_iniciado', current_date, ate_a, 'tcv');
    assert false, 'atendente não grava fechamento direto na tabela';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.negociacoes where id = n_ate;
    assert false, 'atendente não exclui negociação';
  exception when insufficient_privilege then null; end;
  begin
    update public.clientes set deleted_at = now() where id = c_ate;
    assert false, 'atendente não arquiva o cliente (encerraria as negociações)';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
  assert exists (select 1 from public.negociacoes where id = n_ate), 'negociação da atendente continua lá';
  assert (select deleted_at from public.clientes where id = c_ate) is null, 'cliente da atendente continua ativo';
  perform public._como(sdr_a, 'cargos-a');
  begin
    insert into public.fechamentos (negociacao_id, valor_vendido, contrato_enviado, contrato_assinado,
                                    status_pagamento, status_onboarding, data_fechamento, responsavel_id, tipo_venda)
    values (n_ate, 1000, false, false, 'pendente', 'nao_iniciado', current_date, sdr_a, 'tcv');
    assert false, 'SDR não grava fechamento direto na tabela';
  exception when insufficient_privilege then null; end;
  perform public._como(g_a, 'cargos-a');
  update public.etapas_funil set atendente_pode_mover = false where id = e_agendada;
  perform public._como(ate_a, 'cargos-a');
  begin
    perform public.mover_negociacao(n_ate, e_agendada, 1);
    assert false, 'etapa desligada pelo gerente: atendente não move mais';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 2 atendente: só etapas liberadas, só o dele, não fecha/perde/transfere';

  -- 3. ninguém aumenta o próprio privilégio ------------------------------------
  update public.etapas_funil set atendente_pode_mover = true where id = e_agendada;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'atendente não libera etapa para si';
  begin
    insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
    values (ate_a, f_a, e_fechado, true, true);
    assert false, 'atendente não cria permissão para si';
  exception when insufficient_privilege then null; end;
  begin
    update public.tenant_memberships set papel = 'admin_empresa' where user_id = ate_a and tenant_id = t_a;
    get diagnostics v_n = row_count;
    assert v_n = 0, 'atendente não muda o próprio vínculo';
  exception when insufficient_privilege then null; end;
  begin
    perform public.definir_membro_tenant(t_a, ate_a, 'admin_empresa');
    assert false, 'atendente não se promove pela RPC';
  exception when insufficient_privilege or raise_exception then null; end;
  perform public._como(sdr_a, 'cargos-a');
  begin
    update public.tenant_memberships set papel = 'gerente' where user_id = sdr_a and tenant_id = t_a;
    get diagnostics v_n = row_count;
    assert v_n = 0, 'SDR não se promove';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
  assert public.papel_comercial(ate_a, t_a) = 'atendente' and public.papel_comercial(sdr_a, t_a) = 'sdr', 'papéis intactos';
  raise notice 'ok 3 ninguém aumenta o próprio privilégio';

  -- 4. agendar para Closer -----------------------------------------------------
  perform public._como(sdr_a, 'cargos-a');
  insert into public.eventos (titulo, inicio, fim, usuario_id, criado_por)
  values ('SDR para Closer', now() + interval '1 day', now() + interval '1 day 1 hour', clo_a, g_a)
  returning id into ev;
  perform set_config('role', 'postgres', true);
  assert (select criado_por from public.eventos where id = ev) = sdr_a, 'criado_por é quem agendou (não forjável)';
  perform public._como(sdr_a, 'cargos-a');
  assert exists (select 1 from public.eventos where id = ev), 'SDR vê a reunião que marcou para o closer';
  for v_txt in select x::text from unnest(array[ven_a, g_a, ate_a, clo_b]) x loop
    begin
      insert into public.eventos (titulo, inicio, fim, usuario_id)
      values ('Indevida', now() + interval '1 day', now() + interval '1 day 1 hour', v_txt::uuid);
      assert false, 'SDR só agenda para Closer da empresa (tentou ' || v_txt || ')';
    exception when insufficient_privilege or check_violation then null; end;
  end loop;
  perform public._como(ate_a, 'cargos-a');
  insert into public.eventos (titulo, inicio, fim, usuario_id, cliente_id)
  values ('Atendente passa lead ao Closer', now() + interval '2 day', now() + interval '2 day 30 min', clo_a, c_ate);
  perform public._como(ven_a, 'cargos-a');
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Vendedor para closer', now() + interval '1 day', now() + interval '1 day 1 hour', clo_a);
    assert false, 'vendedor não agenda para outra pessoa';
  exception when insufficient_privilege or check_violation then null; end;
  perform public._como(clo_a, 'cargos-a');
  begin
    insert into public.eventos (titulo, inicio, fim, usuario_id)
    values ('Closer para SDR', now() + interval '1 day', now() + interval '1 day 1 hour', sdr_a);
    assert false, 'closer não agenda para outra pessoa';
  exception when insufficient_privilege or check_violation then null; end;
  raise notice 'ok 4 SDR/Atendente agendam só para Closer ativo da empresa; criado_por confiável';

  -- 5. Closer conduz a reunião marcada pelo SDR/Atendente ----------------------
  perform public._como(clo_a, 'cargos-a');
  perform public.alterar_status_evento(ev, 'realizado');
  select id into ev from public.eventos where titulo = 'Atendente passa lead ao Closer';
  perform public.alterar_status_evento(ev, 'confirmado');
  assert (select status from public.eventos where id = ev) = 'confirmado', 'closer atualiza reunião com o lead da atendente';
  raise notice 'ok 5 closer conduz a reunião que recebeu';

  -- 6. ocupação ----------------------------------------------------------------
  perform public._como(sdr_a, 'cargos-a');
  select count(*) into v_n from public.agenda_ocupacao(now(), now() + interval '7 days') where usuario_id = clo_a;
  assert v_n >= 2, 'SDR vê a ocupação do closer (veio ' || v_n || ')';
  perform public._como(clo_a, 'cargos-a');
  select count(*) into v_n from public.agenda_ocupacao(now(), now() + interval '7 days') where usuario_id <> clo_a;
  assert v_n = 0, 'closer não consulta ocupação de outros';
  perform public._como(g_b, 'cargos-b');
  select count(*) into v_n from public.agenda_ocupacao(now(), now() + interval '7 days') where usuario_id = clo_a;
  assert v_n = 0, 'gerente de B não vê ocupação de A';
  perform public._como(g_b, 'cargos-a');
  select count(*) into v_n from public.agenda_ocupacao(now(), now() + interval '7 days');
  assert v_n = 0, 'header de A forjado por B: nada';
  raise notice 'ok 6 ocupação: só horários, só para quem agenda, só da empresa';

  -- 7. Vendedor ----------------------------------------------------------------
  perform public._como(g_a, 'cargos-a');
  insert into public.metas (tenant_id, usuario_id, periodo_mes, valor_meta, tipo_meta) values (t_a, ven_a, date_trunc('month', now())::date, 5000, 'tcv');
  begin
    insert into public.metas (tenant_id, usuario_id, periodo_mes, valor_meta, tipo_meta) values (t_a, ate_a, date_trunc('month', now())::date, 5000, 'tcv');
    assert false, 'meta TCV/MRR não é para atendente';
  exception when check_violation then null; end;
  perform public._como(ven_a, 'cargos-a');
  select count(*) into v_n from public.metas_progresso(current_date) where usuario_id = ven_a and valor_meta_tcv = 5000;
  assert v_n = 1, 'vendedor vê a própria meta TCV';
  perform public._como(g_a, 'cargos-a');
  c_clo := public.criar_cliente('pessoa_fisica', 'Lead do Vendedor', p_telefone => '11955550004', p_owner_id => ven_a, p_funil_id => f_a);
  select id into n_clo from public.negociacoes where cliente_id = c_clo;
  perform public._como(ven_a, 'cargos-a');
  perform public.mover_negociacao(n_clo, e_realizada, 1);
  perform public.fechar_negociacao(n_clo, 1, 2000, current_date, false, false, 'pendente', 'nao_iniciado', null, null, null, 'tcv');
  assert (select etapa_id from public.negociacoes where id = n_clo) = e_fechado, 'vendedor fecha a própria venda (sem teto de handoff)';
  raise notice 'ok 7 vendedor: ciclo completo, meta TCV; não agenda para outros';

  -- 8. metas de reuniões -------------------------------------------------------
  perform public._como(g_a, 'cargos-a');
  insert into public.metas_reunioes (usuario_id, periodo_mes, meta_agendadas, meta_realizadas)
  values (sdr_a, date_trunc('month', now())::date, 10, 4);
  begin
    insert into public.metas_reunioes (usuario_id, periodo_mes, meta_agendadas) values (clo_a, date_trunc('month', now())::date, 3);
    assert false, 'meta de reuniões é só para SDR';
  exception when check_violation then null; end;
  perform public._como(sdr_a, 'cargos-a');
  begin
    insert into public.metas_reunioes (usuario_id, periodo_mes, meta_agendadas) values (sdr_a, (date_trunc('month', now()) + interval '1 month')::date, 1);
    assert false, 'SDR não define a própria meta';
  exception when insufficient_privilege then null; end;
  -- série de 3 ocorrências para o closer (conta 1), reunião interna (não conta), cancelada (não conta)
  perform public.criar_serie_eventos('Série com o closer', 'reuniao', 'agendado', null, null, clo_a, null,
    current_date + 1, time '09:00', 30, 'diaria', 1, null, null, null, 3);
  insert into public.eventos (titulo, inicio, fim, usuario_id) values ('Interna', now() + interval '3 day', now() + interval '3 day 15 min', sdr_a);
  insert into public.eventos (titulo, inicio, fim, usuario_id, status) values ('Cancelada', now() + interval '3 day', now() + interval '3 day 15 min', clo_a, 'cancelado');
  select agendadas, realizadas, meta_agendadas into v_n, v_n, v_n from public.metas_reunioes_progresso(current_date) where usuario_id = sdr_a;
  select format('%s/%s meta %s', agendadas, realizadas, meta_agendadas) into v_txt
    from public.metas_reunioes_progresso(current_date) where usuario_id = sdr_a;
  -- agendadas: 'SDR para Closer' + série (1) = 2 ; realizadas: 'SDR para Closer' (se o início cair no mês)
  assert v_txt like '2/% meta 10', 'contagem do SDR: ' || coalesce(v_txt, 'nulo');
  select count(*) into v_n from public.metas_reunioes_progresso(current_date);
  assert v_n = 1, 'SDR vê só a própria meta';
  perform public._como(clo_a, 'cargos-a');
  select count(*) into v_n from public.metas_reunioes_progresso(current_date);
  assert v_n = 0, 'closer não vê metas de reuniões';
  perform public._como(g_b, 'cargos-b');
  select count(*) into v_n from public.metas_reunioes_progresso(current_date) where usuario_id = sdr_a;
  assert v_n = 0, 'gerente de B não vê o SDR de A';
  perform public._como(g2_a, 'cargos-a');
  select count(*) into v_n from public.metas_reunioes_progresso(current_date) where usuario_id = sdr_a;
  assert v_n = 1, 'gerente (não admin) vê a equipe';
  raise notice 'ok 8 metas de reuniões: % (série conta 1x; interna e cancelada não contam)', v_txt;

  -- 9. dados da empresa --------------------------------------------------------
  perform public._como(g_a, 'cargos-a');
  perform public.empresa_atualizar_contato('(11) 3333-4444', 'Contato@CargosA.com', 'Fulana', t_a::text || '/logo.png');
  perform set_config('role', 'postgres', true);
  select telefone || '|' || email || '|' || responsavel_nome || '|' || nome || '|' || slug into v_txt from public.tenants where id = t_a;
  assert v_txt = '1133334444|contato@cargosa.com|Fulana|Cargos A|cargos-a', 'gerente muda só contato/logo: ' || v_txt;
  perform public._como(g_a, 'cargos-a');
  begin
    perform public.admin_atualizar_empresa(t_a, 'Outro nome', null, null, null, null);
    assert false, 'gerente não usa a RPC do Super Admin';
  exception when insufficient_privilege or raise_exception then null; end;
  begin
    update public.tenants set slug = 'roubado', nome = 'X' where id = t_a;
    get diagnostics v_n = row_count;
    assert v_n = 0, 'gerente não altera tenants direto (slug/nome)';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_alterar_slug(t_a, 'cargos-novo', 'teste');
    assert false, 'gerente não troca o endereço';
  exception when insufficient_privilege or raise_exception then null; end;
  perform public._como(sdr_a, 'cargos-a');
  begin
    perform public.empresa_atualizar_contato('1133334444', null, null, null);
    assert false, 'SDR não altera dados da empresa';
  exception when insufficient_privilege then null; end;
  perform public._como(g_b, 'cargos-b');
  perform public.empresa_atualizar_contato('2122223333', null, null, null);
  perform set_config('role', 'postgres', true);
  assert (select telefone from public.tenants where id = t_a) = '1133334444', 'gerente de B não mexe em A';
  assert (select telefone from public.tenants where id = t_b) = '2122223333', 'gerente de B mexe só em B';
  raise notice 'ok 9 dados da empresa: gerente só contato/logo, só da própria';

  -- 10. quem já tinha acesso continua igual --------------------------------------
  perform public._como(g_a, 'cargos-a');
  c_clo := public.criar_cliente('pessoa_fisica', 'Lead do SDR', p_telefone => '11955550003', p_owner_id => sdr_a, p_funil_id => f_a);
  select id into n_clo from public.negociacoes where cliente_id = c_clo;
  perform public._como(sdr_a, 'cargos-a');
  perform public.mover_negociacao(n_clo, e_realizada, 1);
  begin
    perform public.fechar_negociacao(n_clo, 1, 1000, current_date, false, false, 'pendente', 'nao_iniciado', null, null, null, 'tcv');
    assert false, 'SDR continua sem passar do teto';
  exception when insufficient_privilege or check_violation or raise_exception then null; end;
  perform public._como(clo_a, 'cargos-a');
  select count(*) into v_n from public.negociacoes where tenant_id = t_a;
  assert v_n >= 3, 'closer continua vendo pelo que tem permissão';
  perform public._como(clo_b, 'cargos-a');
  select count(*) into v_n from public.negociacoes;
  assert v_n = 0, 'closer de B com header de A não vê nada';

  perform public._como(null, null);
end;
$$;

do $$
begin
  assert (select n from _historico) = (select count(*) from public.eventos where escopo = 'legado')
     and (select h from _historico) = (select md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) from public.eventos e where escopo = 'legado'),
    'reuniões históricas mudaram';
  raise notice 'ok 10 SDR/Closer como antes; histórico intacto';
end;
$$;

rollback;
