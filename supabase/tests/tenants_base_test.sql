-- ===========================================================================
-- Teste da T1 (`20261022130000_tenants_base.sql`).
--
-- ONDE RODAR: só num banco de TESTE com a T1 já aplicada (cópia local). Tudo
-- roda numa transação que termina em ROLLBACK: nenhum fixture fica gravado.
-- Os usuários de teste são inseridos direto em auth.users com só (id, email):
-- isso serve ao esqueleto local; no Supabase real auth.users tem mais colunas
-- obrigatórias, então não rode este arquivo lá.
--
-- O QUE PROVA:
--   1  usuário comum não cria empresa nem vira Super Admin (RPC e escrita direta);
--   2  Super Admin cria as empresas A e B, cada uma com seu admin_empresa;
--   3  cada usuário só enxerga as empresas e os vínculos a que pertence;
--   4  o mesmo usuário tem papéis diferentes em A e em B;
--   5  admin de A não mexe em B; SDR não se promove; ninguém altera vínculo
--      por UPDATE direto;
--   6  a empresa não fica sem admin_empresa ativo;
--   7  tenant inexistente ou de outra empresa nunca dá acesso;
--   8  a empresa de arquivo é somente leitura e não é criada pela RPC.
-- ===========================================================================

begin;

do $$
declare
  u_super    uuid := '10000000-0000-0000-0000-000000000001';
  u_a_admin  uuid := '10000000-0000-0000-0000-00000000000a';
  u_a_sdr    uuid := '10000000-0000-0000-0000-0000000000a5';
  u_b_admin  uuid := '10000000-0000-0000-0000-00000000000b';
  u_multi    uuid := '10000000-0000-0000-0000-0000000000ab';
  u_sem      uuid := '10000000-0000-0000-0000-000000000000';
  t_a        uuid;
  t_b        uuid;
  t_arq      uuid;
  v_n        bigint;
  v_papel    public.tenant_papel;
begin
  -- Fixtures (como dono do banco)
  insert into auth.users (id, email) values
    (u_super,   'super@teste.invalid'),
    (u_a_admin, 'a.admin@teste.invalid'),
    (u_a_sdr,   'a.sdr@teste.invalid'),
    (u_b_admin, 'b.admin@teste.invalid'),
    (u_multi,   'multi@teste.invalid'),
    (u_sem,     'sem.vinculo@teste.invalid');
  insert into public.super_admins (user_id) values (u_super);

  -- 1. Usuário comum não cria empresa nem vira Super Admin
  perform set_config('request.jwt.claims', json_build_object('sub', u_a_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.provisionar_tenant('Empresa X', 'empresa-x', 'assinante', u_a_admin);
    assert false, 'usuário comum não deveria criar empresa';
  exception when insufficient_privilege then
    raise notice 'ok 1a usuário comum não cria empresa pela RPC';
  end;

  begin
    insert into public.super_admins (user_id) values (u_a_admin);
    assert false, 'usuário comum não deveria se inserir em super_admins';
  exception when insufficient_privilege then
    raise notice 'ok 1b usuário comum não vira Super Admin por INSERT direto';
  end;

  begin
    insert into public.tenants (nome, slug) values ('Direta', 'direta');
    assert false, 'usuário comum não deveria inserir empresa direto';
  exception when insufficient_privilege then
    raise notice 'ok 1c usuário comum não cria empresa por INSERT direto';
  end;

  assert not public.is_super_admin(), 'usuário comum não é Super Admin';

  -- 2. Super Admin cria A e B
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated')::text, true);
  assert public.is_super_admin(), 'Super Admin deveria ser reconhecido';
  t_a := public.provisionar_tenant('Empresa A', 'empresa-a', 'assinante', u_a_admin);
  t_b := public.provisionar_tenant('Empresa B', 'empresa-b', 'assinante', u_b_admin);
  perform public.definir_membro_tenant(t_a, u_multi, 'gerente');
  perform public.definir_membro_tenant(t_b, u_multi, 'sdr');

  begin
    perform public.provisionar_tenant('Arquivo', 'arquivo-x', 'arquivo', u_a_admin);
    assert false, 'a RPC não deveria criar empresa de arquivo';
  exception when invalid_parameter_value then
    raise notice 'ok 2a empresa de arquivo não é criada pela RPC';
  end;
  raise notice 'ok 2  Super Admin criou A e B com seus admins';

  -- 3. Cada um só vê o que pertence a ele
  perform set_config('request.jwt.claims', json_build_object('sub', u_a_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.tenants;
  assert v_n = 1, format('admin de A deveria ver 1 empresa, viu %s', v_n);
  assert exists (select 1 from public.tenants where id = t_a), 'admin de A deveria ver A';
  assert not exists (select 1 from public.tenants where id = t_b), 'admin de A NÃO deveria ver B';
  assert not exists (select 1 from public.tenant_memberships where tenant_id = t_b), 'admin de A NÃO deveria ver vínculos de B';
  assert not public.membro_do_tenant(t_b), 'admin de A não é membro de B';
  raise notice 'ok 3a admin de A não enxerga a empresa B nem seus vínculos';

  perform set_config('request.jwt.claims', json_build_object('sub', u_sem, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.tenants;
  assert v_n = 0, 'usuário sem vínculo não deveria ver empresas';
  select count(*) into v_n from public.tenants_do_usuario();
  assert v_n = 0, 'usuário sem vínculo não tem empresas';
  raise notice 'ok 3b usuário sem vínculo não enxerga nada';

  -- 4. Papéis diferentes por empresa
  perform set_config('request.jwt.claims', json_build_object('sub', u_multi, 'role', 'authenticated')::text, true);
  assert public.papel_no_tenant(t_a) = 'gerente', 'multi deveria ser gerente em A';
  assert public.papel_no_tenant(t_b) = 'sdr', 'multi deveria ser sdr em B';
  assert public.tem_papel_no_tenant(t_a, array['gerente']::public.tenant_papel[]), 'multi tem gerente em A';
  assert not public.tem_papel_no_tenant(t_b, array['gerente', 'admin_empresa']::public.tenant_papel[]), 'multi NÃO é gerente em B';
  select count(*) into v_n from public.tenant_memberships where tenant_id = t_b;
  assert v_n = 1, format('sdr em B só deveria ver o próprio vínculo, viu %s', v_n);
  begin
    perform public.exigir_papel_no_tenant(t_b, array['gerente', 'admin_empresa']::public.tenant_papel[]);
    assert false, 'exigir_papel deveria barrar sdr pedindo gerente';
  exception when insufficient_privilege then
    raise notice 'ok 4  papéis por empresa: gerente em A, sdr em B, sem vazamento';
  end;

  -- 5. Elevação de privilégio e escrita cruzada
  perform set_config('request.jwt.claims', json_build_object('sub', u_a_admin, 'role', 'authenticated')::text, true);
  perform public.definir_membro_tenant(t_a, u_a_sdr, 'sdr');
  begin
    perform public.definir_membro_tenant(t_b, u_a_admin, 'admin_empresa');
    assert false, 'admin de A não deveria se colocar em B';
  exception when insufficient_privilege then
    raise notice 'ok 5a admin de A não cria vínculo em B';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_a_sdr, 'role', 'authenticated')::text, true);
  begin
    perform public.definir_membro_tenant(t_a, u_a_sdr, 'admin_empresa');
    assert false, 'sdr não deveria se promover';
  exception when insufficient_privilege then
    raise notice 'ok 5b sdr não se promove pela RPC';
  end;
  begin
    update public.tenant_memberships set papel = 'admin_empresa' where user_id = u_a_sdr;
    assert false, 'sdr não deveria alterar vínculo por UPDATE direto';
  exception when insufficient_privilege then
    raise notice 'ok 5c ninguém altera vínculo por UPDATE direto';
  end;

  -- 6. A empresa não fica sem admin ativo
  perform set_config('request.jwt.claims', json_build_object('sub', u_a_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.definir_membro_tenant(t_a, u_a_admin, 'gerente');
    assert false, 'o único admin não deveria se rebaixar';
  exception when check_violation then
    raise notice 'ok 6a o único admin_empresa não se rebaixa';
  end;
  perform public.definir_membro_tenant(t_a, u_a_sdr, 'admin_empresa');
  perform public.definir_membro_tenant(t_a, u_a_admin, 'gerente');
  perform set_config('request.jwt.claims', json_build_object('sub', u_a_sdr, 'role', 'authenticated')::text, true);
  assert public.papel_no_tenant(t_a) = 'admin_empresa', 'o novo admin deveria estar ativo';
  raise notice 'ok 6b com outro admin ativo, o rebaixamento passa';

  -- 7. Tenant falso ou de outra empresa nunca dá acesso
  assert public.papel_no_tenant(gen_random_uuid()) is null, 'tenant inexistente não dá papel';
  assert not public.membro_do_tenant(t_b), 'admin de A não é membro de B';
  assert not public.pode_escrever_no_tenant(t_b), 'admin de A não escreve em B';
  assert public.papel_no_tenant(null) is null, 'tenant nulo não dá papel';
  raise notice 'ok 7  tenant inexistente, nulo ou alheio não dá acesso';

  -- 8. Empresa de arquivo é somente leitura
  perform set_config('role', 'postgres', true);
  insert into public.tenants (nome, slug, tipo, status) values ('Arquivo de teste T1', 'arquivo-teste-t1', 'arquivo', 'arquivo')
    returning id into t_arq;
  insert into public.tenant_memberships (tenant_id, user_id, papel) values (t_arq, u_multi, 'gerente');
  perform set_config('request.jwt.claims', json_build_object('sub', u_multi, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.membro_do_tenant(t_arq), 'multi lê o arquivo';
  assert not public.pode_escrever_no_tenant(t_arq), 'arquivo é somente leitura';
  begin
    perform set_config('role', 'postgres', true);
    insert into public.tenants (nome, slug, tipo, status) values ('Errado', 'errado', 'arquivo', 'ativo');
    assert false, 'arquivo com status ativo não deveria existir';
  exception when check_violation then
    raise notice 'ok 8  arquivo somente leitura e sempre com status arquivo';
  end;

  perform set_config('role', 'postgres', true);
  raise notice 'tenants_base_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
