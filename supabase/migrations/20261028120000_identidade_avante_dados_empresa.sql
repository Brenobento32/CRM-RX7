-- =============================================================================
-- Identidade GLOBAL do AVANTE CRM (logos claro/escuro) × dados da EMPRESA cliente
-- =============================================================================
-- Duas coisas diferentes, guardadas em lugares diferentes:
--
-- 1. Identidade do AVANTE CRM (plataforma, global): a marca que aparece no
--    login, no /admin, no menu lateral e nas telas institucionais. Só o Super
--    Admin troca. Uma linha (`plataforma_identidade`), arquivos no bucket
--    `plataforma-marca` (leitura pública: logo não é segredo). Sem logo
--    configurado, o app usa a logo oficial embutida (fallback previsível).
--
-- 2. Dados da empresa cliente (por empresa): `tenants` já tem nome, telefone,
--    e-mail, responsável e logo da empresa. Entram `nome_comercial` (visível
--    aos membros, como o nome) e as observações internas do Super Admin, numa
--    tabela própria SEM acesso de usuários (os membros leem a linha de
--    `tenants` da própria empresa; observação interna não pode ir para lá).
--    O Administrador da empresa continua só com a função dele
--    (`empresa_atualizar_contato`), sem estes campos.
--
-- Nada é apagado nem reescrito: colunas e tabelas novas, vazias.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Identidade global do AVANTE CRM
-- ---------------------------------------------------------------------------
create table public.plataforma_identidade (
  id               smallint primary key default 1 check (id = 1),
  logo_claro_path  text check (logo_claro_path is null or logo_claro_path ~ '^logo-claro\.(png|jpe?g|webp)$'),
  logo_escuro_path text check (logo_escuro_path is null or logo_escuro_path ~ '^logo-escuro\.(png|jpe?g|webp)$'),
  atualizado_em    timestamptz not null default now(),
  atualizado_por   uuid references auth.users (id) on delete set null
);
insert into public.plataforma_identidade (id) values (1);

alter table public.plataforma_identidade enable row level security;
revoke all on public.plataforma_identidade from public, anon, authenticated;

-- Leitura pública (login e telas institucionais, inclusive sem sessão).
create function public.identidade_plataforma()
returns table (logo_claro_path text, logo_escuro_path text, atualizado_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.logo_claro_path, i.logo_escuro_path, i.atualizado_em from public.plataforma_identidade i where i.id = 1;
$$;

-- Só o Super Admin: grava (ou remove, com nulo) a logo de uma variante, auditado.
create function public.admin_definir_logo_plataforma(p_variante text, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_variante not in ('claro', 'escuro') then
    raise exception 'Variante de logo inválida.' using errcode = '22023';
  end if;
  if p_path is not null and p_path !~ ('^logo-' || p_variante || '\.(png|jpe?g|webp)$') then
    raise exception 'Arquivo de logo inválido.' using errcode = '22023';
  end if;

  update public.plataforma_identidade
     set logo_claro_path  = case when p_variante = 'claro'  then p_path else logo_claro_path end,
         logo_escuro_path = case when p_variante = 'escuro' then p_path else logo_escuro_path end,
         atualizado_em = now(),
         atualizado_por = (select auth.uid())
   where id = 1;

  perform public.registrar_auditoria(
    case when p_path is null then 'identidade_logo_removida' else 'identidade_logo_alterada' end,
    null,
    jsonb_build_object('variante', p_variante));
end;
$$;

revoke all on function public.identidade_plataforma() from public;
grant execute on function public.identidade_plataforma() to anon, authenticated;
revoke all on function public.admin_definir_logo_plataforma(text, text) from public, anon;
grant execute on function public.admin_definir_logo_plataforma(text, text) to authenticated;

-- Bucket da marca (só onde existe o schema storage do Supabase).
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Sem schema storage (banco local): bucket plataforma-marca não criado.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('plataforma-marca', 'plataforma-marca', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy plataforma_marca_gravar on storage.objects for insert to authenticated
    with check (bucket_id = 'plataforma-marca' and public.is_super_admin())$p$;
  execute $p$
    create policy plataforma_marca_trocar on storage.objects for update to authenticated
    using (bucket_id = 'plataforma-marca' and public.is_super_admin())$p$;
  execute $p$
    create policy plataforma_marca_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'plataforma-marca' and public.is_super_admin())$p$;
  -- upsert (trocar a logo) precisa ler o objeto existente.
  execute $p$
    create policy plataforma_marca_ler on storage.objects for select to authenticated
    using (bucket_id = 'plataforma-marca' and public.is_super_admin())$p$;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Dados da empresa cliente (Super Admin)
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column nome_comercial text,
  add constraint tenants_nome_comercial_valido
    check (nome_comercial is null or (btrim(nome_comercial) <> '' and length(nome_comercial) <= 120));

-- Observações internas da plataforma sobre a empresa: só o Super Admin lê/grava.
create table public.tenant_observacoes_admin (
  tenant_id      uuid primary key references public.tenants (id) on delete cascade,
  texto          text not null check (btrim(texto) <> '' and length(texto) <= 4000),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);
alter table public.tenant_observacoes_admin enable row level security;
revoke all on public.tenant_observacoes_admin from public, anon, authenticated;

create function public.admin_observacoes_empresa(p_tenant uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return (select o.texto from public.tenant_observacoes_admin o where o.tenant_id = p_tenant);
end;
$$;

-- Cadastro completo pelo Super Admin (a versão de 6 parâmetros continua
-- valendo e não mexe nos campos novos).
create function public.admin_atualizar_empresa(
  p_tenant uuid,
  p_nome text,
  p_nome_comercial text,
  p_telefone text,
  p_email text,
  p_responsavel_nome text,
  p_logo_path text,
  p_observacoes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obs text := nullif(btrim(coalesce(p_observacoes, '')), '');
begin
  perform public.exigir_super_admin();

  update public.tenants
     set nome = btrim(p_nome),
         nome_comercial = nullif(btrim(coalesce(p_nome_comercial, '')), ''),
         telefone = nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), ''),
         email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         responsavel_nome = nullif(btrim(coalesce(p_responsavel_nome, '')), ''),
         logo_path = nullif(btrim(coalesce(p_logo_path, '')), '')
   where id = p_tenant;
  if not found then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;

  if v_obs is null then
    delete from public.tenant_observacoes_admin where tenant_id = p_tenant;
  else
    insert into public.tenant_observacoes_admin (tenant_id, texto, atualizado_em, atualizado_por)
    values (p_tenant, v_obs, now(), (select auth.uid()))
    on conflict (tenant_id) do update
      set texto = excluded.texto, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por
      where public.tenant_observacoes_admin.texto is distinct from excluded.texto;
  end if;

  perform public.registrar_auditoria('empresa_dados_alterados', p_tenant,
    jsonb_build_object('nome', btrim(p_nome), 'logo', p_logo_path is not null, 'observacoes', v_obs is not null));
end;
$$;

revoke all on function public.admin_observacoes_empresa(uuid) from public, anon;
grant execute on function public.admin_observacoes_empresa(uuid) to authenticated;
revoke all on function public.admin_atualizar_empresa(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_atualizar_empresa(uuid, text, text, text, text, text, text, text) to authenticated;
