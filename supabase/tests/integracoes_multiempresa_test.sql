-- ===========================================================================
-- Teste de onboarding e integrações por empresa (T9–T12).
--
-- ONDE RODAR: só na cópia LOCAL com M1, T1–T4, T8, o esqueleto
-- `scaffold_local_integracoes.sql` e T9–T12. Termina em ROLLBACK. Nenhuma
-- chamada a Respondi, Google ou WhatsApp: as Edge Functions são simuladas
-- chamando as mesmas RPCs com a service_role.
--
-- PROVA:
--   1  onboarding: só Super Admin; funil principal e etapas criados uma vez
--      (idempotente); empresa nova sem dados legados; slug do arquivo
--      recusado; falha não deixa empresa pela metade; usuário não cria etapa
--      de sistema;
--   2  ingestão: empresa vem da credencial; reenvio não duplica; dedup só na
--      empresa; credencial inválida/revogada e empresa suspensa recusadas;
--      hash nunca legível; caminho antigo não grava no arquivo;
--   3  usuários: identidade única por e-mail; só admin_empresa vincula; sem
--      escalada de privilégio entre empresas;
--   4  Google: estado de uso único, por empresa; OAuth de A não conecta B;
--      revogar A não afeta B; conta não permitida recusada;
--   5  Storage: A não lê nem grava mídia de B; avatar só do próprio/gerido;
--   6  Realtime: evento de B nunca entra no canal de A;
--   7  legado intacto.
-- ===========================================================================

begin;

create function public._teste_como(p_uid uuid, p_slug text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('realtime.topic', '', true);
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
grant execute on function public._teste_como(uuid, text) to authenticated, service_role;

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
grant execute on function public._teste_servico() to authenticated, service_role;

create temp table _base as
select (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c)    as h_cli,
       (select md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.negociacoes n) as h_neg,
       (select md5(string_agg(to_jsonb(f)::text, '|' order by f.negociacao_id)) from public.fechamentos f) as h_fec,
       (select count(*) from public.clientes) as n_cli;
grant select on _base to authenticated, service_role;

do $$
declare
  u_super uuid := '40000000-0000-0000-0000-000000000001';
  u_a     uuid := '40000000-0000-0000-0000-00000000000a';
  u_a_ger uuid := '40000000-0000-0000-0000-0000000000a6';
  u_b     uuid := '40000000-0000-0000-0000-00000000000b';
  u_multi uuid := '40000000-0000-0000-0000-0000000000ab';
  t_a uuid; t_b uuid; t_a2 uuid;
  t_arq uuid := public.tenant_arquivo_id();
  v_token_a text; v_token_b text;
  v_r record; v_r2 record;
  v_n bigint;
  v_txt text;
  v_nonce text;
  cv_a uuid; cv_b uuid;
  v_cred uuid;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email) values
    (u_super, 'super.int@teste.invalid'), (u_a, 'a.int@teste.invalid'), (u_a_ger, 'ager.int@teste.invalid'),
    (u_b, 'b.int@teste.invalid'), (u_multi, 'multi.int@teste.invalid');
  insert into public.profiles (id, nome, email, role)
  select u.id, split_part(u.email, '@', 1), u.email, 'closer' from auth.users u
   where u.id in (u_super, u_a, u_a_ger, u_b, u_multi)
  on conflict (id) do nothing;
  update public.profiles set ativo = true where id in (u_super, u_a, u_a_ger, u_b, u_multi);
  insert into public.super_admins (user_id) values (u_super);

  -- ================================================================ 1. onboarding
  perform public._teste_como(u_a, null);
  begin
    perform public.provisionar_empresa('Empresa A', 'empresa-a', u_a);
    assert false, 'usuário comum não provisiona';
  exception when insufficient_privilege then raise notice 'ok 1a só o Super Admin provisiona empresa'; end;

  perform public._teste_como(u_super, null);
  t_a := public.provisionar_empresa('Empresa A', 'empresa-a', u_a);
  t_a2 := public.provisionar_empresa('Empresa A (repetido)', 'empresa-a', u_a);
  assert t_a = t_a2, 'provisionar de novo devolve a mesma empresa';
  t_b := public.provisionar_empresa('Empresa B', 'empresa-b', u_b);
  -- Com a T13 as empresas novas entram no Starter: aqui o plano libera tudo,
  -- para testar só as integrações (limites de plano têm teste próprio).
  if to_regclass('public.planos') is not null then
    perform set_config('role', 'postgres', true);
    -- Fontes: 1000 (com a Central, limite vazio é "a definir" e bloqueia fonte nova).
    update public.planos set recursos = public.recursos_validos(), limite_usuarios = null, limite_integracoes = 1000
     where codigo = 'starter';
    perform set_config('role', 'authenticated', true);
  end if;

  perform public._teste_como(null, null);
  assert (select count(*) from public.funis where tenant_id = t_a) = 1, 'um funil em A';
  assert (select count(*) from public.funis where tenant_id = t_a and padrao) = 1, 'funil principal em A';
  assert (select count(*) from public.etapas_funil where tenant_id = t_a) = 6, 'seis etapas padrão em A';
  assert (select count(*) from public.etapas_funil where tenant_id = t_a and chave = 'reuniao_realizada' and sistema) = 1, 'etapa de handoff SDR';
  assert (select count(*) from public.etapas_funil where tenant_id = t_a and etapa_inicial) = 1, 'uma etapa inicial';
  assert (select count(*) from public.tenant_configuracoes where tenant_id = t_a) = 1, 'configuração de A';
  assert (select count(*) from public.tenant_memberships where tenant_id = t_a) = 1
     and (select papel from public.tenant_memberships where tenant_id = t_a and user_id = u_a) = 'admin_empresa', 'admin vinculado uma vez';
  assert (select count(*) from public.clientes where tenant_id = t_a) = 0
     and (select count(*) from public.negociacoes where tenant_id = t_a) = 0
     and (select count(*) from public.fechamentos where tenant_id = t_a) = 0
     and (select count(*) from public.metas where tenant_id = t_a) = 0, 'empresa nova sem dados';
  raise notice 'ok 1b funil principal + 6 etapas + config criados uma vez (provisionar 2x = mesma empresa)';

  perform public._teste_como(u_super, null);
  begin
    perform public.provisionar_empresa('Arquivo', 'arquivo-legado', u_a);
    assert false, 'slug do arquivo';
  exception when invalid_parameter_value then raise notice 'ok 1c slug da empresa de arquivo é recusado'; end;
  begin
    perform public.provisionar_empresa('Empresa C', 'empresa-c', gen_random_uuid());
    assert false, 'admin inexistente';
  exception when no_data_found then null; end;
  perform public._teste_como(null, null);
  assert not exists (select 1 from public.tenants where slug = 'empresa-c'), 'falha não deixa empresa criada';
  raise notice 'ok 1d falha no provisionamento não deixa empresa pela metade';

  perform public._teste_como(u_a, 'empresa-a');
  begin
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, sistema, chave)
    select f.id, 'Falsa', 'azul', 1500, 'aberta', true, 'reuniao_falsa' from public.funis f where f.padrao;
    assert false, 'usuário não cria etapa de sistema';
  exception when check_violation then raise notice 'ok 1e usuário não cria etapa de sistema'; end;

  -- ================================================================ 3. usuários (antes da ingestão: B precisa de membros)
  perform public._teste_como(u_a, 'empresa-a');
  perform public.definir_membro_tenant(t_a, u_a_ger, 'gerente');
  perform public.definir_membro_tenant(t_a, u_multi, 'closer');
  perform public._teste_como(u_b, 'empresa-b');
  perform public.definir_membro_tenant(t_b, u_multi, 'sdr');

  perform public._teste_como(u_a_ger, 'empresa-a');
  begin
    perform public.definir_membro_tenant(t_a, u_b, 'admin_empresa');
    assert false, 'gerente não concede papel';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_a, 'empresa-a');
  begin
    perform public.definir_membro_tenant(t_b, u_a, 'admin_empresa');
    assert false, 'admin de A não entra em B';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_multi, 'empresa-b');
  begin
    perform public.definir_membro_tenant(t_b, u_multi, 'admin_empresa');
    assert false, 'sdr não se promove';
  exception when insufficient_privilege then null; end;
  assert not has_function_privilege('authenticated', 'public.usuario_por_email(text)', 'execute'), 'só service_role busca por e-mail';
  perform public._teste_servico();
  assert public.usuario_por_email('MULTI.int@teste.invalid') = u_multi, 'mesma identidade por e-mail';
  perform public._teste_como(null, null);
  assert (select count(*) from auth.users where lower(email) = 'multi.int@teste.invalid') = 1
     and (select count(*) from public.tenant_memberships where user_id = u_multi) = 2, 'um usuário, dois vínculos';
  raise notice 'ok 3  identidade única com vínculos por empresa; só admin_empresa/Super Admin concedem papel';

  -- ================================================================ 2. ingestão
  perform public._teste_como(u_a_ger, 'empresa-a');
  begin
    perform public.gerar_credencial_ingestao('Site');
    assert false, 'gerente não gera credencial';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_a, 'empresa-a');
  v_token_a := public.gerar_credencial_ingestao('Site A');
  assert v_token_a ~ '^rx7_[0-9a-f]{32}_[0-9a-f]{64}$', 'formato do token';
  perform public._teste_como(u_b, 'empresa-b');
  v_token_b := public.gerar_credencial_ingestao('Site B');
  select count(*) into v_n from public.ingestao_credenciais;
  assert v_n = 1, 'B só vê a própria credencial';
  begin
    perform segredo_hash from public.ingestao_credenciais;
    assert false, 'hash não é legível';
  exception when insufficient_privilege then null; end;
  assert not has_function_privilege('authenticated', 'public.ingerir_lead_por_credencial(text, text, text, text, text, text, text, text, text, jsonb, jsonb)', 'execute'),
    'usuário não chama a ingestão';
  raise notice 'ok 2a credencial por empresa: só admin gera, só o hash fica salvo, ninguém lê o hash';

  perform public._teste_servico();
  select * into v_r from public.ingerir_lead_por_credencial(v_token_a, 'ext-1', 'Lead A', p_telefone => '5521911110000', p_email => 'lead@teste.invalid');
  assert v_r.criado, 'primeiro envio cria';
  select * into v_r2 from public.ingerir_lead_por_credencial(v_token_a, 'ext-1', 'Lead A (reenvio)', p_telefone => '5521911110000');
  assert not v_r2.criado and v_r2.negociacao_id = v_r.negociacao_id, 'reenvio não duplica';
  perform public._teste_como(null, null);
  assert (select tenant_id from public.negociacoes where id = v_r.negociacao_id) = t_a, 'lead na empresa da credencial';
  assert (select count(*) from public.negociacoes where tenant_id = t_a and external_id = 'ext-1') = 1, 'uma negociação';
  assert (select etapa_id from public.negociacoes where id = v_r.negociacao_id)
       = (select e.id from public.etapas_funil e where e.tenant_id = t_a and e.etapa_inicial), 'entra na etapa inicial de A';
  raise notice 'ok 2b reenvio do mesmo lead não duplica; lead cai na empresa da credencial';

  perform public._teste_servico();
  select * into v_r2 from public.ingerir_lead_por_credencial(v_token_b, 'ext-1', 'Lead B', p_telefone => '5521911110000');
  assert v_r2.criado and v_r2.cliente_id <> v_r.cliente_id, 'mesmo external_id e telefone em B: cliente e negociação novos';
  perform public._teste_como(null, null);
  assert (select tenant_id from public.clientes where id = v_r2.cliente_id) = t_b, 'cliente de B em B';
  raise notice 'ok 2c dedup e idempotência só dentro da empresa (mesmo lead em B não toca A)';

  perform public._teste_servico();
  begin
    perform public.ingerir_lead_por_credencial('rx7_' || repeat('0', 32) || '_' || repeat('0', 64), 'ext-x', 'X', p_email => 'x@teste.invalid');
    assert false, 'credencial desconhecida';
  exception when invalid_password then null; end;
  begin
    perform public.ingerir_lead_por_credencial(left(v_token_a, 37) || repeat('f', 64), 'ext-x', 'X', p_email => 'x@teste.invalid');
    assert false, 'segredo errado';
  exception when invalid_password then null; end;
  begin
    perform public.ingerir_lead_por_credencial(t_a::text, 'ext-x', 'X', p_email => 'x@teste.invalid');
    assert false, 'tenant_id não é credencial';
  exception when invalid_password then null; end;
  raise notice 'ok 2d credencial desconhecida, segredo errado ou tenant_id cru: recusados';

  perform public._teste_como(null, null);
  update public.tenants set status = 'suspenso' where id = t_b;
  perform public._teste_servico();
  begin
    perform public.ingerir_lead_por_credencial(v_token_b, 'ext-2', 'Lead B2', p_email => 'b2@teste.invalid');
    assert false, 'empresa suspensa';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(null, null);
  update public.tenants set status = 'teste' where id = t_b;

  perform public._teste_como(u_a, 'empresa-a');
  select id into v_cred from public.ingestao_credenciais limit 1;
  perform public.revogar_credencial_ingestao(v_cred);
  perform public._teste_servico();
  begin
    perform public.ingerir_lead_por_credencial(v_token_a, 'ext-3', 'Lead A3', p_email => 'a3@teste.invalid');
    assert false, 'credencial revogada';
  exception when invalid_password then null; end;
  begin
    perform public.ingerir_lead_formulario('ext-legado', 'instituicao-ensino-captacao', 'instituicao-ensino', 'Lead', '5521999990000');
    assert false, 'caminho antigo no formulário do arquivo';
  exception when no_data_found then null; end;
  perform public._teste_como(null, null);
  assert not exists (select 1 from public.negociacoes where external_id in ('ext-legado', 'ext-2', 'ext-3')), 'nada gravado';
  raise notice 'ok 2e empresa suspensa, credencial revogada e formulário do arquivo: recusados, nada gravado';

  -- ================================================================ 4. Google
  perform public._teste_servico();
  v_nonce := public.agenda_google_criar_estado(t_a, u_a, 'https://crm.teste.invalid/configuracoes');
  begin
    perform public.agenda_google_criar_estado(t_b, u_a, 'https://crm.teste.invalid/x');
    assert false, 'gerente de A não inicia OAuth em B';
  exception when insufficient_privilege then null; end;
  select * into v_r from public.agenda_google_consumir_estado(v_nonce);
  assert v_r.tenant_id = t_a and v_r.usuario_id = u_a and not v_r.expirado, 'estado devolve a empresa de origem';
  select count(*) into v_n from public.agenda_google_consumir_estado(v_nonce);
  assert v_n = 0, 'estado é de uso único';
  v_nonce := public.agenda_google_criar_estado(t_a, u_a, 'https://crm.teste.invalid/configuracoes');
  perform public._teste_como(null, null);
  update public.agenda_google_oauth_estados set expira_em = now() - interval '1 minute' where nonce = v_nonce;
  perform public._teste_servico();
  select * into v_r from public.agenda_google_consumir_estado(v_nonce);
  assert v_r.expirado, 'estado vencido é marcado como expirado';

  perform public.agenda_google_salvar_conexao(t_a, 'a@teste.invalid', 'a@teste.invalid', array['calendar.readonly'], 'token-a', u_a);
  begin
    perform public.agenda_google_salvar_conexao(t_b, 'a@teste.invalid', 'a@teste.invalid', array['x'], 'token-a', u_a);
    assert false, 'OAuth de A não conecta B';
  exception when insufficient_privilege then null; end;
  perform public.agenda_google_salvar_conexao(t_b, 'b@teste.invalid', 'b@teste.invalid', array['calendar.readonly'], 'token-b', u_b);
  assert (select refresh_token from public.agenda_google_obter_credencial(t_a)) = 'token-a', 'token de A';
  assert (select refresh_token from public.agenda_google_obter_credencial(t_b)) = 'token-b', 'token de B';
  perform public.agenda_google_remover_conexao(t_a);
  assert not exists (select 1 from public.agenda_google_obter_credencial(t_a)), 'A desconectada';
  assert (select refresh_token from public.agenda_google_obter_credencial(t_b)) = 'token-b', 'B continua conectada';
  perform public._teste_como(null, null);
  assert (select count(*) from vault.secrets) = 1, 'segredo de A removido do Vault, o de B fica';
  update public.tenant_configuracoes set google_conta_permitida = 'certa@teste.invalid' where tenant_id = t_a;
  perform public._teste_servico();
  begin
    perform public.agenda_google_salvar_conexao(t_a, 'outra@teste.invalid', 'outra@teste.invalid', array['x'], 'token', u_a);
    assert false, 'conta não permitida';
  exception when insufficient_privilege then null; end;
  assert not has_function_privilege('authenticated', 'public.agenda_google_obter_credencial(uuid)', 'execute'), 'usuário não lê token';
  perform public._teste_como(u_a, 'empresa-a');
  select count(*) into v_n from public.agenda_google_conexao;
  assert v_n = 0, 'gerente de A não vê a conexão de B';
  raise notice 'ok 4  OAuth: estado por empresa, uso único e com validade; A não conecta B; revogar A não afeta B';

  -- ================================================================ 5. Storage
  perform public._teste_como(null, null);
  insert into public.conversas (tenant_id, telefone) values (t_a, '5521900000101') returning id into cv_a;
  insert into public.conversas (tenant_id, telefone) values (t_b, '5521900000102') returning id into cv_b;
  insert into storage.objects (bucket_id, name) values ('whatsapp-midia', t_b || '/' || cv_b || '/b.jpg');

  perform public._teste_como(u_a, 'empresa-a');
  insert into storage.objects (bucket_id, name) values ('whatsapp-midia', t_a || '/' || cv_a || '/a.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('whatsapp-midia', t_b || '/' || cv_b || '/invasao.jpg');
    assert false, 'A grava mídia em B';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('whatsapp-midia', t_a || '/' || cv_b || '/invasao.jpg');
    assert false, 'conversa de B sob o prefixo de A';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('whatsapp-midia', cv_a || '/formato-antigo.jpg');
    assert false, 'formato antigo não é gravável';
  exception when insufficient_privilege then null; end;
  select count(*) into v_n from storage.objects where bucket_id = 'whatsapp-midia';
  assert v_n = 1, format('A vê só a própria mídia, viu %s', v_n);
  delete from storage.objects where bucket_id = 'whatsapp-midia' and name like t_b || '%';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'A não apaga mídia de B';
  insert into storage.objects (bucket_id, name) values ('avatares', u_a || '/foto.png');
  insert into storage.objects (bucket_id, name) values ('avatares', u_a_ger || '/foto.png');  -- gerido por A
  begin
    insert into storage.objects (bucket_id, name) values ('avatares', u_b || '/foto.png');
    assert false, 'avatar de usuário de outra empresa';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('avatares', u_multi || '/foto.png');
    assert false, 'avatar de quem também é de B (A não gere B)';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 5  Storage: A não lê, grava nem apaga mídia de B; avatar só do próprio ou de quem A gere';

  -- ================================================================ 6. Realtime
  perform public._teste_como(null, null);
  insert into public.mensagens (conversa_id, direcao, tipo, conteudo) values (cv_a, 'entrada', 'texto', 'oi A');
  insert into public.mensagens (conversa_id, direcao, tipo, conteudo) values (cv_b, 'entrada', 'texto', 'oi B');
  assert (select count(*) from realtime.messages where topic = public.topico_conversa(t_a, cv_a) and event = 'mensagem') = 1, 'evento no canal de A';
  assert (select count(*) from realtime.messages where topic = public.topico_conversa(t_b, cv_b)) = 1, 'evento no canal de B';
  assert not exists (select 1 from realtime.messages where topic like 'empresa:' || t_a || ':%' and payload -> 'registro' ->> 'tenant_id' <> t_a::text),
    'canal de A só tem registros de A';

  perform public._teste_como(u_b, 'empresa-b');
  perform set_config('realtime.topic', public.topico_conversa(t_a, cv_a), true);
  select count(*) into v_n from realtime.messages m where m.topic = realtime.topic();
  assert v_n = 0, 'usuário de B não entra no canal de A';
  perform public._teste_como(u_a, 'empresa-a');
  perform set_config('realtime.topic', public.topico_conversa(t_a, cv_a), true);
  select count(*) into v_n from realtime.messages m where m.topic = realtime.topic();
  assert v_n = 1, 'gerente de A ouve o canal de A';
  perform set_config('realtime.topic', public.topico_conversa(t_b, cv_b), true);
  select count(*) into v_n from realtime.messages m where m.topic = realtime.topic();
  assert v_n = 0, 'gerente de A não ouve o canal de B';
  perform public._teste_como(u_multi, 'empresa-b');
  perform set_config('realtime.topic', public.topico_conversa(t_b, cv_b), true);
  select count(*) into v_n from realtime.messages m where m.topic = realtime.topic();
  assert v_n = 0, 'sdr de B sem carteira não ouve conversa de B';
  perform set_config('realtime.topic', 'empresa:' || t_a || ':conversa:' || cv_b, true);
  select count(*) into v_n from realtime.messages m where m.topic = realtime.topic();
  assert v_n = 0, 'tópico forjado (empresa A + conversa B) não abre nada';
  perform public._teste_como(null, null);
  insert into public.mensagem_reacoes (mensagem_id, usuario_id, emoji)
  select m.id, u_a, '👍' from public.mensagens m where m.conversa_id = cv_a;
  delete from public.mensagem_reacoes where usuario_id = u_a;
  assert (select count(*) from realtime.messages
           where topic = public.topico_conversa(t_a, cv_a) and event = 'reacao') = 2, 'reação incluída e removida no canal de A';
  assert not exists (select 1 from realtime.messages where topic = public.topico_conversa(t_b, cv_b) and event = 'reacao'),
    'reação de A não vai para B';
  raise notice 'ok 6  Realtime: canal por empresa e conversa; B não ouve A, tópico forjado não abre';

  -- ================================================================ 7. legado
  perform public._teste_como(null, null);
  assert (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c where tenant_id = t_arq) = (select h_cli from _base), 'clientes legados';
  assert (select md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.negociacoes n where tenant_id = t_arq) = (select h_neg from _base), 'negociações legadas';
  assert (select md5(string_agg(to_jsonb(f)::text, '|' order by f.negociacao_id)) from public.fechamentos f where tenant_id = t_arq) = (select h_fec from _base), 'fechamentos legados';
  raise notice 'ok 7  legado intacto';

  raise notice 'integracoes_multiempresa_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
