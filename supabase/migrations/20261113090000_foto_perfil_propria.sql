set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Foto de perfil: cada usuário troca e remove a PRÓPRIA foto (Meu perfil).
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- Reaproveita o que já existe:
--   - bucket `avatares` (20260923190000): público para leitura pela URL,
--     até 2 MB, só JPG/PNG/WebP — sem mudança;
--   - profiles.foto_url — sem coluna nova;
--   - policy RESTRICTIVE rx7_avatares_empresa (20261023130000): gravar só na
--     pasta do próprio usuário ou de quem a pessoa gere — sem mudança.
--
-- Muda:
--  1. Policies PERMISSIVE da pasta do próprio usuário (`<auth.uid()>/…`). Até
--     aqui só o gerente gravava (avatares_gerente_*); somadas à RESTRICTIVE,
--     ninguém grava na pasta de outra pessoa sem gerir esse usuário.
--  2. profiles.foto_url só aceita a URL pública da pasta do PRÓPRIO perfil no
--     bucket `avatares` (<id>/<arquivo>.jpg|png|webp). Nenhum perfil aponta
--     para foto de outra pessoa nem para endereço externo.
-- ===========================================================================

do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'Exige o schema storage do Supabase.';
  end if;
  if to_regprocedure('public.uuid_ou_nulo(text)') is null then
    raise exception 'Exige public.uuid_ou_nulo (20261023130000).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Pasta do próprio usuário no bucket avatares
-- ---------------------------------------------------------------------------
create policy avatares_proprio_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatares' and public.uuid_ou_nulo(split_part(name, '/', 1)) = (select auth.uid()));

create policy avatares_proprio_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatares' and public.uuid_ou_nulo(split_part(name, '/', 1)) = (select auth.uid()));

create policy avatares_proprio_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatares' and public.uuid_ou_nulo(split_part(name, '/', 1)) = (select auth.uid()))
  with check (bucket_id = 'avatares' and public.uuid_ou_nulo(split_part(name, '/', 1)) = (select auth.uid()));

create policy avatares_proprio_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatares' and public.uuid_ou_nulo(split_part(name, '/', 1)) = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. foto_url: só a foto do próprio perfil no bucket avatares
-- ---------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_foto_url_avatar_proprio
  check (foto_url is null
         or foto_url ~ ('^https://[^/]+/storage/v1/object/public/avatares/' || id::text || '/[A-Za-z0-9-]+\.(jpg|png|webp)$'));

comment on constraint profiles_foto_url_avatar_proprio on public.profiles is
  'A foto do perfil é sempre um arquivo da pasta do próprio usuário no bucket avatares (JPG, PNG ou WebP).';
