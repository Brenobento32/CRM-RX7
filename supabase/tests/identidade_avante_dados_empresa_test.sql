-- ===========================================================================
-- Teste: identidade GLOBAL do AVANTE CRM × dados da empresa cliente.
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com 20261028100000..120000
-- aplicadas e os usuários fictícios do seed local (inclusive o Super Admin
-- híbrido ...fe). Termina em ROLLBACK.
--
--  1  leitura pública da identidade (anon), tabela fechada
--  2  só Super Admin troca/remove logo do AVANTE CRM (com ou sem vínculo,
--     sem precisar de "Acessar CRM"); caminho validado; auditado
--  3  Super Admin edita nome, nome comercial, contato, responsável, logo e
--     observações de qualquer empresa; auditado
--  4  observações são internas: nenhuma empresa lê; Administrador não edita
--     nome comercial nem observações; versão antiga da RPC não mexe nelas
--  5  isolamento: Administrador de A não lê os dados de B
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
grant execute on function public._recusa(text) to authenticated, anon;

do $$
declare
  u_hib   uuid := '60000000-0000-4000-8000-0000000000fe';
  u_super uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a     uuid := '60000000-0000-4000-8000-0000000000a1';
  g_b     uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a     uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b     uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  v_r     text;
  v_aud   bigint;
  v_nome_a text;
begin
  perform public._como(null, null);
  select count(*) into v_aud from public.admin_auditoria;
  select nome into v_nome_a from public.tenants where id = t_a;

  -- 1 Leitura pública ---------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform public._ok((select count(*) from public.identidade_plataforma()) = 1, '1a anon lê a identidade do AVANTE CRM (login sem sessão)');
  v_r := public._recusa('select * from public.plataforma_identidade');
  perform public._ok(v_r like '42501:%', '1b ...mas não a tabela diretamente (' || left(v_r, 30) || ')');
  v_r := public._recusa($q$select public.admin_definir_logo_plataforma('claro', 'logo-claro.png')$q$);
  perform public._ok(v_r like '42501:%', '1c anon não troca logo');
  perform public._como(null, null);

  -- 2 Logo do AVANTE CRM -------------------------------------------------------
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa($q$select public.admin_definir_logo_plataforma('claro', 'logo-claro.png')$q$);
  perform public._ok(v_r like '42501:%', '2a Administrador de empresa NÃO troca a logo do AVANTE CRM (' || left(v_r, 30) || ')');
  v_r := public._recusa('update public.plataforma_identidade set logo_claro_path = ''logo-claro.png''');
  perform public._ok(v_r like '42501:%', '2a ...nem direto na tabela');

  perform public._como(u_hib, null);
  perform public.admin_definir_logo_plataforma('claro', 'logo-claro.png');
  perform public.admin_definir_logo_plataforma('escuro', 'logo-escuro.webp');
  perform public._ok((select logo_claro_path = 'logo-claro.png' and logo_escuro_path = 'logo-escuro.webp' from public.identidade_plataforma()),
    '2b Super Admin (híbrido, sem "Acessar CRM") troca as duas logos');
  v_r := public._recusa($q$select public.admin_definir_logo_plataforma('claro', '../outro-bucket/x.png')$q$);
  perform public._ok(v_r like '22023:%', '2c caminho fora do padrão é recusado');
  v_r := public._recusa($q$select public.admin_definir_logo_plataforma('claro', 'logo-escuro.png')$q$);
  perform public._ok(v_r like '22023:%', '2c ...logo de uma variante não vai para a outra');
  v_r := public._recusa($q$select public.admin_definir_logo_plataforma('roxo', null)$q$);
  perform public._ok(v_r like '22023:%', '2c ...variante inexistente recusada');
  perform public.admin_definir_logo_plataforma('escuro', null);
  perform public._ok((select logo_escuro_path is null and logo_claro_path = 'logo-claro.png' from public.identidade_plataforma()),
    '2d remover a logo escura não mexe na clara (o app volta à oficial só na escura)');
  perform public._como(u_super, null);
  perform public.admin_definir_logo_plataforma('claro', null);
  perform public._ok((select logo_claro_path is null from public.identidade_plataforma()), '2e Super Admin sem vínculo também administra a identidade');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.admin_auditoria where acao in ('identidade_logo_alterada', 'identidade_logo_removida')) >= 4
    and exists (select 1 from public.admin_auditoria where acao = 'identidade_logo_alterada' and ator_id = u_hib and detalhes ->> 'variante' = 'claro'),
    '2f trocas e remoções de logo auditadas (ator e variante)');

  -- 3 Dados da empresa pelo Super Admin ------------------------------------------
  perform public._como(u_super, null);
  perform public.admin_atualizar_empresa(t_b, 'Teste Beta', 'Beta Comércio Ltda', '(21) 99999-0000', 'Contato@Beta.Test', 'Bruno', null, 'Cliente piloto; renovar em março.');
  perform public._como(null, null);
  perform public._ok((select nome_comercial = 'Beta Comércio Ltda' and telefone = '21999990000' and email = 'contato@beta.test' and responsavel_nome = 'Bruno' from public.tenants where id = t_b),
    '3a Super Admin edita nome comercial, telefone, e-mail e responsável de qualquer empresa');
  perform public._ok((select texto from public.tenant_observacoes_admin where tenant_id = t_b) = 'Cliente piloto; renovar em março.', '3b ...e as observações internas');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'empresa_dados_alterados' and tenant_id = t_b and (detalhes ->> 'observacoes')::boolean), '3c alteração auditada');
  perform public._como(u_super, null);
  perform public._ok(public.admin_observacoes_empresa(t_b) = 'Cliente piloto; renovar em março.', '3d Super Admin lê as observações');
  -- versão antiga (6 parâmetros) continua valendo e não apaga os campos novos
  perform public.admin_atualizar_empresa(t_b, 'Teste Beta', '21999990000', 'contato@beta.test', 'Bruno', null);
  perform public._como(null, null);
  perform public._ok((select nome_comercial from public.tenants where id = t_b) = 'Beta Comércio Ltda'
    and (select count(*) from public.tenant_observacoes_admin where tenant_id = t_b) = 1, '3e versão antiga da RPC não apaga nome comercial nem observações');
  perform public._como(u_super, null);
  perform public.admin_atualizar_empresa(t_b, 'Teste Beta', 'Beta Comércio Ltda', null, null, null, null, '   ');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.tenant_observacoes_admin where tenant_id = t_b), '3f observação em branco remove a observação');

  -- 4 Observações internas e limites do Administrador ------------------------------
  perform public._como(u_super, null);
  perform public.admin_atualizar_empresa(t_a, v_nome_a, 'Alfa Comercial', null, null, null, null, 'Nota interna da Alfa');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select nome_comercial from public.tenants where id = t_a) = 'Alfa Comercial', '4a Administrador de A vê o nome comercial da própria empresa');
  v_r := public._recusa('select texto from public.tenant_observacoes_admin');
  perform public._ok(v_r like '42501:%', '4b ...mas NÃO lê as observações internas (tabela)');
  v_r := public._recusa(format('select public.admin_observacoes_empresa(%L)', t_a));
  perform public._ok(v_r like '42501:%', '4b ...nem pela RPC');
  v_r := public._recusa(format($q$select public.admin_atualizar_empresa(%L, 'Alfa', 'Outro nome', null, null, null, null, 'x')$q$, t_a));
  perform public._ok(v_r like '42501:%', '4c Administrador não usa a edição do Super Admin (' || left(v_r, 30) || ')');
  v_r := public._recusa(format($q$update public.tenants set nome_comercial = 'Hack' where id = %L$q$, t_a));
  perform public._como(null, null);
  perform public._ok((select nome_comercial from public.tenants where id = t_a) = 'Alfa Comercial', '4c ...nem troca o nome comercial direto na tabela (' || left(v_r, 30) || ')');

  -- 5 Isolamento ----------------------------------------------------------------------
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(not exists (select 1 from public.tenants where id = t_b), '5a Administrador de A não lê o cadastro de B');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.tenants where id = t_a), '5b Administrador de B não lê o cadastro de A');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.admin_auditoria) > v_aud, '5c auditoria cresceu (nada apagado)');
end;
$$;

rollback;
