-- ===========================================================================
-- Teste: acesso global do Super Admin aos CRMs × isolamento das empresas.
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com a migration
-- 20261028100000_super_admin_acesso_empresas aplicada e os usuários
-- fictícios do seed local (teste-alfa, teste-beta). Termina em ROLLBACK.
--
--  1  sem janela, a URL de uma empresa não dá acesso (nem ao Super Admin)
--  2  "Acessar CRM" A: resolve A como Administrador; auditado com motivo
--  3  autoria × carteira: cliente, negociação, reunião, atividade, fechamento
--  4  o Administrador de A trabalha depois com esses registros; B não vê nada
--  5  troca A → B encerra A no banco (auditado)
--  6  janela presa à sessão: outra sessão (novo login/outro navegador) não usa
--  7  logout/novo login (encerrar_meus_acessos_globais) revoga tudo, auditado
--  8  prazo de 8 h: janela vencida não vale
--  9  Administrador de A: nada de B (URL/header, tenant_id, gravação, RPC)
-- 10  ninguém além do Super Admin abre/forja janelas nem vira Super Admin
-- 11  Administrador não troca plano, endereço nem tenant_id
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

-- Age como p_uid na empresa p_slug, na sessão p_sessao (claim session_id do JWT).
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
  u_super uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a     uuid := '60000000-0000-4000-8000-0000000000a1';
  sdr_a   uuid := '60000000-0000-4000-8000-0000000000a3';
  g_b     uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a     uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b     uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  v_n     bigint;
  v_txt   text;
  v_erro  text;
  v_msg   text;
  v_aud   bigint;
  v_cli   uuid;
  v_neg   uuid;
  v_evt   uuid;
begin
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.tenant_memberships where user_id = u_super), 'base: Super Admin sem vínculo de empresa');
  perform public._ok(exists (select 1 from public.super_admins where user_id = u_super), 'base: Super Admin está em super_admins');
  perform public._ok(not exists (select 1 from public.super_admins where user_id in (g_a, g_b, sdr_a)), 'base: Administradores e SDR não são Super Admin');
  select count(*) into v_aud from public.admin_auditoria where acao like 'acesso_empresa_%';

  -- 1 -----------------------------------------------------------------------
  perform public._como(u_super, 'teste-alfa');
  perform public._ok(public.tenant_atual() is null, '1 sem janela: tenant_atual() da URL de A é nulo');
  perform public._ok((select count(*) from public.clientes) = 0, '1 sem janela: nenhum cliente de A');

  -- 2 -----------------------------------------------------------------------
  v_txt := public.admin_acessar_empresa(t_a, 'Suporte (teste)');
  perform public._ok(v_txt = 'teste-alfa', '2 "Acessar CRM" A devolve o endereço de A');
  perform public._ok(public.tenant_atual() = t_a and public.papel_no_tenant(t_a) = 'gerente', '2 resolve A, papel de Administrador');

  -- 3 Autoria × carteira -------------------------------------------------------
  begin
    perform public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Cliente SA carteira própria', p_owner_id => u_super, p_email => 'sa-proprio@teste.invalid');
    v_erro := null;
  exception when others then v_erro := sqlstate; v_msg := sqlerrm;
  end;
  perform public._ok(v_erro = '23514' and v_msg like 'Escolha um usuário ativo da empresa%', '3a Super Admin NÃO vira dono de carteira (' || coalesce(v_erro, 'sem erro') || ')');

  select r.cliente_id, r.negociacao_id into v_cli, v_neg
    from public.criar_ou_reaproveitar_cliente('pessoa_fisica', 'Cliente SA para Ana', p_owner_id => g_a, p_email => 'sa-para-ana@teste.invalid') r;
  perform public._ok(v_cli is not null and v_neg is not null, '3b Super Admin cria cliente + negociação com um responsável da empresa');
  perform public._ok((select owner_id from public.clientes where id = v_cli) = g_a, '3b dono do cliente = Administrador escolhido (não o Super Admin)');
  perform public._ok((select owner_id from public.negociacoes where id = v_neg) = g_a, '3b dono da negociação = o mesmo responsável');
  perform public._ok((select tenant_id from public.clientes where id = v_cli) = t_a, '3b cliente nasceu na empresa A');

  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao) values (v_cli, v_neg, 'nota', 'Nota do Super Admin');
  perform public._ok((select usuario_id from public.atividades where cliente_id = v_cli and descricao = 'Nota do Super Admin') = u_super, '3c atividade: autor = Super Admin');

  begin
    insert into public.eventos (titulo, inicio, fim, cliente_id) values ('Reunião sem responsável', now() + interval '1 day', now() + interval '1 day 1 hour', v_cli);
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro = '23514', '3d reunião com o Super Admin como responsável é recusada (' || coalesce(v_erro, 'sem erro') || ')');
  insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id) values ('Reunião do SA para Ana', now() + interval '1 day', now() + interval '1 day 1 hour', v_cli, g_a)
  returning id into v_evt;
  perform public._ok((select usuario_id = g_a and criado_por = u_super from public.eventos where id = v_evt), '3d reunião: responsável = Ana, criada por = Super Admin');

  perform public.fechar_negociacao(v_neg, 1, 1500, current_date, true, true, 'pago', 'nao_iniciado', p_tipo_venda => 'tcv');
  perform public._ok((select responsavel_id = g_a and fechado_por = u_super from public.fechamentos where negociacao_id = v_neg), '3e fechamento: responsável = dono da negociação, fechado por = Super Admin');

  -- 4 Depois: o Administrador de A trabalha; B não vê ----------------------------
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(exists (select 1 from public.clientes where id = v_cli), '4a Administrador de A vê o cliente criado pelo Super Admin');
  update public.clientes set observacoes = 'Retomado pela Ana' where id = v_cli;
  perform public._ok((select observacoes from public.clientes where id = v_cli) = 'Retomado pela Ana', '4a ...e edita o cliente');
  perform public._ok(exists (select 1 from public.eventos where id = v_evt), '4b Administrador de A vê a reunião (responsável dele)');
  perform public._ok(exists (select 1 from public.fechamentos where negociacao_id = v_neg), '4c Administrador de A vê o fechamento');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.clientes where id = v_cli) and not exists (select 1 from public.eventos where id = v_evt) and not exists (select 1 from public.fechamentos where negociacao_id = v_neg), '4d Administrador de B não vê nada disso');
  perform public._como(g_b, 'teste-alfa');
  perform public._ok(not exists (select 1 from public.clientes where id = v_cli), '4d ...nem com a URL/header de A');

  -- 5 Troca A → B ---------------------------------------------------------------
  perform public._como(u_super, 'teste-beta');
  perform public.admin_acessar_empresa(t_b, 'Conferência (teste)');
  perform public._ok(public.tenant_atual() = t_b, '5 abriu B');
  perform public._como(u_super, 'teste-alfa');
  perform public._ok(public.tenant_atual() is null, '5 ao abrir B, a janela de A foi encerrada no banco');
  perform public._ok(not exists (select 1 from public.clientes where id = v_cli), '5 aba antiga de A não lê mais A');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'acesso_empresa_encerrado' and tenant_id = t_a and detalhes ->> 'motivo' = 'troca de empresa'), '5 encerramento de A auditado como troca de empresa');

  -- 6 Sessão ----------------------------------------------------------------------
  perform public._como(u_super, 'teste-beta', 'sessao-2');
  perform public._ok(public.tenant_atual() is null, '6 outra sessão (novo login/outro navegador) não usa a janela de B');
  perform public._ok(not exists (select 1 from public.clientes where tenant_id = t_b), '6 ...nem lê B pelo tenant_id');
  perform public._como(u_super, 'teste-beta', 'sessao-1');
  perform public._ok(public.tenant_atual() = t_b, '6 a sessão que abriu continua com acesso');

  -- 7 Logout / novo login -----------------------------------------------------------
  perform public._ok(public.encerrar_meus_acessos_globais('logout') = 1, '7 logout encerra a janela aberta (1)');
  perform public._ok(public.tenant_atual() is null, '7 depois do logout, a mesma sessão não acessa B');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(public.encerrar_meus_acessos_globais('logout') = 0, '7 logout de quem não é Super Admin não faz nada');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'acesso_empresa_encerrado' and tenant_id = t_b and detalhes ->> 'motivo' = 'logout'), '7 encerramento por logout auditado');
  perform public._ok(not exists (select 1 from public.super_admin_acessos where user_id = u_super and encerrado_em is null), '7 nenhuma janela aberta sobrou');

  -- 8 Prazo -------------------------------------------------------------------------
  perform public._como(u_super, 'teste-alfa', 'sessao-3');
  perform public.admin_acessar_empresa(t_a, null);
  perform public._ok(public.tenant_atual() = t_a, '8 nova janela em A (sessão 3)');
  perform public._como(null, null);
  update public.super_admin_acessos set iniciado_em = now() - interval '9 hours', expira_em = now() - interval '1 hour'
   where user_id = u_super and encerrado_em is null;
  perform public._como(u_super, 'teste-alfa', 'sessao-3');
  perform public._ok(public.tenant_atual() is null, '8 janela vencida (8 h) não dá acesso');

  -- 9 Administrador de A × B -----------------------------------------------------------
  perform public._como(g_a, 'teste-beta');
  perform public._ok(public.tenant_atual() is null and public.papel_no_tenant(t_b) is null, '9 Administrador de A com URL/header de B: nada');
  perform public._ok((select count(*) from public.clientes where tenant_id = t_b) = 0, '9 ...nem pelo tenant_id direto');
  perform public._como(g_a, 'teste-alfa');
  begin
    insert into public.clientes (tenant_id, nome, owner_id) values (t_b, 'Invasão', g_a);
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro is not null, '9 Administrador de A não grava em B (' || coalesce(v_erro, 'sem erro') || ')');
  begin
    perform public.admin_acessar_empresa(t_b, 'tentativa');
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro = '42501', '9 Administrador não usa "Acessar CRM" (42501)');

  -- 10 Privilégio global ---------------------------------------------------------------
  perform public._como(null, null);
  insert into public.super_admin_acessos (user_id, tenant_id, sessao_id, expira_em) values (g_a, t_b, 'sessao-1', now() + interval '1 hour');
  perform public._como(g_a, 'teste-beta');
  perform public._ok(public.tenant_atual() is null, '10 janela forjada para quem não é Super Admin não vale');
  begin
    insert into public.super_admins (user_id) values (g_a);
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro = '42501', '10 Administrador não se torna Super Admin');
  begin
    select count(*) into v_n from public.super_admin_acessos;
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro = '42501', '10 Administrador não lê nem grava janelas de acesso');

  -- 11 Identidade e plano ----------------------------------------------------------------
  perform public._como(g_a, 'teste-alfa');
  begin
    update public.tenants set slug = 'outro-endereco' where id = t_a;
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro = '42501', '11 Administrador não altera a empresa (endereço/identidade)');
  begin
    update public.clientes set tenant_id = t_b where id = v_cli;
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._como(null, null);
  perform public._ok((select tenant_id from public.clientes where id = v_cli) = t_a, '11 Administrador não move registro para outra empresa (' || coalesce(v_erro, 'sem efeito') || ')');
  perform public._como(g_a, 'teste-alfa');
  begin
    perform public.admin_definir_assinatura(t_a, 'pro', 'ativa', 'mensal', null, null, null, null, 'teste');
    v_erro := null;
  exception when others then v_erro := sqlstate;
  end;
  perform public._ok(v_erro is not null, '11 Administrador não muda o plano (' || coalesce(v_erro, 'sem erro') || ')');

  perform public._como(null, null);
  -- 3 concessões (A, B, A) e 2 encerramentos (A na troca, B no logout).
  perform public._ok((select count(*) from public.admin_auditoria where acao like 'acesso_empresa_%') = v_aud + 5, '12 auditoria: 3 concessões + 2 encerramentos registrados');
  raise notice 'TODOS OS CENÁRIOS PASSARAM';
end;
$$;

rollback;
