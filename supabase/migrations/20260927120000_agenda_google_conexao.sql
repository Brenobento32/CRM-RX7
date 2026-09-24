-- ===========================================================================
-- Agenda 2.0 — Fase A: conexão OAuth com o Google Calendar.
--
-- A conta Google da empresa autoriza o CRM (escopo calendar.readonly). O
-- refresh token fica no Supabase Vault, criptografado; nenhuma tabela que a
-- aplicação lê guarda o token.
--
-- Quem mexe na conexão é só a Edge Function `agenda-google` (service_role),
-- pelas funções abaixo — EXECUTE só para service_role. O gerente apenas LÊ o
-- estado da conexão (conta, desde quando, último erro).
--
-- Sem sincronização nesta fase: nenhum evento do Google é gravado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Conexão (uma linha só).
-- ---------------------------------------------------------------------------
create table public.agenda_google_conexao (
  id               boolean primary key default true
                     constraint agenda_google_conexao_unica check (id),
  conta_email      text not null,
  calendar_id      text not null,
  escopos          text[] not null,
  vault_secret_id  uuid not null,
  conectado_por    uuid references public.profiles (id) on delete set null,
  conectado_em     timestamptz not null default now(),
  ultimo_erro      text,
  ultimo_erro_em   timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.agenda_google_conexao is
  'Conta Google conectada à agenda. O refresh token está no Vault '
  '(vault_secret_id), nunca aqui. Escrita só pela Edge Function agenda-google.';

create trigger agenda_google_conexao_set_updated_at
  before update on public.agenda_google_conexao
  for each row
  execute function public.set_updated_at();

alter table public.agenda_google_conexao enable row level security;

create policy agenda_google_conexao_select on public.agenda_google_conexao
  for select
  to authenticated
  using (public.is_gerente());

revoke all on table public.agenda_google_conexao from anon, authenticated;
grant select on table public.agenda_google_conexao to authenticated;
grant select, insert, update, delete on table public.agenda_google_conexao to service_role;

-- ---------------------------------------------------------------------------
-- 2. Estados do fluxo OAuth.
--
-- Um `state` por clique em "Conectar": amarra o retorno do Google ao gerente
-- que iniciou e ao endereço do CRM para onde voltar. Uso único, vale 10 min.
-- Sem policies: só a service_role lê e grava.
-- ---------------------------------------------------------------------------
create table public.agenda_google_oauth_estados (
  nonce       text primary key,
  usuario_id  uuid not null references public.profiles (id) on delete cascade,
  retorno     text not null,
  expira_em   timestamptz not null default now() + interval '10 minutes',
  created_at  timestamptz not null default now()
);

alter table public.agenda_google_oauth_estados enable row level security;

revoke all on table public.agenda_google_oauth_estados from anon, authenticated;
grant select, insert, delete on table public.agenda_google_oauth_estados to service_role;

-- ---------------------------------------------------------------------------
-- 3. Funções da Edge Function (EXECUTE só service_role).
--
-- SECURITY DEFINER porque o schema `vault` não é acessível pela API.
-- ---------------------------------------------------------------------------

-- Grava (ou troca) a conexão e o refresh token.
create or replace function public.agenda_google_salvar_conexao(
  p_conta_email    text,
  p_calendar_id    text,
  p_escopos        text[],
  p_refresh_token  text,
  p_usuario_id     uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  select c.vault_secret_id into v_secret from public.agenda_google_conexao c;

  if v_secret is not null
     and exists (select 1 from vault.secrets s where s.id = v_secret)
  then
    perform vault.update_secret(v_secret, p_refresh_token);
  else
    v_secret := vault.create_secret(
      p_refresh_token,
      'agenda_google_refresh_token_' || replace(gen_random_uuid()::text, '-', ''),
      'Refresh token OAuth do Google Calendar (agenda comercial).'
    );
  end if;

  insert into public.agenda_google_conexao (
    id, conta_email, calendar_id, escopos, vault_secret_id, conectado_por, conectado_em,
    ultimo_erro, ultimo_erro_em
  )
  values (
    true, p_conta_email, p_calendar_id, p_escopos, v_secret, p_usuario_id, now(), null, null
  )
  on conflict (id) do update
    set conta_email     = excluded.conta_email,
        calendar_id     = excluded.calendar_id,
        escopos         = excluded.escopos,
        vault_secret_id = excluded.vault_secret_id,
        conectado_por   = excluded.conectado_por,
        conectado_em    = excluded.conectado_em,
        ultimo_erro     = null,
        ultimo_erro_em  = null;
end;
$$;

-- Conta, agenda e refresh token, para a Edge Function chamar o Google.
create or replace function public.agenda_google_obter_credencial()
returns table (conta_email text, calendar_id text, refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.conta_email, c.calendar_id, s.decrypted_secret
  from public.agenda_google_conexao c
  join vault.decrypted_secrets s on s.id = c.vault_secret_id;
$$;

-- Último erro de uso da conexão (token revogado, API fora etc.).
create or replace function public.agenda_google_registrar_erro(p_erro text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.agenda_google_conexao
     set ultimo_erro = left(p_erro, 500),
         ultimo_erro_em = now();
$$;

-- Desconectar: apaga o token do Vault e a conexão.
create or replace function public.agenda_google_remover_conexao()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  select c.vault_secret_id into v_secret from public.agenda_google_conexao c;
  delete from public.agenda_google_conexao;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke all on function public.agenda_google_salvar_conexao(text, text, text[], text, uuid) from public, anon, authenticated;
revoke all on function public.agenda_google_obter_credencial() from public, anon, authenticated;
revoke all on function public.agenda_google_registrar_erro(text) from public, anon, authenticated;
revoke all on function public.agenda_google_remover_conexao() from public, anon, authenticated;

grant execute on function public.agenda_google_salvar_conexao(text, text, text[], text, uuid) to service_role;
grant execute on function public.agenda_google_obter_credencial() to service_role;
grant execute on function public.agenda_google_registrar_erro(text) to service_role;
grant execute on function public.agenda_google_remover_conexao() to service_role;
