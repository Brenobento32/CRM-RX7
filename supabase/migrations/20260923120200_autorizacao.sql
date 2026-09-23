-- ===========================================================================
-- Autorização: funções auxiliares e RLS de profiles.
--
-- `is_gerente()` é SECURITY DEFINER de propósito. Se ela lesse profiles como
-- o usuário comum, a policy de SELECT de profiles chamaria is_gerente(), que
-- leria profiles, que dispararia a policy de novo — recursão infinita, o erro
-- clássico desse modelo. SECURITY DEFINER faz a leitura ignorar a RLS.
-- ===========================================================================

create or replace function public.is_gerente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'gerente'
      and p.ativo
  );
$$;

comment on function public.is_gerente() is
  'True quando o usuário autenticado é um gerente ativo. Base de toda policy.';

revoke all on function public.is_gerente() from public, anon;
grant execute on function public.is_gerente() to authenticated;

-- ---------------------------------------------------------------------------
-- Bloqueio de escalada de privilégio.
--
-- A policy de UPDATE deixa o usuário editar o próprio profile (nome, por
-- exemplo). Sem este guard, ele editaria também a própria coluna `role` e
-- viraria gerente — RLS não sabe distinguir quais colunas foram tocadas.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_privilegios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_gerente() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.ativo is distinct from old.ativo
  then
    raise exception
      'Apenas um gerente pode alterar papel ou status de acesso de um usuário.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_privilegios
  before update on public.profiles
  for each row
  execute function public.profiles_guard_privilegios();

-- ---------------------------------------------------------------------------
-- RLS de profiles.
--
-- Não há policy de INSERT nem de DELETE: profiles nasce pelo trigger em
-- auth.users e morre junto com o usuário (on delete cascade). Criar usuário é
-- operação da API de admin, não do CRM.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.is_gerente()
  );

create policy profiles_update on public.profiles
  for update
  to authenticated
  using (
    id = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    id = (select auth.uid())
    or public.is_gerente()
  );
