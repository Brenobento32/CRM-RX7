-- ===========================================================================
-- T12 — Storage e Realtime por empresa (depende da T9).
--
-- STORAGE (policies RESTRICTIVE somadas às atuais; nada é apagado/movido):
--   whatsapp-midia (privado):
--     novos arquivos: `{tenant_id}/{conversa_id}/{arquivo}` — só gravados na
--       empresa da requisição, em conversa dela, com empresa gravável;
--     arquivos atuais `{conversa_id}/{arquivo}`: continuam legíveis só por
--       quem está na empresa da conversa (o legado, no arquivo).
--   avatares (público para leitura pela URL, como hoje): gravar/trocar/apagar
--     só o próprio usuário ou quem gere todas as empresas dele.
--
-- REALTIME: o painel deixa de ouvir `postgres_changes` (o Realtime não manda
--   a empresa da aba) e passa a ouvir um canal PRIVADO por conversa:
--   `empresa:<tenant_id>:conversa:<conversa_id>`. Triggers publicam
--   mensagens e reações com `realtime.send`; a policy de `realtime.messages`
--   só deixa entrar no canal quem é membro ativo da empresa e enxerga a
--   conversa (mesma regra de conversas_select). Uma empresa nunca recebe
--   evento de outra, e trocar de empresa troca de canal.
-- ===========================================================================

do $$
begin
  if to_regclass('public.tenant_configuracoes') is null then
    raise exception 'T12 exige a T9.';
  end if;
  if to_regprocedure('public.pode_ouvir_topico(text)') is not null then
    raise exception 'T12 já aplicada.';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('realtime.messages') is null then
    raise exception 'T12 exige os schemas storage e realtime do Supabase.';
  end if;
end $$;

create function public.uuid_ou_nulo(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Quem enxerga a conversa (mesma regra de conversas_select), numa empresa.
create function public.conversa_visivel(p_tenant uuid, p_conversa uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversas cv
      left join public.clientes c on c.id = cv.cliente_id and c.tenant_id = cv.tenant_id
     where cv.id = p_conversa
       and cv.tenant_id = p_tenant
       and (public.papel_comercial(p_user, p_tenant) = 'gerente'
            or (public.papel_comercial(p_user, p_tenant) is not null and c.owner_id = p_user))
  );
$$;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
create function public.midia_legivel(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with partes as (select string_to_array(p_nome, '/') as p),
       ctx as (select public.tenant_atual() as t, (select auth.uid()) as u)
  select case
           -- novo: {tenant}/{conversa}/{arquivo}
           when array_length(p.p, 1) = 3 then
             public.uuid_ou_nulo(p.p[1]) = ctx.t
             and public.conversa_visivel(ctx.t, public.uuid_ou_nulo(p.p[2]), ctx.u)
           -- atual: {conversa}/{arquivo}
           when array_length(p.p, 1) = 2 then
             public.conversa_visivel(ctx.t, public.uuid_ou_nulo(p.p[1]), ctx.u)
           else false
         end
    from partes p, ctx;
$$;

create function public.midia_gravavel(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with partes as (select string_to_array(p_nome, '/') as p),
       ctx as (select public.tenant_atual() as t, (select auth.uid()) as u)
  select array_length(p.p, 1) = 3
         and public.uuid_ou_nulo(p.p[1]) = ctx.t
         and public.pode_escrever_no_tenant(ctx.t)
         and public.conversa_visivel(ctx.t, public.uuid_ou_nulo(p.p[2]), ctx.u)
    from partes p, ctx;
$$;

create function public.avatar_gravavel(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.uuid_ou_nulo(split_part(p_nome, '/', 1)) = (select auth.uid())
      or public.pode_gerir_usuario(public.uuid_ou_nulo(split_part(p_nome, '/', 1)));
$$;

create policy rx7_whatsapp_midia_empresa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'whatsapp-midia' or public.midia_legivel(name))
  with check (bucket_id <> 'whatsapp-midia' or public.midia_gravavel(name));

create policy rx7_avatares_empresa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'avatares' or public.avatar_gravavel(name))
  with check (bucket_id <> 'avatares' or public.avatar_gravavel(name));

-- ---------------------------------------------------------------------------
-- Realtime: canal privado por conversa
-- ---------------------------------------------------------------------------
create function public.topico_conversa(p_tenant uuid, p_conversa uuid)
returns text
language sql
immutable
set search_path = ''
as $$ select 'empresa:' || p_tenant || ':conversa:' || p_conversa $$;

create function public.pode_ouvir_topico(p_topico text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m text[] := regexp_match(coalesce(p_topico, ''),
    '^empresa:([0-9a-f-]{36}):conversa:([0-9a-f-]{36})$');
begin
  if v_m is null or (select auth.uid()) is null then
    return false;
  end if;
  return public.conversa_visivel(public.uuid_ou_nulo(v_m[1]), public.uuid_ou_nulo(v_m[2]), (select auth.uid()));
end;
$$;

create policy rx7_conversa_por_empresa on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.pode_ouvir_topico((select realtime.topic())));

-- Publicação. Uma falha do Realtime nunca impede a gravação da mensagem.
create function public.publicar_mensagem_realtime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('op', tg_op, 'registro', to_jsonb(new)),
      'mensagem',
      public.topico_conversa(new.tenant_id, new.conversa_id),
      true);
  exception when others then
    raise warning 'realtime mensagem %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create function public.publicar_reacao_realtime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha    public.mensagem_reacoes := case when tg_op = 'DELETE' then old else new end;
  v_conversa uuid;
begin
  select m.conversa_id into v_conversa from public.mensagens m where m.id = v_linha.mensagem_id;
  if v_conversa is null then
    return null;  -- mensagem já apagada (cascata): nada a avisar
  end if;
  begin
    perform realtime.send(
      jsonb_build_object('op', tg_op, 'registro', to_jsonb(v_linha)),
      'reacao',
      public.topico_conversa(v_linha.tenant_id, v_conversa),
      true);
  exception when others then
    raise warning 'realtime reação %: %', v_linha.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger zz_realtime_publicar after insert or update on public.mensagens
  for each row execute function public.publicar_mensagem_realtime();
create trigger zz_realtime_publicar after insert or update or delete on public.mensagem_reacoes
  for each row execute function public.publicar_reacao_realtime();

do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.conversa_visivel(uuid, uuid, uuid)', 'public.midia_legivel(text)', 'public.midia_gravavel(text)',
    'public.avatar_gravavel(text)', 'public.pode_ouvir_topico(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_f);
    execute format('grant execute on function %s to authenticated, service_role', v_f);
  end loop;
  revoke all on function public.publicar_mensagem_realtime() from public, anon, authenticated;
  revoke all on function public.publicar_reacao_realtime() from public, anon, authenticated;
end $$;
