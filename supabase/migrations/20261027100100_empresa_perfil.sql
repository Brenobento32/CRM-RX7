-- ===========================================================================
-- PROPOSTA (NÃO APLICADA) — ESTRUTURA 2/3: dados da empresa, logo, endereço
-- (slug) controlado e as RPCs do Super Admin. Nenhuma permissão de cargo
-- operacional entra aqui (isso é a ativação, 100300).
--
-- Pré-requisito: parte A (20261027100000_empresa_papeis_enum.sql) já aplicada,
-- em transação separada. Nada aqui apaga ou reescreve dado existente:
-- colunas novas são opcionais (nulas), sem backfill.
--
-- 1. tenants: telefone, email, responsavel_nome, logo_path (caminho no
--    bucket, nunca URL livre — evita apontar a logo para fora).
-- 2. Bucket `empresa-logos`: leitura pública pela URL (logo não é segredo),
--    só PNG/JPEG/WEBP (SVG fora: pode carregar script), até 2 MB, gravação
--    só na pasta `<tenant_id>/` por Super Admin ou admin da própria empresa.
-- 3. Vendedor/atendente NÃO são traduzidos para closer/sdr. Até a matriz de
--    cargos ser aprovada e implementada, `papel_comercial()` devolve nulo
--    para eles: nenhum acesso comercial (menor privilégio).
-- 4. Slug: lista de caminhos reservados (para a URL `/<slug>`), histórico de
--    slugs antigos (um slug usado por uma empresa nunca vai para outra — link
--    antigo não abre a empresa errada) e troca só pelo Super Admin, auditada.
-- 5. admin_atualizar_empresa(): dados de cadastro, SÓ pelo Super Admin (nome,
--    contato, logo — nunca slug/tipo/status por aqui). O Gerente tem a
--    própria função, mais restrita, na ativação (100300).
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'tenant_papel' and e.enumlabel = 'atendente') then
    raise exception 'Aplique antes a parte A (enum tenant_papel com vendedor/atendente).';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenants' and column_name = 'logo_path') then
    raise exception 'Proposta já aplicada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Dados da empresa
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column telefone text,
  add column email text,
  add column responsavel_nome text,
  add column logo_path text;

alter table public.tenants
  add constraint tenants_telefone_valido check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  add constraint tenants_email_valido check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add constraint tenants_responsavel_valido check (responsavel_nome is null or (btrim(responsavel_nome) <> '' and length(responsavel_nome) <= 120)),
  -- A logo só pode estar na pasta da própria empresa.
  add constraint tenants_logo_na_pasta check (logo_path is null or logo_path ~ ('^' || id::text || '/logo\.(png|jpe?g|webp)$'));

-- ---------------------------------------------------------------------------
-- 2. Bucket de logos (só onde existe o schema storage do Supabase)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sem schema storage (banco local): bucket de logos não criado.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('empresa-logos', 'empresa-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy empresa_logos_gravar on storage.objects for insert to authenticated
    with check (
      bucket_id = 'empresa-logos'
      and public.uuid_ou_nulo((storage.foldername(name))[1]) is not null
      and (public.is_super_admin()
           or public.tem_papel_no_tenant(public.uuid_ou_nulo((storage.foldername(name))[1]), array['admin_empresa', 'gerente']::public.tenant_papel[]))
    )$p$;
  execute $p$
    create policy empresa_logos_trocar on storage.objects for update to authenticated
    using (
      bucket_id = 'empresa-logos'
      and (public.is_super_admin()
           or public.tem_papel_no_tenant(public.uuid_ou_nulo((storage.foldername(name))[1]), array['admin_empresa', 'gerente']::public.tenant_papel[]))
    )$p$;
  execute $p$
    create policy empresa_logos_apagar on storage.objects for delete to authenticated
    using (
      bucket_id = 'empresa-logos'
      and (public.is_super_admin()
           or public.tem_papel_no_tenant(public.uuid_ou_nulo((storage.foldername(name))[1]), array['admin_empresa', 'gerente']::public.tenant_papel[]))
    )$p$;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Slug: reservados, histórico e troca controlada
-- ---------------------------------------------------------------------------

-- Primeiro segmento que nunca pode ser empresa: rotas públicas, do sistema e
-- todas as rotas internas do app (a URL `/<slug>/...` divide o mesmo espaço).
create function public.slug_reservado(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_slug) = any (array[
    -- públicas / sistema
    'login', 'auth', 'admin', 'api', 'f', 'e', 'esqueci-senha', 'redefinir-senha',
    'sem-acesso', 'empresas', 'next', 'static', 'public', 'assets', 'favicon-ico',
    'robots-txt', 'sitemap-xml', 'www', 'app', 'suporte', 'ajuda', 'status',
    -- área interna
    'inicio', 'agenda', 'funil', 'clientes', 'metas', 'propostas', 'relatorios',
    'configuracoes', 'perfil', 'negociacoes', 'conversas', 'leads', 'dashboard',
    'integracoes', 'usuarios', 'assinatura'
  ]);
$$;

-- NOT VALID: não reprova empresas antigas; vale para toda criação/alteração.
alter table public.tenants
  add constraint tenants_slug_nao_reservado check (not public.slug_reservado(slug)) not valid;

create table public.tenant_slugs_antigos (
  slug        text primary key,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  trocado_em  timestamptz not null default now(),
  trocado_por uuid references auth.users (id) on delete set null
);
alter table public.tenant_slugs_antigos enable row level security;
-- Sem policy: só funções security definer leem/escrevem.
revoke all on public.tenant_slugs_antigos from anon, authenticated;

-- Um slug nunca troca de dono: nem novo igual a um antigo de outra empresa.
create function public.tenants_slug_sem_reuso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tenant_slugs_antigos a
              where a.slug = new.slug and a.tenant_id <> new.id) then
    raise exception 'Esse endereço já pertenceu a outra empresa.' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger tenants_slug_sem_reuso
  before insert or update of slug on public.tenants
  for each row execute function public.tenants_slug_sem_reuso();

-- Troca de slug: só Super Admin, com motivo, auditada; o antigo vira
-- redirecionamento para a mesma empresa.
create function public.admin_alterar_slug(p_tenant uuid, p_slug text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo  text := lower(btrim(p_slug));
  v_atual text;
begin
  perform public.exigir_super_admin();
  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Informe o motivo.' using errcode = '22023';
  end if;
  if v_novo is null or v_novo !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_novo) > 63 or public.slug_reservado(v_novo) then
    raise exception 'Endereço inválido ou reservado.' using errcode = '22023';
  end if;

  select slug into v_atual from public.tenants where id = p_tenant for update;
  if v_atual is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_atual = v_novo then
    return;
  end if;

  insert into public.tenant_slugs_antigos (slug, tenant_id, trocado_por)
  values (v_atual, p_tenant, (select auth.uid()))
  on conflict (slug) do nothing;
  -- Voltar a um slug antigo da própria empresa: deixa de ser "antigo".
  delete from public.tenant_slugs_antigos where slug = v_novo and tenant_id = p_tenant;

  update public.tenants set slug = v_novo where id = p_tenant;

  perform public.registrar_auditoria('empresa_slug_alterado', p_tenant,
    jsonb_build_object('de', v_atual, 'para', v_novo, 'motivo', btrim(p_motivo)));
end;
$$;

-- Slug antigo → atual, só para quem é membro ativo dessa empresa (ou Super
-- Admin). Para os demais devolve nulo: não revela que a empresa existe.
create function public.resolver_slug_antigo(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.slug
    from public.tenant_slugs_antigos a
    join public.tenants t on t.id = a.tenant_id
   where a.slug = lower(btrim(p_slug))
     and (public.is_super_admin()
          or exists (select 1 from public.tenant_memberships m
                      where m.tenant_id = t.id and m.user_id = (select auth.uid()) and m.ativo));
$$;

-- ---------------------------------------------------------------------------
-- 5. Dados de cadastro: SÓ o Super Admin (nome, contato, logo). O Gerente edita
--    apenas contato e logo da própria empresa, pela função da ativação
--    (`empresa_atualizar_contato`, 100300).
-- ---------------------------------------------------------------------------
create function public.admin_atualizar_empresa(
  p_tenant uuid,
  p_nome text,
  p_telefone text,
  p_email text,
  p_responsavel_nome text,
  p_logo_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();

  update public.tenants
     set nome = btrim(p_nome),
         telefone = nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), ''),
         email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         responsavel_nome = nullif(btrim(coalesce(p_responsavel_nome, '')), ''),
         logo_path = nullif(btrim(coalesce(p_logo_path, '')), '')
   where id = p_tenant;
  if not found then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;

  perform public.registrar_auditoria('empresa_dados_alterados', p_tenant,
    jsonb_build_object('nome', btrim(p_nome), 'logo', p_logo_path is not null));
end;
$$;

revoke all on function public.slug_reservado(text) from public;
revoke all on function public.tenants_slug_sem_reuso() from public, anon, authenticated;
revoke all on function public.admin_alterar_slug(uuid, text, text) from public, anon;
revoke all on function public.resolver_slug_antigo(text) from public, anon;
revoke all on function public.admin_atualizar_empresa(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.slug_reservado(text) to authenticated, service_role;
grant execute on function public.admin_alterar_slug(uuid, text, text) to authenticated;
grant execute on function public.resolver_slug_antigo(text) to authenticated;
grant execute on function public.admin_atualizar_empresa(uuid, text, text, text, text, text) to authenticated;
