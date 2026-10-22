-- ===========================================================================
-- T11 — Google Agenda por empresa (depende da T9).
--
-- - Uma conexão por empresa (PK = tenant_id). A conexão única global some.
-- - Estado OAuth: nonce aleatório gravado com a empresa e o gerente que
--   iniciou, válido por 10 minutos e consumido uma vez (DELETE ... RETURNING).
--   A Edge Function ainda assina (HMAC) o state com a empresa; no retorno, a
--   empresa vem do estado gravado, nunca da URL.
-- - Refresh token só no Vault, um segredo por empresa. Remover a conexão de
--   uma empresa não toca nas outras.
-- - Todas as RPCs recebem a empresa explícita e são só da service_role
--   (Edge Function `agenda-google`, que valida o gerente com o JWT + header
--   da empresa antes de chamar).
-- ===========================================================================

do $$
begin
  if to_regclass('public.tenant_configuracoes') is null then
    raise exception 'T11 exige a T9.';
  end if;
  if to_regprocedure('public.agenda_google_consumir_estado(text)') is not null then
    raise exception 'T11 já aplicada.';
  end if;
end $$;

-- Conexão: de singleton para uma por empresa.
alter table public.agenda_google_conexao drop constraint agenda_google_conexao_unica;
alter table public.agenda_google_conexao drop constraint agenda_google_conexao_pkey;
alter table public.agenda_google_conexao add constraint agenda_google_conexao_pkey primary key (tenant_id);
comment on column public.agenda_google_conexao.id is 'Obsoleto (era a trava de conexão única global). A chave agora é tenant_id.';

-- Remove o caminho global antigo.
drop function public.agenda_google_obter_credencial();
drop function public.agenda_google_registrar_erro(text);
drop function public.agenda_google_remover_conexao();
drop function public.agenda_google_salvar_conexao(text, text, text[], text, uuid);

-- ---------------------------------------------------------------------------
-- Estado OAuth
-- ---------------------------------------------------------------------------
create function public.agenda_google_criar_estado(p_tenant uuid, p_usuario uuid, p_retorno text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nonce text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if public.papel_comercial(p_usuario, p_tenant) is distinct from 'gerente' then
    raise exception 'Somente gerentes da empresa conectam a agenda Google.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenants t where t.id = p_tenant and t.somente_leitura) then
    raise exception 'Esta empresa está somente leitura.' using errcode = '42501';
  end if;
  if p_retorno is null or p_retorno !~ '^https?://' then
    raise exception 'Endereço de retorno inválido.' using errcode = '22023';
  end if;

  delete from public.agenda_google_oauth_estados where expira_em < now();

  insert into public.agenda_google_oauth_estados (nonce, tenant_id, usuario_id, retorno, expira_em)
  values (v_nonce, p_tenant, p_usuario, p_retorno, now() + interval '10 minutes');

  return v_nonce;
end;
$$;

-- Uso único: a linha deixa de existir na primeira leitura.
create function public.agenda_google_consumir_estado(p_nonce text)
returns table (tenant_id uuid, usuario_id uuid, retorno text, expirado boolean)
language sql
security definer
set search_path = ''
as $$
  delete from public.agenda_google_oauth_estados e
   where e.nonce = p_nonce
  returning e.tenant_id, e.usuario_id, e.retorno, e.expira_em < now();
$$;

-- ---------------------------------------------------------------------------
-- Conexão por empresa
-- ---------------------------------------------------------------------------
create function public.agenda_google_salvar_conexao(
  p_tenant uuid, p_conta_email text, p_calendar_id text, p_escopos text[], p_refresh_token text, p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_conta  text;
begin
  if public.papel_comercial(p_usuario_id, p_tenant) is distinct from 'gerente' then
    raise exception 'O usuário não é gerente desta empresa.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenants t where t.id = p_tenant and t.somente_leitura) then
    raise exception 'Esta empresa está somente leitura.' using errcode = '42501';
  end if;
  select c.google_conta_permitida into v_conta from public.tenant_configuracoes c where c.tenant_id = p_tenant;
  if v_conta is not null and v_conta <> lower(p_conta_email) then
    raise exception 'Conta Google não permitida para esta empresa.' using errcode = '42501';
  end if;

  select c.vault_secret_id into v_secret from public.agenda_google_conexao c where c.tenant_id = p_tenant for update;
  if v_secret is not null and exists (select 1 from vault.secrets s where s.id = v_secret) then
    perform vault.update_secret(v_secret, p_refresh_token);
  else
    v_secret := vault.create_secret(
      p_refresh_token,
      'agenda_google_' || replace(p_tenant::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
      'Refresh token OAuth do Google Calendar (empresa ' || p_tenant || ').'
    );
  end if;

  insert into public.agenda_google_conexao (
    tenant_id, id, conta_email, calendar_id, escopos, vault_secret_id, conectado_por, conectado_em, ultimo_erro, ultimo_erro_em)
  values (p_tenant, true, lower(p_conta_email), p_calendar_id, p_escopos, v_secret, p_usuario_id, now(), null, null)
  on conflict (tenant_id) do update
    set conta_email = excluded.conta_email, calendar_id = excluded.calendar_id, escopos = excluded.escopos,
        vault_secret_id = excluded.vault_secret_id, conectado_por = excluded.conectado_por,
        conectado_em = excluded.conectado_em, ultimo_erro = null, ultimo_erro_em = null;
end;
$$;

create function public.agenda_google_obter_credencial(p_tenant uuid)
returns table (conta_email text, calendar_id text, refresh_token text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select c.conta_email, c.calendar_id, s.decrypted_secret::text
      from public.agenda_google_conexao c
      join vault.decrypted_secrets s on s.id = c.vault_secret_id
     where c.tenant_id = p_tenant;
end;
$$;

create function public.agenda_google_registrar_erro(p_tenant uuid, p_erro text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.agenda_google_conexao
     set ultimo_erro = left(p_erro, 500), ultimo_erro_em = now()
   where tenant_id = p_tenant;
$$;

create function public.agenda_google_remover_conexao(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  delete from public.agenda_google_conexao c where c.tenant_id = p_tenant returning c.vault_secret_id into v_secret;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.agenda_google_criar_estado(uuid, uuid, text)',
    'public.agenda_google_consumir_estado(text)',
    'public.agenda_google_salvar_conexao(uuid, text, text, text[], text, uuid)',
    'public.agenda_google_obter_credencial(uuid)',
    'public.agenda_google_registrar_erro(uuid, text)',
    'public.agenda_google_remover_conexao(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_f);
    execute format('grant execute on function %s to service_role', v_f);
  end loop;
end $$;
