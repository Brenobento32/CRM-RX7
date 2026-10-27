-- ===========================================================================
-- Teste: Super Admin HÍBRIDO (Super Admin + vínculo admin_empresa em A e B).
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com as migrations
-- 20261028100000 e 20261028110000 aplicadas, o seed local (teste-alfa,
-- teste-beta) e o usuário fictício híbrido ...fe (seed-hibrido.sql).
-- Termina em ROLLBACK.
--
--  1  sem "Acessar CRM", o vínculo NÃO dá acesso a A nem a B (leitura,
--     escrita, RPC, helpers)
--  2  "Acessar CRM" A: só A, como Administrador (gerente); B continua fechado
--  3  continua sem virar carteira, mesmo sendo membro
--  4  abrir B revoga A
--  5  "Encerrar acesso" revoga na hora
--  6  logout / novo login exigem nova autorização
--  7  prazo de 8 h
--  8  Administradores comuns continuam isolados; Super Admin sem vínculo idem
--  9  /admin continua disponível; vínculos e dados históricos intactos
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

create function public._como(p_uid uuid, p_slug text, p_sessao text default 'sessao-1')
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
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessao)::text, true);
  perform set_config('request.headers',
    case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._como(uuid, text, text) to authenticated;

create function public._ok(p_cond boolean, p_nome text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_cond, false) then
    raise exception 'FALHOU: %', p_nome;
  end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated;

do $$
declare
  u_hib   uuid := '60000000-0000-4000-8000-0000000000fe';
  u_super uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a     uuid := '60000000-0000-4000-8000-0000000000a1';
  g_b     uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a     uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b     uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  v_cli_a uuid;
  v_cli   uuid;
  v_neg   uuid;
  v_n     bigint;
  v_erro  text;
  v_msg   text;
  v_tot_clientes bigint;
  v_tot_membros  bigint;
begin
  perform public._como(null, null);
  perform public._ok((select count(*) from public.tenant_memberships where user_id = u_hib and ativo and papel = 'admin_empresa' and tenant_id in (t_a, t_b)) = 2, 'base: híbrido tem vínculo admin_empresa ativo em A e B');
  perform public._ok(exists (select 1 from public.super_admins where user_id = u_hib), 'base: híbrido é Super Admin');
  select id into v_cli_a from public.clientes where tenant_id = t_a order by created_at limit 1;
  perform public._ok(v_cli_a is not null, 'base: A tem cliente para testar leitura/escrita');
  select count(*) into v_tot_clientes from public.clientes;
  select count(*) into v_tot_membros from public.tenant_memberships;

  -- 1 Sem janela: o vínculo não abre nada ------------------------------------
  perform public._como(u_hib, 'teste-alfa');
  perform public._ok(public.tenant_atual() is null, '1a sem janela: tenant_atual() de A é nulo (apesar do vínculo)');
  perform public._ok(public.papel_no_tenant(t_a) is null and public.papel_comercial(u_hib, t_a) is null, '1a ...papel_no_tenant e papel_comercial nulos em A');
  perform public._ok(not public.membro_do_tenant(t_a) and not public.is_gerente() and not public.pode_escrever_no_tenant(t_a), '1a ...helpers (membro, gerente, escrita) negam');
  perform public._ok((select count(*) from public.clientes) = 0, '1b leitura: nenhum cliente de A');
  perform public._ok((select count(*) from public.clientes where tenant_id = t_a) = 0, '1b ...nem filtrando pelo tenant_id de A');
  perform public._ok((select count(*) from public.negociacoes) = 0 and (select count(*) from public.fechamentos) = 0 and (select count(*) from public.eventos) = 0, '1b ...nem negociações, fechamentos, eventos');
  perform public._ok((select count(*) from public.membros_empresa_atual()) = 0, '1b RPC membros_empresa_atual: vazio');
  update public.clientes set observacoes = 'alterado sem janela' where id = v_cli_a;
  get diagnostics v_n = row_count;
  perform public._ok(v_n = 0, '1c alteração direta de cliente de A: 0 linhas');
  begin
    insert into public.clientes (tenant_id, nome, owner_id) values (t_a, 'Invasão híbrida', g_a);
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro is not null, '1c criação direta de cliente em A recusada (' || coalesce(v_erro, 'sem erro') || ')');
  begin
    perform public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Invasão via RPC', p_owner_id => g_a, p_email => 'invasao-hib@teste.invalid');
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro is not null, '1c criação via RPC recusada (' || coalesce(v_erro, 'sem erro') || ')');
  begin
    perform * from public.minha_assinatura();
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro = '42501', '1c RPC minha_assinatura recusada (' || coalesce(v_erro, 'sem erro') || ')');
  perform public._como(u_hib, 'teste-beta');
  perform public._ok(public.tenant_atual() is null and (select count(*) from public.clientes where tenant_id = t_b) = 0, '1d idem para B: vínculo não abre B');
  perform public._ok((select count(*) from public.tenants_do_usuario()) = 0, '1d tenants_do_usuario não lista empresas pelo vínculo');

  -- 2 Acessar A: só A ----------------------------------------------------------
  perform public._como(u_hib, 'teste-alfa');
  perform public._ok(public.admin_acessar_empresa(t_a, 'Suporte (híbrido)') = 'teste-alfa', '2a "Acessar CRM" A');
  perform public._ok(public.tenant_atual() = t_a and public.papel_no_tenant(t_a) = 'gerente', '2a resolve A como Administrador (gerente), não pelo vínculo admin_empresa');
  perform public._ok(exists (select 1 from public.clientes where id = v_cli_a), '2a lê clientes de A');
  perform public._como(u_hib, 'teste-beta');
  perform public._ok(public.tenant_atual() is null and public.papel_no_tenant(t_b) is null, '2b com A aberta, B continua fechada (apesar do vínculo em B)');

  -- 3 Não vira carteira, mesmo sendo membro -----------------------------------
  perform public._como(u_hib, 'teste-alfa');
  begin
    perform public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Carteira do híbrido', p_owner_id => u_hib, p_email => 'hib-proprio@teste.invalid');
    v_erro := null;
  exception when others then v_erro := sqlstate; v_msg := sqlerrm;
  end;
  perform public._ok(v_erro = '23514', '3a híbrido NÃO vira dono de carteira (' || coalesce(v_erro, 'sem erro') || ')');
  select r.cliente_id, r.negociacao_id into v_cli, v_neg
    from public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Cliente do híbrido para Ana', p_owner_id => g_a, p_email => 'hib-para-ana@teste.invalid') r;
  perform public._ok((select owner_id from public.clientes where id = v_cli) = g_a, '3b cria cliente com a Ana como responsável');

  -- 4 Abrir B revoga A -----------------------------------------------------------
  perform public._como(u_hib, 'teste-beta');
  perform public.admin_acessar_empresa(t_b, 'Conferência (híbrido)');
  perform public._ok(public.tenant_atual() = t_b, '4 abriu B');
  perform public._como(u_hib, 'teste-alfa');
  perform public._ok(public.tenant_atual() is null and not exists (select 1 from public.clientes where id = v_cli), '4 A revogada no banco (vínculo não a mantém)');

  -- 5 Encerrar acesso -------------------------------------------------------------
  perform public._como(u_hib, 'teste-beta');
  perform public.admin_encerrar_acesso_empresa(t_b);
  perform public._ok(public.tenant_atual() is null and (select count(*) from public.clientes) = 0, '5 "Encerrar acesso" revoga B na hora');

  -- 6 Logout / novo login --------------------------------------------------------
  perform public._como(u_hib, 'teste-alfa', 'sessao-1');
  perform public.admin_acessar_empresa(t_a, null);
  perform public._ok(public.tenant_atual() = t_a, '6 nova janela em A');
  perform public._como(u_hib, 'teste-alfa', 'sessao-2');
  perform public._ok(public.tenant_atual() is null, '6 outra sessão (novo login) não usa a janela');
  perform public._como(u_hib, 'teste-alfa', 'sessao-1');
  v_n := public.encerrar_meus_acessos_globais('logout');
  perform public._ok(v_n = 1, '6 logout encerra a janela aberta (' || v_n || ')');
  perform public._ok(public.tenant_atual() is null, '6 depois do logout, o vínculo não devolve o acesso');

  -- 7 Prazo -------------------------------------------------------------------------
  perform public._como(u_hib, 'teste-alfa', 'sessao-3');
  perform public.admin_acessar_empresa(t_a, null);
  perform public._como(null, null);
  update public.super_admin_acessos set iniciado_em = now() - interval '9 hours', expira_em = now() - interval '1 hour'
   where user_id = u_hib and encerrado_em is null;
  perform public._como(u_hib, 'teste-alfa', 'sessao-3');
  perform public._ok(public.tenant_atual() is null and public.papel_no_tenant(t_a) is null, '7 janela vencida (8 h): sem acesso, mesmo com vínculo');

  -- 8 Administradores comuns e Super Admin sem vínculo -----------------------------
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(public.tenant_atual() = t_a and public.papel_no_tenant(t_a) = 'admin_empresa' and exists (select 1 from public.clientes where id = v_cli), '8a Administrador de A: A pelo vínculo, vê o cliente');
  perform public._como(g_a, 'teste-beta');
  perform public._ok(public.tenant_atual() is null and (select count(*) from public.clientes where tenant_id = t_b) = 0, '8a ...e nada de B');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(public.tenant_atual() = t_b and not exists (select 1 from public.clientes where id = v_cli), '8b Administrador de B: só B');
  perform public._como(g_b, 'teste-alfa');
  perform public._ok(public.tenant_atual() is null, '8b ...e nada de A');
  perform public._como(u_super, 'teste-alfa');
  perform public._ok(public.tenant_atual() is null, '8c Super Admin sem vínculo: sem janela, nada');
  perform public.admin_acessar_empresa(t_a, 'Sem vínculo');
  perform public._ok(public.tenant_atual() = t_a and public.papel_no_tenant(t_a) = 'gerente', '8c ...com janela, A como Administrador');

  -- 9 /admin e histórico -------------------------------------------------------------
  perform public._como(u_hib, null);
  perform public._ok(public.is_super_admin(), '9a híbrido continua Super Admin (/admin)');
  perform public._ok((select count(*) from public.admin_listar_empresas(null)) >= 2, '9a painel lista as empresas');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(exists (select 1 from public.membros_empresa_atual() where usuario_id = u_hib), '9b o vínculo do híbrido continua registrado (visível ao Administrador de A)');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.tenant_memberships) = v_tot_membros, '9b nenhum vínculo perdido');
  perform public._ok((select count(*) from public.tenant_memberships where user_id = u_hib and ativo) = 2, '9b vínculos do híbrido intactos e ativos');
  perform public._ok((select count(*) from public.clientes) = v_tot_clientes + 1, '9c clientes: só o criado no teste foi somado');
  perform public._ok((select observacoes from public.clientes where id = v_cli_a) is distinct from 'alterado sem janela', '9c cliente de A não foi alterado sem janela');
  perform public._ok((select count(*) from public.admin_auditoria where acao = 'acesso_empresa_iniciado' and ator_id = u_hib) >= 4, '9d concessões do híbrido auditadas');
end;
$$;

-- ===========================================================================
-- 10  Responsável comercial nunca é Super Admin (qualquer um, com ou sem vínculo)
-- ===========================================================================
create function public._recusa(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'aceito';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function public._recusa(text) to authenticated;

do $$
declare
  u_hib   uuid := '60000000-0000-4000-8000-0000000000fe';
  u_super uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a     uuid := '60000000-0000-4000-8000-0000000000a1';
  c_a     uuid := '60000000-0000-4000-8000-0000000000a2';
  t_a     uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  v_cli   uuid;
  v_hist  uuid;
  v_r     text;
  v_cfg   uuid;
begin
  -- Os dois Super Admins com vínculo em A (o ...ff só dentro deste teste).
  perform public._como(null, null);
  insert into public.tenant_memberships (tenant_id, user_id, papel) values (t_a, u_super, 'gerente') on conflict (tenant_id, user_id) do update set ativo = true;
  select lead_responsavel_id into v_cfg from public.tenant_configuracoes where tenant_id = t_a;
  -- Processo automático (sem usuário logado) também não põe Super Admin como dono.
  v_r := public._recusa(format($q$insert into public.clientes (tenant_id, nome, owner_id) values (%L, 'Automático para SA', %L)$q$, t_a, u_hib));
  perform public._ok(v_r like '23514:%Responsável automático inválido%', '10a processo automático (sem usuário) com Super Admin dono é recusado (' || left(v_r, 60) || ')');
  -- Registro HISTÓRICO com Super Admin dono (como os de produção, gravados antes da regra).
  set local session_replication_role = replica;
  insert into public.clientes (tenant_id, nome, owner_id) values (t_a, 'Histórico do híbrido', u_hib) returning id into v_hist;
  set local session_replication_role = origin;

  -- Administrador comum de A
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$insert into public.clientes (tenant_id, nome, owner_id) values (%L, 'Para o híbrido', %L)$q$, t_a, u_hib));
  perform public._ok(v_r like '23514:%não assume carteira%', '10b Administrador de A: cliente com Super Admin híbrido como dono é recusado (' || v_r || ')');
  v_r := public._recusa(format($q$insert into public.clientes (tenant_id, nome, owner_id) values (%L, 'Para o outro SA', %L)$q$, t_a, u_super));
  perform public._ok(v_r like '23514:%não assume carteira%', '10b ...com o OUTRO Super Admin também (' || v_r || ')');
  v_r := public._recusa(format($q$select public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Via RPC', p_owner_id => %L, p_email => 'rpc-sa@teste.invalid')$q$, u_hib));
  perform public._ok(v_r like '23514:%', '10c via RPC (parâmetro manipulado) também recusado (' || left(v_r, 40) || ')');
  select r.cliente_id into v_cli from public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Cliente do Caio', p_owner_id => c_a, p_email => 'caio-dono@teste.invalid') r;
  perform public._ok((select owner_id from public.clientes where id = v_cli) = c_a, '10d usuário operacional ativo (Closer) pode ser o dono');
  v_r := public._recusa(format($q$update public.clientes set owner_id = %L where id = %L$q$, u_hib, v_cli));
  perform public._ok(v_r like '23514:%', '10e trocar o dono para Super Admin é recusado');
  v_r := public._recusa(format($q$insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id) values ('Reunião SA', now() + interval '2 days', now() + interval '2 days 1 hour', %L, %L)$q$, v_cli, u_hib));
  perform public._ok(v_r like '23514:%', '10f reunião com Super Admin responsável é recusada');
  v_r := public._recusa(format($q$insert into public.metas (tenant_id, usuario_id, tipo_meta, periodo_mes, valor_meta) values (%L, %L, 'tcv', date_trunc('month', now())::date, 1000)$q$, t_a, u_hib));
  perform public._ok(v_r like '23514:%', '10g meta para Super Admin é recusada');
  v_r := public._recusa(format($q$update public.tenant_configuracoes set lead_responsavel_id = %L where tenant_id = %L$q$, u_hib, t_a));
  perform public._ok((v_r like '23514:%' or v_r like '42501:%' or v_r = 'aceito') and (select lead_responsavel_id from public.tenant_configuracoes where tenant_id = t_a) is not distinct from v_cfg,
    '10h responsável padrão de leads não vira Super Admin (' || left(v_r, 30) || ', RLS/validação)');
  -- O caminho que grava essa configuração com usuário logado também passa pela validação:
  perform public._como(null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', g_a, 'role', 'authenticated')::text, true);
  v_r := public._recusa(format($q$update public.tenant_configuracoes set lead_responsavel_id = %L where tenant_id = %L$q$, u_hib, t_a));
  perform public._ok(v_r like '23514:%não assume carteira%', '10h ...nem por quem consegue gravar (dono do banco com usuário logado): ' || left(v_r, 30));
  perform public._como(g_a, 'teste-alfa');

  -- Histórico: editar sem trocar o dono passa; reatribuir a um operacional passa.
  update public.clientes set observacoes = 'editado sem trocar o dono' where id = v_hist;
  perform public._ok((select owner_id = u_hib and observacoes = 'editado sem trocar o dono' from public.clientes where id = v_hist), '10i registro histórico do Super Admin: edição sem trocar o dono passa (nada é reatribuído sozinho)');
  update public.clientes set owner_id = c_a where id = v_hist;
  perform public._ok((select owner_id from public.clientes where id = v_hist) = c_a, '10j ...e o Administrador pode reatribuir a um operacional');

  -- Super Admin híbrido no acesso global: autor sim, dono não.
  perform public._como(u_hib, 'teste-alfa', 'sessao-10');
  perform public.admin_acessar_empresa(t_a, 'Teste responsável');
  v_r := public._recusa(format($q$insert into public.clientes (tenant_id, nome, owner_id) values (%L, 'SA para o outro SA', %L)$q$, t_a, u_super));
  perform public._ok(v_r like '23514:%não assume carteira%', '10k híbrido no acesso global não atribui a outro Super Admin');
  insert into public.atividades (cliente_id, tipo, descricao) values (v_cli, 'nota', 'Nota do híbrido');
  perform public._ok((select usuario_id from public.atividades where cliente_id = v_cli and descricao = 'Nota do híbrido') = u_hib, '10l híbrido cria atividade como AUTOR');
  update public.clientes set observacoes = 'editado pelo híbrido' where id = v_cli;
  perform public._ok((select owner_id = c_a and observacoes = 'editado pelo híbrido' from public.clientes where id = v_cli), '10l ...e edita o cliente sem virar dono');

  -- Super Admin sem vínculo (fora do teste) no acesso global: idem.
  perform public._como(null, null);
  delete from public.tenant_memberships where tenant_id = t_a and user_id = u_super;
  perform public._como(u_super, 'teste-alfa', 'sessao-11');
  perform public.admin_acessar_empresa(t_a, 'Teste responsável sem vínculo');
  v_r := public._recusa(format($q$insert into public.clientes (tenant_id, nome, owner_id) values (%L, 'SA sem vínculo para híbrido', %L)$q$, t_a, u_hib));
  perform public._ok(v_r like '23514:%não assume carteira%', '10m Super Admin sem vínculo não atribui ao híbrido');
  select r.cliente_id into v_cli from public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'SA sem vínculo para Ana', p_owner_id => g_a, p_email => 'sa-sem-vinculo@teste.invalid') r;
  perform public._ok((select owner_id from public.clientes where id = v_cli) = g_a, '10n ...e cria com um Administrador da empresa como dono');

  perform public._como(null, null);
  perform public._ok((select lead_responsavel_id from public.tenant_configuracoes where tenant_id = t_a) is not distinct from v_cfg, '10o configuração de leads não foi alterada');
end;
$$;

-- ===========================================================================
-- 11  Ingestão automática de leads: nunca cai no Super Admin
-- ===========================================================================
do $$
declare
  u_hib uuid := '60000000-0000-4000-8000-0000000000fe';
  c_a   uuid := '60000000-0000-4000-8000-0000000000a2';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  v_cfg uuid;
  v_r   text;
  v_cli uuid;
  v_n   bigint;
begin
  perform public._como(null, null);
  select lead_responsavel_id into v_cfg from public.tenant_configuracoes where tenant_id = t_a;
  -- Estado de produção: responsável padrão de leads = Super Admin (gravado antes da regra).
  set local session_replication_role = replica;
  update public.tenant_configuracoes set lead_responsavel_id = u_hib where tenant_id = t_a;
  set local session_replication_role = origin;
  select count(*) into v_n from public.clientes where tenant_id = t_a;

  v_r := public._recusa(format($q$select public.ingerir_lead_tenant(%L, 'ext-sa-1', null, null, 'Lead para SA', '21999990001', 'lead-sa@teste.invalid', null, null, null, null)$q$, t_a));
  perform public._ok(v_r like '23514:%Responsável automático inválido%', '11a lead com responsável padrão = Super Admin é recusado com mensagem clara (' || left(v_r, 60) || ')');
  perform public._ok((select count(*) from public.clientes where tenant_id = t_a) = v_n, '11a ...e nenhum cliente foi criado para o Super Admin');
  perform public._ok(not exists (select 1 from public.negociacoes where external_id = 'ext-sa-1'), '11a ...nem negociação');

  -- Configuração corrigida (operação autorizada pelo dono do banco): Closer de A.
  update public.tenant_configuracoes set lead_responsavel_id = c_a where tenant_id = t_a;
  select r.cliente_id into v_cli from public.ingerir_lead_tenant(t_a, 'ext-sa-1', null, null, 'Lead para SA', '21999990001', 'lead-sa@teste.invalid', null, null, null, null) r;
  perform public._ok((select owner_id from public.clientes where id = v_cli) = c_a, '11b depois de configurar um operacional, o MESMO lead reenviado entra com ele como dono');
  perform public._ok((select owner_id from public.negociacoes where external_id = 'ext-sa-1') = c_a, '11b ...e a negociação também');

  -- Contato que já existe com dono Super Admin (histórico): a nova negociação herdaria o Super Admin → recusada.
  set local session_replication_role = replica;
  insert into public.clientes (tenant_id, nome, telefone, owner_id) values (t_a, 'Contato histórico SA', '21999990002', u_hib);
  set local session_replication_role = origin;
  v_r := public._recusa(format($q$select public.ingerir_lead_tenant(%L, 'ext-sa-2', null, null, 'Contato histórico SA', '21999990002', null, null, null, null, null)$q$, t_a));
  perform public._ok(v_r like '23514:%', '11c lead de contato histórico do Super Admin: recusado (a carteira precisa ser reatribuída), não vira negociação do SA (' || left(v_r, 40) || ')');

  update public.tenant_configuracoes set lead_responsavel_id = v_cfg where tenant_id = t_a;
end;
$$;


-- ===========================================================================
-- 12  Empresa nova: Super Admin nunca vira administrador nem responsável de leads
-- ===========================================================================
do $$
declare
  u_hib   uuid := '60000000-0000-4000-8000-0000000000fe';
  u_super uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a     uuid := '60000000-0000-4000-8000-0000000000a1';
  v_r     text;
  v_t     uuid;
begin
  perform public._como(u_super, null);
  v_r := public._recusa(format($q$select public.provisionar_empresa('Empresa Nova SA', 'empresa-nova-sa', %L)$q$, u_hib));
  perform public._ok(v_r like '42501:%administrador inicial%', '12a Super Admin como administrador inicial de empresa nova é recusado (' || left(v_r, 50) || ')');
  v_r := public._recusa(format($q$select public.provisionar_empresa('Empresa Nova SA2', 'empresa-nova-sa2', %L)$q$, u_super));
  perform public._ok(v_r like '42501:%administrador inicial%', '12a ...nem ele mesmo');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.tenants where slug in ('empresa-nova-sa', 'empresa-nova-sa2')), '12a ...e nada foi criado (nem empresa, nem vínculo)');

  perform public._como(u_super, null);
  v_t := public.provisionar_empresa('Empresa Nova Ok', 'empresa-nova-ok', g_a);
  perform public._como(null, null);
  perform public._ok((select lead_responsavel_id from public.tenant_configuracoes where tenant_id = v_t) = g_a, '12b empresa nova com administrador comum: ele é o responsável padrão de leads');
  perform public._ok(not exists (select 1 from public.tenant_memberships m join public.super_admins s using (user_id) where m.tenant_id = v_t), '12b ...e nenhum Super Admin ganhou vínculo');
end;
$$;

rollback;
