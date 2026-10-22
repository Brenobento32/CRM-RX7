-- ===========================================================================
-- Teste da T2 (`20261022140000_tenants_iniciais.sql`) e da T3
-- (`20261022150000_tenant_id_tabelas.sql`).
--
-- ONDE RODAR: só num banco de TESTE com T1, T2 e T3 aplicadas e com a cópia
-- dos dados legados. Termina em ROLLBACK. Acrescenta `email_confirmed_at` a
-- auth.users DENTRO da transação (o esqueleto local não tem essa coluna) e
-- cria usuários fictícios só aqui — nunca rodar no Supabase real.
--
-- O QUE PROVA:
--   1  T2: as duas empresas, com ids, tipo e status esperados;
--   2  vínculo do proprietário: só usuário confirmado com perfil; idempotente;
--      nenhum papel de usuário executa a função;
--   3  T3: 25 colunas NOT NULL sem default; todo registro antigo no arquivo;
--   4  gravação sem tenant falha (raiz) e herda o tenant do pai (filhas);
--      tenant divergente do pai é recusado;
--   5  usuário não grava em empresa alheia nem no arquivo; tenant_id imutável;
--   6  integração sem usuário (service_role) grava só com tenant explícito.
-- ===========================================================================

begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

do $$
declare
  v_dono   uuid;
  v_email  text;
  u_super  uuid := '20000000-0000-0000-0000-000000000001';
  u_b      uuid := '20000000-0000-0000-0000-00000000000b';
  t_arq    uuid := public.tenant_arquivo_id();
  t_rio    uuid := public.tenant_rio_x7_id();
  t_b      uuid;
  v_n      bigint;
  v_txt    text;
  v_nicho  uuid;
  v_form   uuid;
  v_serv   uuid;
  v_legado uuid;
  v_cor    text;
  v_tipo_p text;
begin
  -- 1. T2
  assert (select count(*) from public.tenants) = 2, 'T2 deveria criar exatamente 2 empresas';
  assert exists (select 1 from public.tenants where id = t_arq and tipo = 'arquivo' and status = 'arquivo' and somente_leitura and slug = 'arquivo-legado'), 'empresa de arquivo';
  assert exists (select 1 from public.tenants where id = t_rio and tipo = 'interno' and status = 'ativo' and not somente_leitura and slug = 'rio-x7'), 'empresa Rio X7';
  assert t_arq <> t_rio, 'ids distintos';
  raise notice 'ok 1  T2: arquivo (somente leitura) e Rio X7 (ativa), ids fixos e distintos';

  -- 2. Vínculo do proprietário (o único perfil da cópia)
  select p.id, u.email into v_dono, v_email from public.profiles p join auth.users u on u.id = p.id limit 1;
  assert not has_function_privilege('authenticated', 'public.vincular_proprietario_rx7(text)', 'execute'), 'authenticated não executa';
  assert not has_function_privilege('service_role', 'public.vincular_proprietario_rx7(text)', 'execute'), 'service_role não executa';
  begin
    perform public.vincular_proprietario_rx7(v_email);
    assert false, 'e-mail não confirmado não deveria ser vinculado';
  exception when no_data_found then
    raise notice 'ok 2a e-mail não confirmado não recebe vínculo';
  end;
  update auth.users set email_confirmed_at = now() where id = v_dono;
  begin
    perform public.vincular_proprietario_rx7('ninguem@teste.invalid');
    assert false, 'e-mail desconhecido não deveria ser vinculado';
  exception when no_data_found then
    raise notice 'ok 2b e-mail desconhecido não recebe vínculo';
  end;
  v_txt := public.vincular_proprietario_rx7(upper(v_email));
  assert v_txt like '%criados: 2%', format('primeira execução deveria criar 2 vínculos: %s', v_txt);
  v_txt := public.vincular_proprietario_rx7(v_email);
  assert v_txt like '%criados: 0%', format('segunda execução deveria criar 0: %s', v_txt);
  assert (select papel from public.tenant_memberships where tenant_id = t_rio and user_id = v_dono) = 'admin_empresa', 'admin na Rio X7';
  assert (select papel from public.tenant_memberships where tenant_id = t_arq and user_id = v_dono) = 'gerente', 'gerente (leitura) no arquivo';
  raise notice 'ok 2c proprietário vinculado (admin Rio X7, leitura no arquivo), idempotente';

  -- 3. T3: estrutura e registros antigos
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'tenant_id' and is_nullable = 'NO' and column_default is null
     -- as 25 tabelas comerciais da T3 (as tabelas de controle das etapas seguintes não contam)
     and table_name = any (array['clientes','funis','nichos','servicos','agenda_google_conexao','agenda_google_oauth_estados',
       'negociacoes','fechamentos','negociacao_servicos','respostas_lead','historico_etapas','atividades','proximas_acoes',
       'eventos','eventos_series','conversas','mensagens','mensagem_reacoes','mensagem_exclusoes','etapas_funil',
       'formularios','perguntas','permissoes_colaborador','whatsapp_conexoes','metas']);
  assert v_n = 25, format('deveria haver 25 colunas tenant_id NOT NULL sem default, há %s', v_n);
  assert (select count(*) from public.clientes where tenant_id <> t_arq) = 0, 'clientes fora do arquivo';
  assert (select count(*) from public.negociacoes where tenant_id <> t_arq) = 0, 'negociações fora do arquivo';
  assert (select count(*) from public.fechamentos where tenant_id <> t_arq) = 0, 'fechamentos fora do arquivo';
  assert (select count(*) from public.clientes) = 74 and (select count(*) from public.negociacoes) = 79
     and (select count(*) from public.fechamentos) = 14, 'contagens da linha de base';
  raise notice 'ok 3  T3: 25 colunas NOT NULL sem default; legado inteiro no arquivo';

  -- 4. Sem tenant falha; filhas herdam; divergência é recusada (como dono do banco, sem usuário)
  begin
    insert into public.servicos (nome) values ('teste sem tenant');
    assert false, 'raiz sem tenant deveria falhar';
  exception when not_null_violation then
    raise notice 'ok 4a tabela-raiz sem tenant_id é recusada';
  end;

  select enumlabel into v_cor from pg_enum where enumtypid = 'public.cor_etapa'::regtype order by enumsortorder limit 1;
  select enumlabel into v_tipo_p from pg_enum where enumtypid = 'public.tipo_pergunta'::regtype order by enumsortorder limit 1;
  insert into public.nichos (nome, slug, cor, tenant_id) values ('Nicho teste', 'nicho-teste-t3', v_cor::public.cor_etapa, t_rio)
    returning id into v_nicho;
  insert into public.formularios (nicho_id, nome, slug) values (v_nicho, 'Form teste', 'form-teste-t3')
    returning id into v_form;
  assert (select tenant_id from public.formularios where id = v_form) = t_rio, 'formulário deveria herdar a Rio X7';
  insert into public.perguntas (formulario_id, texto, tipo) values (v_form, 'Pergunta teste', v_tipo_p::public.tipo_pergunta);
  assert (select tenant_id from public.perguntas where formulario_id = v_form) = t_rio, 'pergunta deveria herdar a Rio X7';
  begin
    insert into public.formularios (nicho_id, nome, slug, tenant_id) values (v_nicho, 'Form errado', 'form-errado-t3', t_arq);
    assert false, 'tenant divergente do pai deveria falhar';
  exception when check_violation then
    raise notice 'ok 4b filhas herdam o tenant do pai; divergência é recusada';
  end;

  -- Empresa B (fixture local) criada pelo Super Admin
  insert into auth.users (id, email) values (u_super, 'super.t3@teste.invalid'), (u_b, 'b.t3@teste.invalid');
  insert into public.super_admins (user_id) values (u_super);
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated')::text, true);
  t_b := public.provisionar_tenant('Empresa B T3', 'empresa-b-t3', 'assinante', u_b);

  -- 5. Usuário (proprietário) gravando
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  -- Empresa da requisição (usada a partir da T4; antes dela é ignorada).
  perform set_config('request.headers', '{"x-rx7-tenant":"rio-x7"}', true);
  perform set_config('role', 'authenticated', true);

  insert into public.servicos (nome, tenant_id) values ('Serviço Rio X7 T3', t_rio) returning id into v_serv;
  raise notice 'ok 5a usuário grava na própria empresa';

  begin
    insert into public.servicos (nome, tenant_id) values ('Serviço em B', t_b);
    assert false, 'usuário não deveria gravar em empresa alheia';
  exception when insufficient_privilege then
    raise notice 'ok 5b usuário não atribui tenant de empresa alheia';
  end;

  -- Id lido como dono do banco (com a T4, o arquivo nem é visível na Rio X7).
  perform set_config('role', 'postgres', true);
  select id into v_legado from public.servicos where tenant_id = t_arq limit 1;
  perform set_config('role', 'authenticated', true);
  -- Recusa por erro (T3) ou por não enxergar a linha (T4): nos dois casos, 0 alterações.
  begin
    update public.servicos set nome = nome where id = v_legado;
    get diagnostics v_n = row_count;
    assert v_n = 0, 'usuário não deveria alterar registro do arquivo';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'ok 5c registro do arquivo é somente leitura para usuário';
  begin
    delete from public.servicos where id = v_legado;
    get diagnostics v_n = row_count;
    assert v_n = 0, 'usuário não deveria apagar registro do arquivo';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'ok 5d usuário não apaga registro do arquivo';
  begin
    update public.servicos set tenant_id = t_b where id = v_serv;
    assert false, 'tenant_id não deveria mudar';
  exception when check_violation then
    raise notice 'ok 5e tenant_id é imutável';
  end;

  -- 6. Integração sem usuário (service_role)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
  insert into public.servicos (nome, tenant_id) values ('Serviço via integração', t_rio);
  begin
    insert into public.servicos (nome) values ('Integração sem tenant');
    assert false, 'integração sem tenant deveria falhar';
  exception when not_null_violation then
    raise notice 'ok 6  integração grava só com tenant explícito';
  end;

  perform set_config('role', 'postgres', true);
  raise notice 'tenants_t2_t3_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
