-- ===========================================================================
-- Esqueleto LOCAL de vault, storage e realtime — só para a cópia de teste
-- (PostgreSQL puro, sem o stack do Supabase). Simula o mínimo que as
-- migrations T11/T12 usam: vault.create_secret/update_secret/decrypted_secrets,
-- storage.objects com RLS, realtime.messages com RLS, realtime.topic() e
-- realtime.send().
--
-- NUNCA rodar no Supabase real: aborta se o banco se chamar `postgres` ou se
-- algum desses schemas já existir.
-- ===========================================================================

do $$
begin
  if current_database() = 'postgres' or current_database() !~ '^crm_rx7_' then
    raise exception 'Esqueleto local: só em banco de teste crm_rx7_*.';
  end if;
  if exists (select 1 from pg_namespace where nspname in ('vault', 'storage', 'realtime')) then
    raise exception 'vault/storage/realtime já existem neste banco — nada a fazer.';
  end if;
end $$;

create schema vault;
create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text,
  secret      text not null,
  created_at  timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                    new_description text default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id
$$;
revoke all on schema vault from public;

create schema storage;
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null,
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
-- Equivalentes locais das policies PERMISSIVE atuais (bucket inteiro para
-- quem passa na regra antiga); a T12 soma as RESTRICTIVE por empresa.
create policy local_permissiva on storage.objects for all to authenticated using (true) with check (true);

create schema realtime;
create table realtime.messages (
  id          bigserial primary key,
  topic       text not null,
  extension   text not null,
  event       text,
  payload     jsonb,
  private     boolean not null default true,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated, service_role;
grant select on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql security definer as $$
  insert into realtime.messages (topic, extension, event, payload, private) values (topic, 'broadcast', event, payload, private)
$$;
grant execute on function realtime.topic() to authenticated, service_role;
