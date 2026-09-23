-- ===========================================================================
-- Gestão de usuários.
--
-- 1. `profiles` ganha telefone e foto.
-- 2. Sempre existe ao menos um gerente ativo (senão ninguém administra mais).
-- 3. Bucket `avatares` no Storage, com escrita só para gerente.
--
-- Criar usuário e bloquear o login de quem é desativado exigem a API de
-- admin do Auth (chave service_role). Isso fica na Edge Function
-- `admin-usuarios`, nunca no Next — ver supabase/functions/admin-usuarios.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Perfil.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column telefone text
    constraint profiles_telefone_formato check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  add column foto_url text
    constraint profiles_foto_url_http check (foto_url is null or foto_url ~* '^https://');

comment on column public.profiles.telefone is 'Só dígitos, com DDD.';
comment on column public.profiles.foto_url is 'URL pública do avatar no bucket avatares.';

-- ---------------------------------------------------------------------------
-- 2. Nunca ficar sem gerente.
--
-- Um gerente que se rebaixe a closer ou se desative (ou desative o último
-- colega) trancaria a equipe fora da administração. Checado depois do UPDATE,
-- sobre o estado final da tabela.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_mantem_gerente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'gerente' and old.ativo
     and (new.role <> 'gerente' or not new.ativo)
     and not exists (
       select 1 from public.profiles p
       where p.role = 'gerente' and p.ativo and p.id <> new.id
     )
  then
    raise exception 'É preciso manter ao menos um gerente ativo.'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create trigger profiles_mantem_gerente
  after update of role, ativo on public.profiles
  for each row
  execute function public.profiles_mantem_gerente();

-- ---------------------------------------------------------------------------
-- 3. Avatares.
--
-- Bucket público: a foto aparece em <img> sem URL assinada. O caminho leva
-- o id do usuário e um nome aleatório, e o bucket só aceita imagem de até
-- 2 MB. Ler é livre; gravar, trocar e apagar é só do gerente.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatares',
  'avatares',
  true,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A leitura pública é pela URL do bucket; esta policy é para a API de
-- Storage, que exige SELECT para remover ou sobrescrever um arquivo.
create policy avatares_gerente_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'avatares' and public.is_gerente());

create policy avatares_gerente_insert on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'avatares' and public.is_gerente());

create policy avatares_gerente_update on storage.objects
  for update
  to authenticated
  using (bucket_id = 'avatares' and public.is_gerente())
  with check (bucket_id = 'avatares' and public.is_gerente());

create policy avatares_gerente_delete on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'avatares' and public.is_gerente());
