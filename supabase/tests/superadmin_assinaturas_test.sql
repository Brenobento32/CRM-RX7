-- ===========================================================================
-- Teste do Super Admin, planos e assinaturas (T13).
--
-- ONDE RODAR: só na cópia LOCAL com T1–T12 (+ esqueleto local) e T13.
-- Termina em ROLLBACK. Nenhum provedor de pagamento é chamado: o webhook é
-- simulado chamando `registrar_evento_pagamento` com a service_role.
--
-- PROVA:
--   1  usuário comum não usa nada do Super Admin (RPCs e tabelas);
--   2  onboarding cria assinatura de teste e registra auditoria;
--   3  empresa A não vê nem altera a assinatura de B; cliente não se marca
--      como pago;
--   4  limite de usuários e de integrações e recursos do plano, no banco;
--   5  suspender/reativar preserva dados e a mesma empresa;
--   6  arquivo e empresa interna não recebem assinatura nem são suspensos;
--   7  eventos de pagamento idempotentes; suspensão manual prevalece;
--   8  Super Admin sem acesso a dados comerciais; legado intacto.
-- ===========================================================================

begin;

create function public._teste_como(p_uid uuid, p_slug text)
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
create function public._teste_servico()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;
grant execute on function public._teste_como(uuid, text) to authenticated, service_role;
grant execute on function public._teste_servico() to authenticated, service_role;

create temp table _base as
select (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c) as h_cli,
       (select md5(string_agg(to_jsonb(f)::text, '|' order by f.negociacao_id)) from public.fechamentos f) as h_fec;
grant select on _base to authenticated, service_role;

do $$
declare
  u_super uuid := '60000000-0000-0000-0000-000000000001';
  u_a     uuid := '60000000-0000-0000-0000-00000000000a';
  u_a2    uuid := '60000000-0000-0000-0000-0000000000a2';
  u_a3    uuid := '60000000-0000-0000-0000-0000000000a3';
  u_b     uuid := '60000000-0000-0000-0000-00000000000b';
  t_a uuid; t_b uuid;
  t_arq uuid := public.tenant_arquivo_id();
  t_rio uuid := public.tenant_rio_x7_id();
  v_n bigint; v_txt text; v_r record;
  c_a uuid;
begin
  insert into auth.users (id, email) values
    (u_super, 'super.sa@teste.invalid'), (u_a, 'a.sa@teste.invalid'), (u_a2, 'a2.sa@teste.invalid'),
    (u_a3, 'a3.sa@teste.invalid'), (u_b, 'b.sa@teste.invalid');
  insert into public.profiles (id, nome, email, role)
  select u.id, split_part(u.email, '@', 1), u.email, 'closer' from auth.users u where u.id in (u_super, u_a, u_a2, u_a3, u_b)
  on conflict (id) do nothing;
  update public.profiles set ativo = true where id in (u_super, u_a, u_a2, u_a3, u_b);
  insert into public.super_admins (user_id) values (u_super);

  -- ============================================================ 1. usuário comum
  perform public._teste_como(u_a, null);
  begin perform public.admin_listar_empresas(); assert false, 'listar';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_salvar_plano('starter', 'X', 0, 0, 999, 999, null, '{}', 'ativo'); assert false, 'plano';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_suspender_empresa(t_rio, 'x'); assert false, 'suspender';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_listar_auditoria(); assert false, 'auditoria';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.planos; assert false, 'tabela planos';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.assinaturas; assert false, 'tabela assinaturas';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 1  usuário comum não acessa RPCs nem tabelas do Super Admin';

  -- ============================================================ 2. onboarding
  perform public._teste_como(u_super, null);
  t_a := public.provisionar_empresa('Empresa A', 'empresa-a', u_a);
  t_b := public.provisionar_empresa('Empresa B', 'empresa-b', u_b);
  select * into v_r from public.admin_listar_empresas(t_a);
  assert v_r.plano_codigo = 'starter' and v_r.assinatura_status = 'teste' and v_r.status = 'teste' and v_r.usuarios_ativos = 1,
    'A nasce em teste no Starter, com 1 usuário';
  assert (select count(*) from public.admin_listar_auditoria() where acao = 'empresa_criada') = 2, 'auditoria das criações';
  assert (select count(*) from public.admin_historico_assinatura(t_a)) = 1, 'histórico da assinatura';
  raise notice 'ok 2  onboarding cria assinatura de teste e registra auditoria';

  -- ============================================================ 3. A × B
  perform public._teste_como(u_a, 'empresa-a');
  select * into v_r from public.minha_assinatura();
  assert v_r.empresa = 'Empresa A' and v_r.plano_codigo = 'starter', 'A vê a própria assinatura';
  select count(*) into v_n from public.minha_assinatura();
  assert v_n = 1, 'só uma linha (a da empresa da requisição)';
  begin perform public.admin_definir_assinatura(t_b, 'business', 'ativa', 'anual', null, null, 'x'); assert false, 'A altera B';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_definir_assinatura(t_a, 'business', 'ativa', 'anual', null, null, 'x'); assert false, 'A se marca ativa';
  exception when insufficient_privilege then null; end;
  begin update public.assinaturas set status = 'ativa'; assert false, 'update direto';
  exception when insufficient_privilege then null; end;
  begin perform public.registrar_evento_pagamento('asaas', 'evt-falso', 'pago', 'x', 'ativa'); assert false, 'webhook pelo usuário';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_a, 'empresa-b');
  begin perform public.minha_assinatura(); assert false, 'A lê B';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 3  A não vê nem altera a assinatura de B; cliente não se marca como pago';

  -- ============================================================ 4. limites
  perform public._teste_como(u_super, null);
  perform public.admin_salvar_plano('starter', 'Starter', null, null, 2, 0, null, array['metas'], 'ativo');
  perform public._teste_como(u_a, 'empresa-a');
  perform public.definir_membro_tenant(t_a, u_a2, 'closer');
  begin
    perform public.definir_membro_tenant(t_a, u_a3, 'sdr');
    assert false, 'terceiro usuário no limite de 2';
  exception when sqlstate 'RX001' then null; end;
  perform public.definir_membro_tenant(t_a, u_a2, 'closer', false);   -- libera vaga
  perform public.definir_membro_tenant(t_a, u_a3, 'sdr');
  begin
    perform public.definir_membro_tenant(t_a, u_a2, 'closer', true);  -- reativar estoura de novo
    assert false, 'reativar acima do limite';
  exception when sqlstate 'RX001' then null; end;
  raise notice 'ok 4a limite de usuários respeitado (convidar e reativar)';

  begin
    perform public.gerar_credencial_ingestao('Site');
    assert false, 'Starter sem recurso de ingestão';
  exception when sqlstate 'RX003' then null; end;
  perform public._teste_como(u_super, null);
  perform public.admin_salvar_plano('pro', 'Pro', null, null, 10, 1, null, array['metas', 'ingestao_leads', 'agenda_google'], 'ativo');
  perform public.admin_definir_assinatura(t_a, 'pro', 'ativa', 'mensal', now() + interval '30 days', null, 'Upgrade');
  perform public._teste_como(u_a, 'empresa-a');
  perform public.gerar_credencial_ingestao('Site');
  begin
    perform public.gerar_credencial_ingestao('Outro');
    assert false, 'segunda integração no limite de 1';
  exception when sqlstate 'RX002' then null; end;
  raise notice 'ok 4b recurso do plano e limite de integrações respeitados';

  -- ============================================================ 5. suspender/reativar
  c_a := public.criar_cliente('pessoa_fisica', 'Cliente A', p_telefone => '5521911112222');
  perform public._teste_como(u_super, null);
  perform public.admin_suspender_empresa(t_a, 'Inadimplência');
  perform public._teste_como(null, null);
  assert (select status from public.tenants where id = t_a) = 'suspenso' and (select somente_leitura from public.tenants where id = t_a),
    'A suspensa e somente leitura';
  assert (select status from public.assinaturas where tenant_id = t_a) = 'suspensa', 'assinatura suspensa';
  perform public._teste_como(u_a, 'empresa-a');
  assert exists (select 1 from public.clientes where id = c_a), 'dados continuam legíveis';
  begin
    perform public.criar_cliente('pessoa_fisica', 'Novo', p_telefone => '5521911113333');
    assert false, 'gravação em empresa suspensa';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_super, null);
  perform public.admin_reativar_empresa(t_a, 'Pagamento regularizado');
  perform public._teste_como(null, null);
  assert (select status from public.tenants where id = t_a) = 'ativo'
     and (select status from public.assinaturas where tenant_id = t_a) = 'ativa', 'A reativada';
  assert (select count(*) from public.tenants where slug = 'empresa-a') = 1, 'mesma empresa, nada recriado';
  assert (select count(*) from public.clientes where tenant_id = t_a) = 1, 'dados preservados';
  perform public._teste_como(u_a, 'empresa-a');
  perform public.criar_cliente('pessoa_fisica', 'Depois', p_telefone => '5521911114444');
  perform public._teste_como(u_super, null);
  assert (select count(*) from public.admin_historico_assinatura(t_a)) >= 4, 'histórico de teste → ativa → suspensa → ativa';
  raise notice 'ok 5  suspender deixa somente leitura sem apagar; reativar volta a mesma empresa com os dados';

  -- ============================================================ 6. arquivo e interna
  begin perform public.admin_definir_assinatura(t_arq, 'pro', 'ativa', 'mensal', null, null, 'x'); assert false, 'arquivo';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_suspender_empresa(t_arq, 'x'); assert false, 'suspender arquivo';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_reativar_empresa(t_arq, 'x'); assert false, 'reativar arquivo';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_suspender_empresa(t_rio, 'x'); assert false, 'suspender interna';
  exception when invalid_parameter_value then null; end;
  perform public._teste_como(null, null);
  begin
    insert into public.assinaturas (tenant_id, plano_id) select t_arq, id from public.planos where codigo = 'pro';
    assert false, 'assinatura do arquivo nem pelo dono do banco';
  exception when invalid_parameter_value then null; end;
  assert (select status from public.tenants where id = t_arq) = 'arquivo', 'arquivo intacto';
  raise notice 'ok 6  arquivo e empresa interna não recebem assinatura nem são suspensos';

  -- ============================================================ 7. pagamento
  perform public._teste_como(u_super, null);
  perform public.admin_definir_assinatura(t_b, 'starter', 'teste', 'mensal', null, null, 'Vincula provedor', 'asaas', 'sub_b');
  perform public._teste_servico();
  v_txt := public.registrar_evento_pagamento('asaas', 'evt_1', 'payment_confirmed', 'sub_b', 'ativa', now() + interval '30 days');
  assert v_txt = 'processado', v_txt;
  v_txt := public.registrar_evento_pagamento('asaas', 'evt_1', 'payment_confirmed', 'sub_b', 'ativa', now() + interval '30 days');
  assert v_txt = 'duplicado', 'reenvio do mesmo evento';
  v_txt := public.registrar_evento_pagamento('asaas', 'evt_x', 'payment_confirmed', 'sub_inexistente', 'ativa');
  assert v_txt = 'ignorado_sem_assinatura', v_txt;
  begin perform public.registrar_evento_pagamento('asaas', 'evt_s', 'x', 'sub_b', 'suspensa'); assert false, 'webhook suspende';
  exception when invalid_parameter_value then null; end;
  perform public._teste_como(null, null);
  assert (select status from public.assinaturas where tenant_id = t_b) = 'ativa'
     and (select status from public.tenants where id = t_b) = 'ativo', 'B ativa pelo pagamento';
  assert (select count(*) from public.assinaturas_historico where tenant_id = t_b and origem = 'pagamento') = 1, 'uma mudança só';
  perform public._teste_como(u_super, null);
  perform public.admin_suspender_empresa(t_b, 'Fraude');
  perform public._teste_servico();
  v_txt := public.registrar_evento_pagamento('asaas', 'evt_2', 'payment_confirmed', 'sub_b', 'ativa');
  assert v_txt = 'mantido_suspensa', v_txt;
  perform public._teste_como(null, null);
  assert (select status from public.assinaturas where tenant_id = t_b) = 'suspensa', 'suspensão manual prevalece';
  raise notice 'ok 7  pagamento idempotente, provedor por referência, suspensão manual prevalece';

  -- ============================================================ 8. sem dados comerciais
  perform public._teste_como(u_super, 'empresa-a');
  assert public.tenant_atual() is null, 'Super Admin não entra na empresa';
  select count(*) into v_n from public.clientes;
  assert v_n = 0, 'Super Admin não vê clientes';
  perform public._teste_como(null, null);
  assert (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c where tenant_id = t_arq) = (select h_cli from _base),
    'clientes legados';
  assert (select md5(string_agg(to_jsonb(f)::text, '|' order by f.negociacao_id)) from public.fechamentos f where tenant_id = t_arq) = (select h_fec from _base),
    'fechamentos legados';
  raise notice 'ok 8  Super Admin sem dados comerciais; legado intacto';

  raise notice 'superadmin_assinaturas_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
