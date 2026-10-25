-- ===========================================================================
-- Teste do bucket `empresa-logos` (upload, troca, leitura, outras empresas).
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com 100000..100300 aplicadas e
-- um schema `storage` que imite o do Supabase (tabela objects com RLS e o
-- índice único de (bucket_id, name)). Termina em ROLLBACK.
--
-- Cada upload roda a MESMA consulta que o Storage executa (log de produção,
-- "UpsertObject"): INSERT ... ON CONFLICT DO UPDATE ... RETURNING *.
--
--  1  admin A envia o logo da própria empresa
--  2  admin A troca o logo (mesmo caminho)
--  3  gerente (não admin) A troca o logo
--  4  Super Admin envia logo de B
--  5  admin B não envia/troca logo na pasta de A
--  6  admin B não lê, não altera e não apaga o objeto de A
--  7  closer A não envia nem lê logo
--  8  admin A não grava na pasta de B nem fora de uma pasta de empresa
--  9  admin A lê o próprio logo; bucket continua público (exibição por URL)
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

create function public._como(p_uid uuid, p_slug text)
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
grant execute on function public._como(uuid, text) to authenticated;

-- A consulta do Storage (UpsertObject), como o usuário atual.
create function public._subir(p_nome text, p_versao text)
returns integer
language plpgsql
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n integer;
begin
  with r as (
    insert into storage.objects (name, owner, owner_id, bucket_id, metadata, version)
    values (p_nome, v_uid, v_uid::text, 'empresa-logos', '{"mimetype": "image/png"}'::jsonb, p_versao)
    on conflict (bucket_id, name collate "C") where archived_at is null
    do update set metadata = excluded.metadata, version = excluded.version,
                  owner = excluded.owner, owner_id = excluded.owner_id
    returning *
  ) select count(*) into v_n from r;
  return v_n;
end;
$$;
grant execute on function public._subir(text, text) to authenticated;

do $$
declare
  u_super uuid := '71000000-0000-4000-8000-0000000000ff';
  g_a   uuid := '71000000-0000-4000-8000-0000000000a1';
  g2_a  uuid := '71000000-0000-4000-8000-0000000000a2';
  clo_a uuid := '71000000-0000-4000-8000-0000000000a3';
  g_b   uuid := '71000000-0000-4000-8000-0000000000b1';
  t_a uuid; t_b uuid; v_n bigint; v_txt text;
begin
  insert into auth.users (id, email)
  select x, 'logo-' || right(x::text, 2) || '@teste.invalid' from unnest(array[u_super, g_a, g2_a, clo_a, g_b]) x;
  insert into public.profiles (id, nome, email, role)
  select u.id, 'Logo ' || right(u.id::text, 2), u.email, 'closer' from auth.users u where u.email like 'logo-%@teste.invalid'
  on conflict (id) do nothing;
  update public.profiles set ativo = true where email like 'logo-%@teste.invalid';
  insert into public.super_admins (user_id) values (u_super);

  perform public._como(u_super, null);
  t_a := public.provisionar_tenant('Logos A', 'logos-a', 'assinante', g_a);
  t_b := public.provisionar_tenant('Logos B', 'logos-b', 'assinante', g_b);
  perform set_config('role', 'postgres', true);
  insert into public.tenant_memberships (tenant_id, user_id, papel) values
    (t_a, g2_a, 'gerente'), (t_a, clo_a, 'closer');

  -- 1. upload inicial
  perform public._como(g_a, 'logos-a');
  assert public._subir(t_a || '/logo.png', 'v1') = 1, 'admin A envia o logo da própria empresa';
  raise notice 'ok 1 admin A envia o logo';

  -- 2. troca (mesmo caminho: cai no ON CONFLICT DO UPDATE)
  assert public._subir(t_a || '/logo.png', 'v2') = 1, 'admin A troca o logo';
  perform set_config('role', 'postgres', true);
  select count(*), max(version) into v_n, v_txt from storage.objects where bucket_id = 'empresa-logos' and name = t_a || '/logo.png';
  assert v_n = 1 and v_txt = 'v2', 'troca substitui o mesmo objeto (veio ' || v_n || ' / ' || coalesce(v_txt, 'nulo') || ')';
  raise notice 'ok 2 admin A troca o logo';

  -- 3. gerente (não admin) da mesma empresa
  perform public._como(g2_a, 'logos-a');
  assert public._subir(t_a || '/logo.png', 'v3') = 1, 'gerente A troca o logo';
  raise notice 'ok 3 gerente A troca o logo';

  -- 4. Super Admin
  perform public._como(u_super, null);
  assert public._subir(t_b || '/logo.png', 'b1') = 1, 'Super Admin envia logo de B';
  raise notice 'ok 4 Super Admin envia logo de B';

  -- 5. outra empresa não grava na pasta de A (nem novo arquivo, nem troca)
  perform public._como(g_b, 'logos-b');
  begin
    perform public._subir(t_a || '/logo.png', 'invasor');
    assert false, 'admin B não troca o logo de A';
  exception when insufficient_privilege then null; end;
  begin
    perform public._subir(t_a || '/logo.webp', 'invasor');
    assert false, 'admin B não cria arquivo na pasta de A';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 5 admin B não grava na pasta de A';

  -- 6. outra empresa não lê, não altera e não apaga o objeto de A
  select count(*) into v_n from storage.objects where bucket_id = 'empresa-logos' and name like t_a || '/%';
  assert v_n = 0, 'admin B não lê objetos de A (veio ' || v_n || ')';
  update storage.objects set version = 'invasor' where bucket_id = 'empresa-logos' and name like t_a || '/%';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'admin B não altera objeto de A';
  delete from storage.objects where bucket_id = 'empresa-logos' and name like t_a || '/%';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'admin B não apaga objeto de A';
  raise notice 'ok 6 admin B não lê, não altera e não apaga objeto de A';

  -- 7. cargo sem gestão (closer) da própria empresa
  perform public._como(clo_a, 'logos-a');
  begin
    perform public._subir(t_a || '/logo.png', 'closer');
    assert false, 'closer A não troca o logo';
  exception when insufficient_privilege then null; end;
  select count(*) into v_n from storage.objects where bucket_id = 'empresa-logos';
  assert v_n = 0, 'closer não lê objetos do bucket pela API (veio ' || v_n || ')';
  raise notice 'ok 7 closer A não envia nem lê';

  -- 8. admin A fora da própria pasta
  perform public._como(g_a, 'logos-a');
  begin
    perform public._subir(t_b || '/logo.png', 'invasor');
    assert false, 'admin A não troca o logo de B';
  exception when insufficient_privilege then null; end;
  begin
    perform public._subir('logo.png', 'raiz');
    assert false, 'admin A não grava fora de uma pasta de empresa';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 8 admin A não grava em B nem fora de pasta';

  -- 9. leitura do próprio logo; bucket público para exibir pela URL
  select count(*) into v_n from storage.objects where bucket_id = 'empresa-logos';
  assert v_n = 1, 'admin A lê só o próprio logo (veio ' || v_n || ')';
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*), max(version) into v_n, v_txt from storage.objects where bucket_id = 'empresa-logos' and name = t_a || '/logo.png';
  assert v_n = 1 and v_txt = 'v3', 'logo de A intacto depois das tentativas (veio ' || coalesce(v_txt, 'nulo') || ')';
  assert (select public::text in ('true', 't') from storage.buckets where id = 'empresa-logos'), 'bucket público para exibir o logo';
  raise notice 'ok 9 admin A lê o próprio logo; bucket público';
end;
$$;

rollback;
