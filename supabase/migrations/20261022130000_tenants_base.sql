-- ===========================================================================
-- T1 — Base multiempresa (SaaS): empresas, vínculos por empresa e Super Admin.
--
-- O QUE CRIA (nada existente é alterado; nenhuma tabela comercial é tocada):
--   1. Tipos: tenant_tipo, tenant_status, tenant_papel.
--   2. Tabelas: tenants, tenant_memberships, super_admins — RLS ligada, sem
--      nenhuma policy de escrita: só funções SECURITY DEFINER escrevem.
--   3. Helpers de autorização POR EMPRESA (o tenant é sempre um parâmetro
--      explícito, validado contra tenant_memberships em cada chamada — nunca
--      uma "empresa ativa" global gravada em linha mutável de sessão).
--   4. Provisionamento: provisionar_tenant (só Super Admin) e
--      definir_membro_tenant (Super Admin ou admin_empresa da própria empresa).
--   5. Guarda: toda empresa (exceto a de arquivo) mantém pelo menos um
--      admin_empresa ativo; tenant_id/user_id de um vínculo são imutáveis.
--
-- SUPER ADMIN: não existe função para criar Super Admin. A primeira linha de
-- super_admins só entra por SQL do dono do banco (bootstrap documentado em
-- docs/SAAS-MULTIEMPRESA.md); usuários autenticados não têm INSERT/UPDATE/
-- DELETE em nenhuma das 3 tabelas.
--
-- FORA DE ESCOPO: tenant_id nas tabelas comerciais (T3), empresas reais e a
-- empresa de arquivo (T2), papéis antigos em profiles.role (T10).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------------
create type public.tenant_tipo as enum ('assinante', 'interno', 'arquivo');
create type public.tenant_status as enum ('teste', 'ativo', 'suspenso', 'cancelado', 'arquivo');
create type public.tenant_papel as enum ('admin_empresa', 'gerente', 'sdr', 'closer');

-- ---------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------
create table public.tenants (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  slug            text not null,
  tipo            public.tenant_tipo not null default 'assinante',
  status          public.tenant_status not null default 'teste',
  somente_leitura boolean generated always as (status in ('suspenso', 'cancelado', 'arquivo')) stored,
  criado_por      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tenants_nome_valido check (btrim(nome) <> '' and length(nome) <= 120),
  constraint tenants_slug_valido check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  -- A empresa de arquivo é sempre e só ela com status 'arquivo'.
  constraint tenants_arquivo_coerente check ((tipo = 'arquivo') = (status = 'arquivo'))
);

create unique index tenants_slug_unico on public.tenants (slug);

comment on table public.tenants is
  'Empresas do SaaS. tipo arquivo = legado somente leitura; interno = Rio X7; '
  'assinante = cliente pagante. Escrita só por funções SECURITY DEFINER.';

create table public.tenant_memberships (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  user_id       uuid not null references auth.users (id) on delete cascade,
  papel         public.tenant_papel not null,
  ativo         boolean not null default true,
  convidado_por uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tenant_memberships_unico unique (tenant_id, user_id)
);

create index tenant_memberships_usuario_ativo_idx
  on public.tenant_memberships (user_id, tenant_id) where ativo;

comment on table public.tenant_memberships is
  'Vínculo usuário × empresa com papel próprio em cada empresa. Um usuário pode '
  'ter papéis diferentes em empresas diferentes.';

create table public.super_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  criado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.super_admins is
  'Super Admins da plataforma (Rio X7). Nenhuma função cria linhas aqui: só SQL '
  'do dono do banco. Não concede acesso a dados comerciais por si só.';

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

create trigger tenant_memberships_set_updated_at
  before update on public.tenant_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Helpers de autorização (SECURITY DEFINER: leem tenant_memberships sem
-- recursão de RLS; search_path vazio; sempre com o tenant como parâmetro).
-- ---------------------------------------------------------------------------
create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.super_admins s where s.user_id = (select auth.uid()));
$$;

create function public.papel_no_tenant(p_tenant uuid)
returns public.tenant_papel
language sql
stable
security definer
set search_path = ''
as $$
  select m.papel
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.tenant_id = p_tenant
     and m.user_id = (select auth.uid())
     and m.ativo;
$$;

create function public.membro_do_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.papel_no_tenant(p_tenant) is not null;
$$;

create function public.tem_papel_no_tenant(p_tenant uuid, p_papeis public.tenant_papel[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_no_tenant(p_tenant) = any (p_papeis), false);
$$;

create function public.pode_escrever_no_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.membro_do_tenant(p_tenant)
     and exists (select 1 from public.tenants t where t.id = p_tenant and not t.somente_leitura);
$$;

create function public.tenants_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.tenant_memberships m
   where m.user_id = (select auth.uid())
     and m.ativo;
$$;

-- Para RPCs: aborta com 42501 se o usuário não tiver um dos papéis na empresa.
create function public.exigir_papel_no_tenant(p_tenant uuid, p_papeis public.tenant_papel[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant is null or not public.tem_papel_no_tenant(p_tenant, p_papeis) then
    raise exception 'Você não tem permissão para esta operação.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Guarda dos vínculos
-- ---------------------------------------------------------------------------
create function public.tenant_memberships_guarda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo public.tenant_tipo;
begin
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.user_id <> old.user_id) then
    raise exception 'Empresa e usuário de um vínculo não podem ser alterados.' using errcode = '23514';
  end if;

  if old.papel = 'admin_empresa' and old.ativo
     and (tg_op = 'DELETE' or new.papel <> 'admin_empresa' or not new.ativo) then
    -- Serializa mudanças concorrentes na mesma empresa (dois admins se rebaixando ao mesmo tempo).
    select t.tipo into v_tipo from public.tenants t where t.id = old.tenant_id for update;

    if v_tipo <> 'arquivo' and not exists (
      select 1 from public.tenant_memberships m
       where m.tenant_id = old.tenant_id
         and m.id <> old.id
         and m.papel = 'admin_empresa'
         and m.ativo
    ) then
      raise exception 'A empresa precisa de pelo menos um administrador ativo.' using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tenant_memberships_guarda
  before update or delete on public.tenant_memberships
  for each row execute function public.tenant_memberships_guarda();

-- ---------------------------------------------------------------------------
-- 5. Provisionamento
-- ---------------------------------------------------------------------------
-- Só Super Admin. Cria a empresa e o primeiro admin_empresa numa transação.
-- A empresa de arquivo NUNCA é criada por aqui (só por migration).
create function public.provisionar_tenant(
  p_nome       text,
  p_slug       text,
  p_tipo       public.tenant_tipo,
  p_admin_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Somente o Super Admin pode criar empresas.' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo = 'arquivo' then
    raise exception 'Tipo de empresa inválido.' using errcode = '22023';
  end if;
  if p_admin_user is null or not exists (select 1 from auth.users u where u.id = p_admin_user) then
    raise exception 'Usuário administrador não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.tenants (nome, slug, tipo, status, criado_por)
  values (
    btrim(p_nome),
    lower(btrim(p_slug)),
    p_tipo,
    case when p_tipo = 'interno' then 'ativo'::public.tenant_status else 'teste'::public.tenant_status end,
    (select auth.uid())
  )
  returning id into v_tenant;

  insert into public.tenant_memberships (tenant_id, user_id, papel, convidado_por)
  values (v_tenant, p_admin_user, 'admin_empresa', (select auth.uid()));

  return v_tenant;
end;
$$;

-- Super Admin, ou admin_empresa ativo da PRÓPRIA empresa (que não esteja
-- somente leitura). Cria ou altera o vínculo de um usuário existente.
create function public.definir_membro_tenant(
  p_tenant uuid,
  p_user   uuid,
  p_papel  public.tenant_papel,
  p_ativo  boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_super_admin() then
    if not public.tem_papel_no_tenant(p_tenant, array['admin_empresa']::public.tenant_papel[])
       or not public.pode_escrever_no_tenant(p_tenant) then
      raise exception 'Você não tem permissão para esta operação.' using errcode = '42501';
    end if;
  end if;
  if p_papel is null or p_user is null then
    raise exception 'Usuário e papel são obrigatórios.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, papel, ativo, convidado_por)
  values (p_tenant, p_user, p_papel, coalesce(p_ativo, true), (select auth.uid()))
  on conflict (tenant_id, user_id) do update
     set papel = excluded.papel,
         ativo = excluded.ativo
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS e privilégios
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.super_admins enable row level security;

-- O Supabase concede tudo em tabelas novas do public a anon/authenticated:
-- aqui fica só SELECT para authenticated, e nada para anon.
revoke all on table public.tenants, public.tenant_memberships, public.super_admins from anon, authenticated;
grant select on table public.tenants, public.tenant_memberships, public.super_admins to authenticated;

create policy tenants_select on public.tenants
  for select to authenticated
  using (public.membro_do_tenant(id) or public.is_super_admin());

create policy tenant_memberships_select on public.tenant_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.tem_papel_no_tenant(tenant_id, array['admin_empresa', 'gerente']::public.tenant_papel[])
    or public.is_super_admin()
  );

create policy super_admins_select on public.super_admins
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());

revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.papel_no_tenant(uuid) from public, anon;
revoke all on function public.membro_do_tenant(uuid) from public, anon;
revoke all on function public.tem_papel_no_tenant(uuid, public.tenant_papel[]) from public, anon;
revoke all on function public.pode_escrever_no_tenant(uuid) from public, anon;
revoke all on function public.tenants_do_usuario() from public, anon;
revoke all on function public.exigir_papel_no_tenant(uuid, public.tenant_papel[]) from public, anon;
revoke all on function public.tenant_memberships_guarda() from public, anon, authenticated;
revoke all on function public.provisionar_tenant(text, text, public.tenant_tipo, uuid) from public, anon;
revoke all on function public.definir_membro_tenant(uuid, uuid, public.tenant_papel, boolean) from public, anon;

grant execute on function public.is_super_admin() to authenticated, service_role;
grant execute on function public.papel_no_tenant(uuid) to authenticated, service_role;
grant execute on function public.membro_do_tenant(uuid) to authenticated, service_role;
grant execute on function public.tem_papel_no_tenant(uuid, public.tenant_papel[]) to authenticated, service_role;
grant execute on function public.pode_escrever_no_tenant(uuid) to authenticated, service_role;
grant execute on function public.tenants_do_usuario() to authenticated, service_role;
grant execute on function public.exigir_papel_no_tenant(uuid, public.tenant_papel[]) to authenticated, service_role;
grant execute on function public.provisionar_tenant(text, text, public.tenant_tipo, uuid) to authenticated;
grant execute on function public.definir_membro_tenant(uuid, uuid, public.tenant_papel, boolean) to authenticated;
