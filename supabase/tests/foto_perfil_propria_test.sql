set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: foto do próprio perfil (migration 20261113090000).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  F1–F3  qualquer cargo envia, troca e apaga a PRÓPRIA foto; nunca a de outra pessoa
--  F4–F5  o Administrador continua gerindo a foto da equipe da empresa dele; o de outra empresa não
--  F6     anônimo não grava
--  F7–F8  foto_url só aceita a URL da pasta do próprio perfil no bucket avatares
--  F9     nada de clientes, negociações ou configurações muda
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
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._como(uuid, text) to authenticated, anon;
create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated, anon;
create function public._recusa(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'aceito';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function public._recusa(text) to authenticated, anon;
-- A gravação do Storage (upsert do objeto), como o usuário atual. Só as colunas
-- comuns a todas as versões do schema storage (a cópia local tem a mínima).
create function public._subir(p_nome text)
returns integer language plpgsql as $$
declare v_uid uuid := (select auth.uid()); v_n integer;
begin
  with r as (
    insert into storage.objects (bucket_id, name, owner) values ('avatares', p_nome, v_uid)
    on conflict (bucket_id, name) do update set owner = excluded.owner
    returning *
  ) select count(*) into v_n from r;
  return v_n;
end;
$$;
grant execute on function public._subir(text) to authenticated, anon;

-- Produção tem as policies do gerente (20260923190000); a cópia local de teste não. Mesmas definições.
do $p$
begin
  if not exists (select 1 from pg_policy where polname = 'avatares_gerente_insert') then
    create policy avatares_gerente_select on storage.objects for select to authenticated using (bucket_id = 'avatares' and public.is_gerente());
    create policy avatares_gerente_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatares' and public.is_gerente());
    create policy avatares_gerente_update on storage.objects for update to authenticated
      using (bucket_id = 'avatares' and public.is_gerente()) with check (bucket_id = 'avatares' and public.is_gerente());
    create policy avatares_gerente_delete on storage.objects for delete to authenticated using (bucket_id = 'avatares' and public.is_gerente());
  end if;
end;
$p$;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1'; -- Administrador da Teste Alfa
  clo_a uuid := '60000000-0000-4000-8000-0000000000a2'; -- Closer da Teste Alfa
  ven_a uuid := '60000000-0000-4000-8000-0000000000a4'; -- Vendedor da Teste Alfa
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1'; -- Administrador da Teste Beta
  base  text := 'https://projeto-local.supabase.co/storage/v1/object/public/avatares/';
  v_r text; v_n integer; v_cli bigint; v_neg bigint; v_cfg text;
begin
  perform public._como(null, null);
  select count(*) into v_cli from public.clientes;
  select count(*) into v_neg from public.negociacoes;
  select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.tenant_id), '')) into v_cfg from public.tenant_configuracoes t;

  -- ================================================================= F1 a própria foto (qualquer cargo)
  perform public._como(ven_a, 'teste-alfa');
  perform public._ok(public._subir(ven_a || '/11111111-1111-4111-8111-111111111111.png') = 1, 'F1 Vendedor envia a própria foto');
  perform public._ok(public._subir(ven_a || '/11111111-1111-4111-8111-111111111111.png') = 1, 'F1 ...e troca (mesmo caminho)');
  perform public._como(clo_a, 'teste-alfa');
  perform public._ok(public._subir(clo_a || '/22222222-2222-4222-8222-222222222222.webp') = 1, 'F1 Closer envia a própria foto');

  -- ================================================================= F2 nunca na pasta de outra pessoa
  perform public._como(ven_a, 'teste-alfa');
  v_r := public._recusa(format('select public._subir(%L)', clo_a || '/33333333-3333-4333-8333-333333333333.png'));
  perform public._ok(v_r like '42501:%', 'F2 Vendedor não grava na pasta do Closer');
  v_r := public._recusa(format('select public._subir(%L)', 'sem-dono.png'));
  perform public._ok(v_r like '42501:%', 'F2 ...nem fora de uma pasta de usuário');
  update storage.objects set owner = ven_a where bucket_id = 'avatares' and name like clo_a || '/%';
  delete from storage.objects where bucket_id = 'avatares' and name like clo_a || '/%';
  perform public._como(null, null);
  perform public._ok((select count(*) = 1 and bool_and(owner = clo_a) from storage.objects where bucket_id = 'avatares' and name like clo_a || '/%'),
                     'F2 ...nem altera nem apaga a foto do Closer');

  -- ================================================================= F3 apagar a própria
  perform public._como(clo_a, 'teste-alfa');
  delete from storage.objects where bucket_id = 'avatares' and name like clo_a || '/%';
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from storage.objects where bucket_id = 'avatares' and name like clo_a || '/%'), 'F3 Closer apaga a própria foto');

  -- ================================================================= F4–F5 Administrador (comportamento de antes)
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(public._subir(clo_a || '/44444444-4444-4444-8444-444444444444.jpg') = 1, 'F4 Administrador continua gerindo a foto da equipe');
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa(format('select public._subir(%L)', ven_a || '/55555555-5555-4555-8555-555555555555.png'));
  perform public._ok(v_r like '42501:%', 'F5 Administrador de outra empresa não grava na pasta de quem não gere');

  -- ================================================================= F6 anônimo
  perform public._como(null, null);
  perform set_config('role', 'anon', true);
  v_r := public._recusa(format('select public._subir(%L)', ven_a || '/66666666-6666-4666-8666-666666666666.png'));
  perform public._ok(v_r like '42501:%', 'F6 anônimo não grava');
  perform public._como(null, null);

  -- ================================================================= F7 foto_url só da própria pasta
  perform public._como(ven_a, 'teste-alfa');
  v_r := public._recusa(format($q$update public.profiles set foto_url = %L where id = %L$q$, base || ven_a || '/11111111-1111-4111-8111-111111111111.png', ven_a));
  perform public._ok(v_r = 'aceito', 'F7 foto_url da própria pasta: aceita');
  v_r := public._recusa(format($q$update public.profiles set foto_url = %L where id = %L$q$, base || clo_a || '/44444444-4444-4444-8444-444444444444.jpg', ven_a));
  perform public._ok(v_r like '23514:%', 'F7 foto de outra pessoa no próprio perfil: recusada');
  v_r := public._recusa(format($q$update public.profiles set foto_url = 'https://site-externo.example/foto.png' where id = %L$q$, ven_a));
  perform public._ok(v_r like '23514:%', 'F7 endereço externo: recusado');
  v_r := public._recusa(format($q$update public.profiles set foto_url = %L where id = %L$q$, base || ven_a || '/foto.gif', ven_a));
  perform public._ok(v_r like '23514:%', 'F7 formato fora de JPG/PNG/WebP: recusado');
  v_r := public._recusa(format($q$update public.profiles set foto_url = %L where id = %L$q$, base || ven_a || '/../' || clo_a || '/x.png', ven_a));
  perform public._ok(v_r like '23514:%', 'F7 caminho com ../: recusado');
  v_r := public._recusa(format($q$update public.profiles set foto_url = null where id = %L$q$, ven_a));
  perform public._ok(v_r = 'aceito', 'F7 remover a foto (volta às iniciais): aceito');

  -- ================================================================= F8 nunca o perfil de outra pessoa
  update public.profiles set foto_url = null, nome = 'Trocado pelo Vendedor' where id = clo_a;
  perform public._como(null, null);
  perform public._ok((select nome <> 'Trocado pelo Vendedor' from public.profiles where id = clo_a), 'F8 Vendedor não altera o perfil do Closer');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$update public.profiles set foto_url = %L where id = %L$q$, base || clo_a || '/44444444-4444-4444-8444-444444444444.jpg', clo_a));
  perform public._ok(v_r = 'aceito', 'F8 Administrador ainda define a foto da equipe (na pasta da pessoa)');

  -- ================================================================= F9 nada comercial muda
  perform public._como(null, null);
  perform public._ok((select count(*) from public.clientes) = v_cli and (select count(*) from public.negociacoes) = v_neg
                     and (select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.tenant_id), '')) from public.tenant_configuracoes t) = v_cfg,
                     'F9 clientes, negociações e configurações intactos');
end;
$$;

rollback;
