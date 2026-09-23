-- ===========================================================================
-- profiles — espelho de auth.users com o papel do usuário no CRM.
--
-- auth.users pertence ao Supabase e não aceita colunas próprias, então o papel
-- (gerente / closer) mora aqui. Toda policy de RLS do sistema consulta esta
-- tabela, direta ou indiretamente.
-- ===========================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text not null check (length(btrim(nome)) > 0),
  email       text not null,
  role        public.user_role not null default 'closer',
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Usuários do CRM. O papel é definido em auth.users.raw_app_meta_data->>''role'' '
  'no momento da criação, ou alterado depois por um gerente.';

create index profiles_role_idx on public.profiles (role) where ativo;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Criação automática do profile a partir de auth.users.
--
-- O papel é lido de `raw_app_meta_data`, NUNCA de `raw_user_meta_data`.
-- O user_metadata é gravável pelo próprio usuário no signup — usá-lo aqui
-- permitiria que qualquer pessoa se cadastrasse como gerente. O app_metadata
-- só é gravável pela API de admin (chave service_role).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome, email, role)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nome'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    coalesce(
      (nullif(new.raw_app_meta_data ->> 'role', ''))::public.user_role,
      'closer'
    )
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Permissões de tabela.
--
-- Sem GRANT, a RLS nem chega a ser avaliada. Sem REVOKE em `anon`, um visitante
-- não autenticado bateria nas policies — que o barrariam, mas é melhor não
-- depender disso.
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;
