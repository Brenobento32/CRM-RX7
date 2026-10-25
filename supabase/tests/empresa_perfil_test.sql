-- ===========================================================================
-- Teste das propostas `supabase/propostas/20261027100000_empresa_papeis_enum`
-- e `20261027100100_empresa_perfil` (dados da empresa, papéis, slug).
--
-- ONDE RODAR: só numa cópia LOCAL (`crm_rx7_*`) com as duas propostas
-- aplicadas. Tudo termina em ROLLBACK. Nunca rodar no Supabase real.
--
-- PROVA:
--   1  vendedor/atendente com cargo PRÓPRIO (não herdam Closer/SDR);
--   2  slug reservado é recusado na criação;
--   3  troca de slug: só Super Admin, com motivo, auditada;
--   4  slug antigo nunca vai para outra empresa;
--   5  slug antigo resolve só para membro da empresa (nada vaza para outros);
--   6  dados: Super Admin tudo (RPC admin); Gerente só contato/logo da própria;
--      a RPC do Super Admin é recusada ao Gerente; outros cargos, não;
--   7  logo só na pasta da própria empresa.
-- ===========================================================================

begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

create function public._teste_como(p_uid uuid, p_slug text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._teste_como(uuid, text) to authenticated, service_role;

do $$
declare
  u_super uuid := '50000000-0000-0000-0000-000000000001';
  u_a     uuid := '50000000-0000-0000-0000-00000000000a';  -- admin_empresa de A
  u_a_ven uuid := '50000000-0000-0000-0000-0000000000a1';  -- vendedor de A
  u_a_ate uuid := '50000000-0000-0000-0000-0000000000a2';  -- atendente de A
  u_b     uuid := '50000000-0000-0000-0000-00000000000b';  -- admin_empresa de B
  t_a uuid; t_b uuid;
  v_txt text;
begin
  insert into auth.users (id, email) values
    (u_super, 'super.emp@teste.invalid'), (u_a, 'a.emp@teste.invalid'), (u_a_ven, 'aven.emp@teste.invalid'),
    (u_a_ate, 'aate.emp@teste.invalid'), (u_b, 'b.emp@teste.invalid');
  insert into public.profiles (id, nome, email, role)
  select u.id, split_part(u.email, '@', 1), u.email, 'closer' from auth.users u
   where u.id in (u_super, u_a, u_a_ven, u_a_ate, u_b)
  on conflict (id) do nothing;
  update public.profiles set ativo = true where id in (u_super, u_a, u_a_ven, u_a_ate, u_b);
  insert into public.super_admins (user_id) values (u_super);

  perform public._teste_como(u_super, null);
  t_a := public.provisionar_tenant('Empresa A', 'empresa-a', 'assinante', u_a);
  t_b := public.provisionar_tenant('Empresa B', 'empresa-b', 'assinante', u_b);

  -- 1. papéis novos
  perform set_config('role', 'postgres', true);
  insert into public.tenant_memberships (tenant_id, user_id, papel) values
    (t_a, u_a_ven, 'vendedor'), (t_a, u_a_ate, 'atendente');
  assert public.papel_comercial(u_a_ven, t_a) = 'vendedor', 'vendedor tem cargo próprio (não vira closer)';
  assert public.papel_comercial(u_a_ate, t_a) = 'atendente', 'atendente tem cargo próprio (não vira sdr)';
  raise notice 'ok 1 vendedor/atendente com cargo próprio';

  -- 2. slug reservado
  perform public._teste_como(u_super, null);
  begin
    perform public.provisionar_tenant('Agenda', 'agenda', 'assinante', u_b);
    assert false, 'slug reservado deveria ser recusado';
  exception when check_violation then
    raise notice 'ok 2 slug reservado recusado';
  end;

  -- 3. troca de slug: admin da empresa não pode; Super Admin pode, auditado
  perform public._teste_como(u_a, 'empresa-a');
  begin
    perform public.admin_alterar_slug(t_a, 'empresa-a-nova', 'Rebranding');
    assert false, 'admin da empresa não pode trocar o slug';
  exception when insufficient_privilege or raise_exception then
    null;
  end;
  perform public._teste_como(u_super, null);
  begin
    perform public.admin_alterar_slug(t_a, 'empresa-a-nova', '');
    assert false, 'troca sem motivo deveria ser recusada';
  exception when invalid_parameter_value then
    null;
  end;
  perform public.admin_alterar_slug(t_a, 'empresa-a-nova', 'Rebranding');
  perform set_config('role', 'postgres', true);
  assert (select slug from public.tenants where id = t_a) = 'empresa-a-nova', 'slug deveria ter mudado';
  assert exists (select 1 from public.tenant_slugs_antigos where slug = 'empresa-a' and tenant_id = t_a), 'slug antigo no histórico';
  assert exists (select 1 from public.admin_auditoria where acao = 'empresa_slug_alterado' and tenant_id = t_a), 'troca auditada';
  raise notice 'ok 3 troca de slug só pelo Super Admin, com motivo, auditada';

  -- 4. slug antigo nunca vai para outra empresa
  perform public._teste_como(u_super, null);
  begin
    perform public.admin_alterar_slug(t_b, 'empresa-a', 'Tentativa');
    assert false, 'outra empresa não pode herdar slug antigo';
  exception when unique_violation then
    raise notice 'ok 4 slug antigo não muda de dono';
  end;

  -- 5. resolver slug antigo: membro sim, de fora nada
  perform public._teste_como(u_a_ven, null);
  assert public.resolver_slug_antigo('empresa-a') = 'empresa-a-nova', 'membro deveria resolver o slug antigo';
  perform public._teste_como(u_b, null);
  assert public.resolver_slug_antigo('empresa-a') is null, 'quem não é membro não pode descobrir o slug novo';
  raise notice 'ok 5 slug antigo resolve só para membro';

  -- 6. dados da empresa
  perform public._teste_como(u_super, null);
  perform public.admin_atualizar_empresa(t_a, 'Empresa A Ltda', '(11) 98888-7777', 'Contato@A.com', 'Fulana', t_a::text || '/logo.png');
  perform set_config('role', 'postgres', true);
  select nome || '|' || telefone || '|' || email || '|' || responsavel_nome into v_txt from public.tenants where id = t_a;
  assert v_txt = 'Empresa A Ltda|11988887777|contato@a.com|Fulana', 'Super Admin: dados normalizados: ' || coalesce(v_txt, 'nulo');
  perform public._teste_como(u_a, 'empresa-a-nova');
  begin
    perform public.admin_atualizar_empresa(t_a, 'Gerente renomeia', null, null, null, null);
    assert false, 'a RPC do Super Admin é recusada ao gerente';
  exception when insufficient_privilege or raise_exception then
    null;
  end;
  perform public.empresa_atualizar_contato('(11) 97777-0000', 'novo@a.com', 'Beltrana', null);
  perform set_config('role', 'postgres', true);
  select nome || '|' || telefone || '|' || responsavel_nome into v_txt from public.tenants where id = t_a;
  assert v_txt = 'Empresa A Ltda|11977770000|Beltrana', 'gerente muda só contato (nome intacto): ' || coalesce(v_txt, 'nulo');
  perform public._teste_como(u_a_ven, 'empresa-a-nova');
  begin
    perform public.empresa_atualizar_contato('1100000000', null, null, null);
    assert false, 'vendedor não altera dados da empresa';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', 'postgres', true);
  assert (select nome from public.tenants where id = t_b) = 'Empresa B', 'B intacta';
  raise notice 'ok 6 Super Admin edita tudo; gerente só contato/logo da própria; outros não';

  -- 7. logo fora da pasta
  perform public._teste_como(u_a, 'empresa-a-nova');
  begin
    perform public.empresa_atualizar_contato(null, null, null, t_b::text || '/logo.png');
    assert false, 'logo na pasta de outra empresa deveria ser recusada';
  exception when check_violation then
    raise notice 'ok 7 logo só na pasta da própria empresa';
  end;
end;
$$;

rollback;
