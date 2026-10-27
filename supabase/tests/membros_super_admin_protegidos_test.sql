-- ===========================================================================
-- Teste: vínculos de Super Admin protegidos + auditoria de vínculos.
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com 20261028100000..20261029100000
-- aplicadas e o seed local (teste-alfa, teste-beta, Super Admin híbrido ...fe).
-- Termina em ROLLBACK.
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
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessao)::text, true);
  perform set_config('request.headers', case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._como(uuid, text, text) to authenticated;

create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated;

create function public._recusa(p_sql text)
returns text language plpgsql as $$
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
  u_hib   uuid := '60000000-0000-4000-8000-0000000000fe';  -- Super Admin híbrido (vínculo em A e B)
  u_super uuid := '60000000-0000-4000-8000-0000000000ff';  -- Super Admin sem vínculo
  g_a     uuid := '60000000-0000-4000-8000-0000000000a1';  -- Administrador de A
  c_a     uuid := '60000000-0000-4000-8000-0000000000a2';  -- Closer de A
  g_b     uuid := '60000000-0000-4000-8000-0000000000b1';  -- Administrador de B
  t_a     uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b     uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  v_r     text;
  v_aud   bigint;
  v_antes text;
begin
  perform public._como(null, null);
  select string_agg(tenant_id::text || papel || ativo, ',' order by tenant_id) into v_antes from public.tenant_memberships where user_id = u_hib;
  select count(*) into v_aud from public.admin_auditoria;

  -- 1 Administrador de empresa × vínculo de Super Admin ---------------------------
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.definir_membro_tenant(%L, %L, 'closer', true)$q$, t_a, u_hib));
  perform public._ok(v_r like '42501:%Super Admin%', '1a Administrador de A NÃO reclassifica o vínculo do Super Admin (' || left(v_r, 45) || ')');
  v_r := public._recusa(format($q$select public.definir_membro_tenant(%L, %L, 'admin_empresa', false)$q$, t_a, u_hib));
  perform public._ok(v_r like '42501:%Super Admin%', '1b ...nem desativa');
  v_r := public._recusa(format($q$select public.definir_membro_tenant(%L, %L, 'gerente', true)$q$, t_a, u_super));
  perform public._ok(v_r like '42501:%Super Admin%', '1c ...nem cria vínculo para um Super Admin sem vínculo');
  v_r := public._recusa(format($q$update public.tenant_memberships set papel = 'closer' where tenant_id = %L and user_id = %L$q$, t_a, u_hib));
  perform public._ok(v_r like '42501:%', '1d ...nem altera direto pela API (' || left(v_r, 30) || ')');
  v_r := public._recusa(format($q$delete from public.tenant_memberships where tenant_id = %L and user_id = %L$q$, t_a, u_hib));
  perform public._ok(v_r like '42501:%', '1e ...nem remove pela API');
  v_r := public._recusa(format($q$insert into public.super_admins (user_id) values (%L)$q$, g_a));
  perform public._ok(v_r like '42501:%', '1f ...nem concede privilégio global a si mesmo');

  -- 2 Administrador continua gerindo os operacionais da própria empresa -----------
  perform public.definir_membro_tenant(t_a, c_a, 'sdr', true);
  perform public._ok((select papel from public.tenant_memberships where tenant_id = t_a and user_id = c_a) = 'sdr', '2a Administrador de A muda o cargo de um operacional de A');
  perform public.definir_membro_tenant(t_a, c_a, 'closer', false);
  perform public._ok((select papel = 'closer' and not ativo from public.tenant_memberships where tenant_id = t_a and user_id = c_a), '2b ...e desativa');
  perform public.definir_membro_tenant(t_a, c_a, 'closer', true);
  perform public._ok((select ativo from public.tenant_memberships where tenant_id = t_a and user_id = c_a), '2c ...e reativa');

  -- 3 Empresa A não mexe em B ---------------------------------------------------------
  v_r := public._recusa(format($q$select public.definir_membro_tenant(%L, %L, 'closer', true)$q$, t_b, g_b));
  perform public._ok(v_r like '42501:%', '3 Administrador de A não altera usuário da Empresa B (' || left(v_r, 30) || ')');

  -- 4 Super Admin: manutenção legítima, auditada --------------------------------------
  perform public._como(u_super, null);
  perform public.definir_membro_tenant(t_b, u_hib, 'closer', true);
  perform public._ok((select papel from public.tenant_memberships where tenant_id = t_b and user_id = u_hib) = 'closer', '4a Super Admin ajusta o vínculo de um Super Admin (manutenção)');
  perform public.definir_membro_tenant(t_b, u_hib, 'admin_empresa', true);
  perform public._ok((select papel from public.tenant_memberships where tenant_id = t_b and user_id = u_hib) = 'admin_empresa', '4b ...e restaura');

  -- 5 Auditoria ---------------------------------------------------------------------
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'membro_alterado' and ator_id = g_a and tenant_id = t_a
                              and detalhes ->> 'usuario' = c_a::text and detalhes ->> 'papel_antes' = 'closer' and detalhes ->> 'papel_depois' = 'sdr'
                              and detalhes ->> 'origem' = 'usuario'),
                     '5a mudança de cargo auditada: quem, quem foi afetado, empresa, antes e depois');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'membro_alterado' and ator_id = g_a and detalhes ->> 'usuario' = c_a::text
                              and detalhes ->> 'ativo_antes' = 'true' and detalhes ->> 'ativo_depois' = 'false'),
                     '5b desativação auditada (estado antes/depois)');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'membro_alterado' and ator_id = u_super and tenant_id = t_b
                              and (detalhes ->> 'super_admin_afetado')::boolean),
                     '5c manutenção do Super Admin auditada, marcando que o afetado é Super Admin');
  perform public._ok(not exists (select 1 from public.admin_auditoria where acao like 'membro_%' and detalhes::text ~* '(senha|password|token|secret)'),
                     '5d auditoria sem senha/token');
  perform public._ok((select count(*) from public.admin_auditoria where acao like 'membro_%') - 0 >= 5 and (select count(*) from public.admin_auditoria) > v_aud,
                     '5e recusas não gravaram nada; mudanças gravaram');

  -- 6 Processo do sistema (sem usuário) continua podendo e é auditado -----------------
  update public.tenant_memberships set papel = 'gerente' where tenant_id = t_b and user_id = u_hib;
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'membro_alterado' and ator_id is null and detalhes ->> 'origem' = 'sistema'), '6 manutenção do sistema auditada como origem "sistema"');
  update public.tenant_memberships set papel = 'admin_empresa' where tenant_id = t_b and user_id = u_hib;

  -- 7 Histórico preservado ---------------------------------------------------------------
  perform public._ok((select string_agg(tenant_id::text || papel || ativo, ',' order by tenant_id) from public.tenant_memberships where user_id = u_hib) = v_antes,
                     '7 vínculos do Super Admin híbrido iguais ao início');
end;
$$;

rollback;
