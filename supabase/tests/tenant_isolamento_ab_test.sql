-- ===========================================================================
-- Teste A/B do isolamento por empresa (T4 `20261022160000_tenant_isolamento`
-- + T8 `20261022170000_tenant_rpcs`).
--
-- ONDE RODAR: só na cópia LOCAL de teste com M1, T1, T2, T3, T4 e T8
-- aplicadas e os dados legados restaurados. Tudo termina em ROLLBACK. Cria
-- usuários fictícios em auth.users (esqueleto local) — nunca rodar no
-- Supabase real.
--
-- Simula o PostgREST: `request.jwt.claims` (usuário) + `request.headers`
-- (`x-rx7-tenant`, a empresa da aba) + role `authenticated`.
--
-- PROVA:
--   1  mesmo CPF permitido em A e em B; duplicado dentro de A bloqueado;
--   2  A não lê nada de B nem do arquivo; header de empresa alheia = nada;
--   3  A não grava em B (insert com tenant de B, update/delete por id);
--   4  RPCs SECURITY DEFINER de A recusam ids de B;
--   5  referências cruzadas entre empresas são recusadas (FK composta);
--   6  agregados (realizado, metas, dashboard) não misturam A, B e arquivo;
--   7  mesmo usuário com papéis diferentes por empresa, alternando "abas";
--   8  arquivo somente leitura (usuário e service_role); ingestão no
--      arquivo recusada; legado intacto.
-- ===========================================================================

begin;

-- Impersonação (função temporária do teste; some no ROLLBACK)
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
grant execute on function public._teste_como(uuid, text) to authenticated, service_role;

create temp table _base as
select (select count(*) from public.clientes)    as clientes,
       (select count(*) from public.negociacoes) as negociacoes,
       (select count(*) from public.fechamentos) as fechamentos,
       (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c)    as h_cli,
       (select md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.negociacoes n) as h_neg,
       (select md5(string_agg(to_jsonb(f)::text, '|' order by f.negociacao_id)) from public.fechamentos f) as h_fec;
grant select on _base to authenticated;

do $$
declare
  u_super uuid := '30000000-0000-0000-0000-000000000001';
  u_a     uuid := '30000000-0000-0000-0000-00000000000a';  -- admin_empresa de A
  u_a_sdr uuid := '30000000-0000-0000-0000-0000000000a5';  -- sdr de A
  u_b     uuid := '30000000-0000-0000-0000-00000000000b';  -- admin_empresa de B
  u_multi uuid := '30000000-0000-0000-0000-0000000000ab';  -- gerente em A, sdr em B
  v_dono  uuid;
  t_a     uuid;
  t_b     uuid;
  t_arq   uuid := public.tenant_arquivo_id();
  f_a uuid; f_b uuid;
  c_a uuid; c_b uuid;
  n_a uuid; n_b uuid;
  e_a uuid; e_b uuid;
  s_b uuid; ni_b uuid;
  v_n bigint;
  v_num numeric;
  v_r record;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email) values
    (u_super, 'super.ab@teste.invalid'), (u_a, 'a.ab@teste.invalid'), (u_a_sdr, 'asdr.ab@teste.invalid'),
    (u_b, 'b.ab@teste.invalid'), (u_multi, 'multi.ab@teste.invalid');
  -- handle_new_user cria o profile; garante ativo
  insert into public.profiles (id, nome, email, role)
  select u.id, split_part(u.email, '@', 1), u.email, 'closer' from auth.users u
   where u.id in (u_super, u_a, u_a_sdr, u_b, u_multi)
  on conflict (id) do nothing;
  update public.profiles set ativo = true where id in (u_super, u_a, u_a_sdr, u_b, u_multi);
  insert into public.super_admins (user_id) values (u_super);

  select p.id into v_dono from public.profiles p where p.id not in (u_super, u_a, u_a_sdr, u_b, u_multi) limit 1;
  -- Depois do pacote de produção o proprietário já tem esse vínculo.
  insert into public.tenant_memberships (tenant_id, user_id, papel) values (t_arq, v_dono, 'gerente')
  on conflict (tenant_id, user_id) do nothing;

  perform public._teste_como(u_super, null);
  t_a := public.provisionar_tenant('Empresa A', 'empresa-a', 'assinante', u_a);
  t_b := public.provisionar_tenant('Empresa B', 'empresa-b', 'assinante', u_b);

  perform public._teste_como(u_a, 'empresa-a');
  perform public.definir_membro_tenant(t_a, u_a_sdr, 'sdr');
  perform public.definir_membro_tenant(t_a, u_multi, 'gerente');
  perform public._teste_como(u_b, 'empresa-b');
  perform public.definir_membro_tenant(t_b, u_multi, 'sdr');

  -- Cada empresa cria funil, serviço, nicho e cliente (mesmo CPF)
  perform public._teste_como(u_a, 'empresa-a');
  f_a := public.criar_funil('Funil A', 'Ganho', 'verde', 'Perdido', 'vermelho', '[{"nome":"Novo","cor":"azul"}]');
  insert into public.servicos (tenant_id, nome) values (t_a, 'Serviço A');
  c_a := public.criar_cliente('pessoa_fisica', 'Cliente A', p_cpf => '11122233344', p_telefone => '5521900000001', p_funil_id => f_a);
  select id into n_a from public.negociacoes where cliente_id = c_a;
  select id into e_a from public.etapas_funil where funil_id = f_a and tipo = 'aberta';

  perform public._teste_como(u_b, 'empresa-b');
  f_b := public.criar_funil('Funil B', 'Ganho', 'verde', 'Perdido', 'vermelho', '[{"nome":"Novo","cor":"azul"}]');
  insert into public.servicos (tenant_id, nome) values (t_b, 'Serviço A') returning id into s_b;  -- mesmo nome: ok por empresa
  insert into public.nichos (tenant_id, nome, slug, cor, ordem) values (t_b, 'Nicho B', 'nicho-b', 'azul', 1) returning id into ni_b;
  c_b := public.criar_cliente('pessoa_fisica', 'Cliente B', p_cpf => '11122233344', p_telefone => '5521900000002', p_funil_id => f_b);
  select id into n_b from public.negociacoes where cliente_id = c_b;
  select id into e_b from public.etapas_funil where funil_id = f_b and tipo = 'aberta';
  raise notice 'ok 1a mesmo CPF e mesmo nome de serviço aceitos em A e em B';

  perform public._teste_como(u_a, 'empresa-a');
  begin
    perform public.criar_cliente('pessoa_fisica', 'Duplicado A', p_cpf => '11122233344', p_funil_id => f_a);
    assert false, 'CPF duplicado dentro de A deveria falhar';
  exception when unique_violation then
    raise notice 'ok 1b CPF duplicado dentro da mesma empresa é bloqueado';
  end;

  -- ---------------------------------------------------------------- leitura
  select count(*) into v_n from public.clientes;
  assert v_n = 1, format('A deveria ver 1 cliente, viu %s', v_n);
  assert not exists (select 1 from public.clientes where id = c_b), 'A não pode ver cliente de B';
  assert not exists (select 1 from public.clientes where tenant_id = t_arq), 'A não pode ver o arquivo';
  select count(*) into v_n from public.funis;
  assert v_n = 1, format('A deveria ver 1 funil, viu %s', v_n);
  select count(*) into v_n from public.etapas_funil where tenant_id <> t_a;
  assert v_n = 0, 'A não vê etapas de outra empresa';
  select count(*) into v_n from public.profiles where id in (u_b, v_dono);
  assert v_n = 0, 'A não vê perfis de quem não é da empresa';
  select count(*) into v_n from public.nomes_de_usuarios(array[u_b, v_dono]);
  assert v_n = 0, 'nomes_de_usuarios não revela usuários de outra empresa';
  raise notice 'ok 2a A lê só A (clientes, funis, etapas, perfis, nomes)';

  perform public._teste_como(u_a, 'empresa-b');  -- A forjando o header de B
  assert public.tenant_atual() is null, 'header de empresa alheia não vale';
  select count(*) into v_n from public.clientes;
  assert v_n = 0, 'com header alheio, nada é visível';
  begin
    perform public.criar_cliente('pessoa_fisica', 'Forjado', p_funil_id => f_b);
    assert false, 'RPC com header alheio deveria falhar';
  exception when insufficient_privilege then
    raise notice 'ok 2b header de empresa alheia: nada visível e nenhuma RPC';
  end;
  perform public._teste_como(u_a, null);
  select count(*) into v_n from public.clientes;
  assert v_n = 0, 'sem header, nada é visível';
  raise notice 'ok 2c sem empresa na requisição, nada é visível';

  -- ---------------------------------------------------------------- escrita
  perform public._teste_como(u_a, 'empresa-a');
  begin
    insert into public.servicos (tenant_id, nome) values (t_b, 'Invasão');
    assert false, 'A não deveria inserir com tenant de B';
  exception when insufficient_privilege then
    raise notice 'ok 3a A não insere registro com a empresa B';
  end;
  update public.clientes set nome = 'hack' where id = c_b;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'A não altera cliente de B';
  delete from public.servicos where id = s_b;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'A não apaga serviço de B';
  raise notice 'ok 3b A não altera nem apaga registros de B por id';

  -- ---------------------------------------------------------------- RPCs definer
  begin
    perform public.mover_negociacao(n_b, e_b, 1);
    assert false, 'mover negociação de B';
  exception when no_data_found then raise notice 'ok 4a mover_negociacao recusa negociação de B'; end;
  begin
    perform public.atualizar_cliente_do_card(c_b, n_b, 'pessoa_fisica', 'x', null, null, null, null, null, null, null, null, null, null);
    assert false, 'editar cliente de B';
  exception when no_data_found then raise notice 'ok 4b atualizar_cliente_do_card recusa B'; end;
  begin
    perform public.desqualificar_negociacao(n_b, 'x');
    assert false, 'desqualificar B';
  exception when no_data_found then raise notice 'ok 4c desqualificar_negociacao recusa B'; end;
  begin
    perform public.atualizar_dados_operacionais_negociacao(n_b, null, null, 1, null, null, null, null, null);
    assert false, 'dados operacionais B';
  exception when no_data_found then raise notice 'ok 4d atualizar_dados_operacionais recusa B'; end;
  begin
    perform public.atualizar_dados_operacionais_negociacao(n_a, ni_b, null, 1, null, null, null, null, null);
    assert false, 'nicho de B numa negociação de A';
  exception when no_data_found then raise notice 'ok 4e nicho de B recusado em negociação de A'; end;
  begin
    perform public.criar_negociacao(c_b, f_a);
    assert false, 'negociação para cliente de B';
  exception when no_data_found then raise notice 'ok 4f criar_negociacao recusa cliente de B'; end;
  begin
    perform public.anular_fechamento(n_b, 'x');
    assert false, 'anular fechamento de B';
  exception when no_data_found then raise notice 'ok 4g anular_fechamento recusa B'; end;
  select * into v_r from public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Mesmo fone de B', p_telefone => '5521900000002', p_funil_id => f_a);
  assert not v_r.reaproveitado and v_r.cliente_id <> c_b, 'dedup não pode reaproveitar cliente de B';
  raise notice 'ok 4h dedup não cruza empresas (telefone de B gera cliente novo em A)';
  begin
    perform public.criar_cliente('pessoa_fisica', 'Dono errado', p_owner_id => u_b, p_funil_id => f_a);
    assert false, 'dono de outra empresa';
  exception when check_violation then raise notice 'ok 4i owner de outra empresa é recusado'; end;
  begin
    insert into public.permissoes_colaborador (usuario_id, funil_id, pode_ver, pode_mover) values (u_b, f_a, null, null);
    assert false, 'permissão para usuário de outra empresa';
  exception when check_violation then raise notice 'ok 4j permissão para usuário de fora é recusada'; end;
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover) values
    (u_a_sdr, f_a, null, null, null), (u_a_sdr, f_a, e_a, true, true);

  -- ---------------------------------------------------------------- referências cruzadas (dono do banco, sem RLS)
  perform public._teste_como(null, null);
  begin
    insert into public.negociacao_servicos (negociacao_id, servico_id) values (n_a, s_b);
    assert false, 'serviço de B em negociação de A';
  exception when foreign_key_violation then raise notice 'ok 5a FK composta recusa serviço de B em negociação de A'; end;
  begin
    insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem) values (t_a, c_a, e_b, 'manual');
    assert false, 'etapa de B em negociação de A';
  exception when foreign_key_violation or check_violation then raise notice 'ok 5b etapa de B recusada em negociação de A'; end;
  begin
    insert into public.formularios (nicho_id, nome, slug, tenant_id) values (ni_b, 'F', 'f-cruzado', t_a);
    assert false, 'formulário de A com nicho de B';
  exception when check_violation or foreign_key_violation then raise notice 'ok 5c filho com pai de outra empresa é recusado'; end;

  -- ---------------------------------------------------------------- agregados
  perform public._teste_como(u_a, 'empresa-a');
  perform public.fechar_negociacao(n_a, 1, 1000, current_date, true, true, 'pago', 'nao_iniciado', p_tipo_venda => 'tcv');
  perform public._teste_como(u_b, 'empresa-b');
  perform public.fechar_negociacao(n_b, 1, 7000, current_date, true, true, 'pago', 'nao_iniciado', p_tipo_venda => 'tcv');

  perform public._teste_como(u_a, 'empresa-a');
  select realizado_tcv into v_num from public.realizado_periodo('2000-01-01', '2100-01-01') where usuario_id is null;
  assert v_num = 1000, format('realizado de A deveria ser 1000, veio %s', v_num);
  select realizado_tcv into v_num from public.metas_progresso(current_date) where usuario_id is null;
  assert v_num = 1000, format('metas_progresso de A deveria ser 1000, veio %s', v_num);
  select sum(realizado_tcv) into v_num from public.metas_funis_progresso(current_date);
  assert v_num = 1000, format('metas_funis_progresso de A deveria ser 1000, veio %s', v_num);
  select coalesce(sum(valor), 0) into v_num from public.dashboard_vendas_mensais(1200);
  select count(*) into v_n from public.dashboard_por_usuario('2000-01-01', '2100-01-01') where usuario_id in (u_b, v_dono);
  assert v_n = 0, 'dashboard por usuário de A não lista usuários de B nem do arquivo';
  select sum(valor_vendido) into v_num from public.fechamentos;
  assert v_num = 1000, 'A soma só os próprios fechamentos';

  perform public._teste_como(u_b, 'empresa-b');
  select realizado_tcv into v_num from public.realizado_periodo('2000-01-01', '2100-01-01') where usuario_id is null;
  assert v_num = 7000, format('realizado de B deveria ser 7000, veio %s', v_num);

  perform public._teste_como(v_dono, 'arquivo-legado');
  select count(*) into v_n from public.fechamentos;
  assert v_n = (select fechamentos from _base), 'no arquivo, só os fechamentos legados';
  select realizado_tcv into v_num from public.realizado_periodo('2000-01-01', '2100-01-01') where usuario_id is null;
  assert v_num is not null and v_num <> 1000 and v_num <> 7000 and v_num <> 8000, 'arquivo não soma A nem B';
  raise notice 'ok 6  agregados separados: A=1000, B=7000, arquivo só o legado';

  -- ---------------------------------------------------------------- papéis por empresa / "abas"
  perform public._teste_como(u_multi, 'empresa-a');
  assert public.is_gerente(), 'multi é gerente em A';
  select count(*) into v_n from public.clientes;
  assert v_n >= 1, 'gerente de A vê clientes de A';
  perform public._teste_como(u_multi, 'empresa-b');
  assert not public.is_gerente(), 'multi NÃO é gerente em B';
  select count(*) into v_n from public.negociacoes;
  assert v_n = 0, 'sdr de B sem permissão configurada não vê negociações';
  begin
    perform public.mover_negociacao(n_b, e_b, 2);
    assert false, 'sdr sem permissão não move';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_multi, 'empresa-a');
  assert public.is_gerente(), 'voltar para a aba A não herda o papel de B';
  raise notice 'ok 7  mesmo usuário: gerente em A, sdr em B, alternando requisições sem vazamento';

  perform public._teste_como(u_a_sdr, 'empresa-a');
  select count(*) into v_n from public.negociacoes;
  assert v_n >= 1, 'sdr de A com permissão vê negociações de A';
  assert not public.is_gerente(), 'sdr não é gerente';
  select count(*) into v_n from public.membros_empresa_atual();
  assert v_n = 3, format('membros de A deveriam ser 3, vieram %s', v_n);
  assert not exists (select 1 from public.membros_empresa_atual() where usuario_id in (u_b, v_dono)), 'membros de A não incluem B nem o arquivo';
  assert (select role from public.membros_empresa_atual() where usuario_id = u_a) = 'gerente', 'admin_empresa aparece como gerente';

  -- ---------------------------------------------------------------- arquivo
  perform public._teste_como(v_dono, 'arquivo-legado');
  select count(*) into v_n from public.clientes;
  assert v_n = (select clientes from _base), 'dono lê o legado inteiro na empresa de arquivo';
  update public.clientes set nome = nome;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'nenhum registro do arquivo é alterado';
  begin
    insert into public.servicos (tenant_id, nome) values (t_arq, 'novo no arquivo');
    assert false, 'inserir no arquivo';
  exception when insufficient_privilege then null; end;

  perform public._teste_como(null, null);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  begin
    insert into public.servicos (tenant_id, nome) values (t_arq, 'integração no arquivo');
    assert false, 'service_role no arquivo';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ingerir_lead_formulario('ext-ab-1', 'instituicao-ensino-captacao', 'x', 'Lead', '5521999999999');
    assert false, 'ingestão no arquivo';
  -- T8: recusa por empresa somente leitura; T10+: o caminho antigo só procura o formulário na Rio X7.
  exception when insufficient_privilege or no_data_found then null; end;
  perform public._teste_como(null, null);
  raise notice 'ok 8a arquivo somente leitura para usuário e service_role; ingestão no arquivo recusada';

  assert (select count(*) from public.clientes where tenant_id = t_arq) = (select clientes from _base), 'clientes legados';
  assert (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c where tenant_id = t_arq) = (select h_cli from _base), 'conteúdo de clientes legados';
  assert (select md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.negociacoes n where tenant_id = t_arq) = (select h_neg from _base), 'conteúdo de negociações legadas';
  assert (select md5(string_agg(to_jsonb(f)::text, '|' order by f.negociacao_id)) from public.fechamentos f where tenant_id = t_arq) = (select h_fec from _base), 'conteúdo de fechamentos legados';
  raise notice 'ok 8b legado intacto (contagem e conteúdo de clientes, negociações e fechamentos)';

  raise notice 'tenant_isolamento_ab_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
