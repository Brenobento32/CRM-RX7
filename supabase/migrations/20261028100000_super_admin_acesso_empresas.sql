-- ===========================================================================
-- Acesso operacional do Super Admin aos CRMs das empresas — explícito,
-- temporário e auditado.
--
-- Hierarquia do SaaS:
--   * Super Admin (tabela super_admins, só os proprietários da Rio X7; nenhum
--     usuário grava nela — só service_role): entra por /admin e pode abrir o
--     CRM de QUALQUER empresa pelo painel global, sem precisar de vínculo.
--   * Administrador da empresa (papel técnico 'gerente'/'admin_empresa'):
--     só a própria empresa, por vínculo (tenant_memberships).
--   * Vendedor, Atendente, SDR, Closer: só a empresa vinculada e as
--     permissões do cargo.
--
-- Como o Super Admin entra numa empresa:
--   1. No painel, "Acessar CRM" chama admin_acessar_empresa(tenant, motivo):
--      exige Super Admin, abre uma janela de acesso (8 h) e grava na
--      auditoria (admin_auditoria: acesso_empresa_iniciado).
--   2. Enquanto a janela estiver aberta, tenant_atual() resolve a empresa da
--      URL para ele (mesmo sem vínculo) e o papel nela é o de Administrador
--      (papel_no_tenant/papel_comercial → 'gerente'). Todas as policies e RPCs
--      existentes passam a valer para ele exatamente como para um
--      Administrador daquela empresa — e só daquela.
--   3. A janela fecha (sempre auditado): "Encerrar acesso"; abrir outra
--      empresa (fecha TODAS as anteriores); logout e novo login
--      (encerrar_meus_acessos_globais); ou o prazo de 8 h. Ela também fica
--      presa à sessão que a abriu (session_id do JWT): outra sessão —
--      novo login, outro navegador — nunca a reaproveita.
--
-- Autoria × responsabilidade: durante a janela o Super Admin pode ser AUTOR
-- (criado_por, fechado_por, autor das atividades...), nunca responsável
-- comercial (owner_id, responsável da reunião/fechamento, metas, padrões):
-- esses campos continuam exigindo um usuário ativo da empresa.
--
-- Sem a janela, nada muda: digitar a URL de uma empresa não dá acesso, nem a
-- Super Admin. Para os demais usuários o comportamento é idêntico ao anterior
-- (as funções só ganham um caminho a mais, que exige is_super_admin()).
--
-- Não altera dados, cargos nem vínculos existentes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Janelas de acesso
-- ---------------------------------------------------------------------------
create table public.super_admin_acessos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  motivo text check (motivo is null or char_length(motivo) <= 300),
  -- Sessão (JWT session_id) que abriu a janela; só ela pode usá-la.
  sessao_id text,
  iniciado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  encerrado_em timestamptz,
  constraint super_admin_acessos_prazo check (expira_em > iniciado_em)
);

comment on table public.super_admin_acessos is
  'Janelas de acesso do Super Admin ao CRM de uma empresa (abertas/encerradas só pelas RPCs admin_*; auditadas).';

create index super_admin_acessos_ativos on public.super_admin_acessos (user_id, tenant_id)
  where encerrado_em is null;

-- Ninguém lê nem grava direto: só as funções security definer abaixo.
alter table public.super_admin_acessos enable row level security;
revoke all on public.super_admin_acessos from public, anon, authenticated;

-- Sessão do JWT atual (claim session_id do Supabase Auth).
create function public.sessao_atual()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json ->> 'session_id';
$$;

-- Janela aberta, vigente e da MESMA sessão, do usuário ATUAL (que precisa continuar Super Admin).
create function public.acesso_global_ativo(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant is not null
     and public.is_super_admin()
     and exists (
       select 1
         from public.super_admin_acessos a
        where a.user_id = (select auth.uid())
          and a.tenant_id = p_tenant
          and a.encerrado_em is null
          and a.expira_em > now()
          and a.sessao_id is not distinct from public.sessao_atual()
     );
$$;

revoke execute on function public.acesso_global_ativo(uuid) from public, anon;
grant execute on function public.acesso_global_ativo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Resolução da empresa e do papel: vínculo OU janela de acesso global
-- ---------------------------------------------------------------------------
create or replace function public.tenant_atual()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_hdr  text;
  v_slug text;
  v_id   uuid;
begin
  if v_uid is null then
    return null;
  end if;

  v_hdr := nullif(current_setting('request.headers', true), '');
  if v_hdr is null then
    return null;
  end if;

  begin
    v_slug := lower(btrim(v_hdr::json ->> 'x-rx7-tenant'));
  exception when others then
    return null;
  end;

  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return null;
  end if;

  select t.id into v_id
    from public.tenants t
    join public.tenant_memberships m on m.tenant_id = t.id
    join public.profiles p on p.id = m.user_id
   where t.slug = v_slug
     and m.user_id = v_uid
     and m.ativo
     and p.ativo;

  -- Super Admin sem vínculo: só com a janela de acesso aberta pelo painel.
  if v_id is null then
    select t.id into v_id
      from public.tenants t
     where t.slug = v_slug
       and public.acesso_global_ativo(t.id);
  end if;

  return v_id;
end;
$$;

create or replace function public.papel_no_tenant(p_tenant uuid)
returns public.tenant_papel
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.papel
       from public.tenant_memberships m
       join public.tenants t on t.id = m.tenant_id
      where m.tenant_id = p_tenant
        and m.user_id = (select auth.uid())
        and m.ativo),
    -- Janela de acesso global: poderes de Administrador nesta empresa.
    case when public.acesso_global_ativo(p_tenant) then 'gerente'::public.tenant_papel end
  );
$$;

create or replace function public.papel_comercial(p_user uuid, p_tenant uuid)
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.papel_do_cargo(m.papel)
       from public.tenant_memberships m
       join public.profiles p on p.id = m.user_id
      where m.tenant_id = p_tenant
        and m.user_id = p_user
        and m.ativo
        and p.ativo),
    -- Só para o próprio Super Admin, com a janela aberta nesta empresa.
    case when p_user = (select auth.uid()) and public.acesso_global_ativo(p_tenant) then 'gerente'::public.user_role end
  );
$$;

-- Colunas de AUTORIA (quem fez), por tabela. Todo o resto é responsabilidade
-- comercial (carteira, responsável da reunião/fechamento, metas, padrões).
create function public.coluna_de_autoria(p_tabela text, p_coluna text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_coluna in ('criado_por', 'excluido_por', 'excluida_por', 'fechado_por', 'anulado_por', 'conectado_por', 'autor_id')
      or (p_coluna = 'usuario_id' and p_tabela in (
            'atividades', 'historico_etapas', 'proximas_acoes',
            'mensagem_exclusoes', 'mensagem_reacoes', 'agenda_google_oauth_estados'));
$$;

-- Durante a janela, o Super Admin pode ser AUTOR do que grava; nunca o
-- responsável comercial. Qualquer outro usuário continua precisando de vínculo.
create or replace function public.tenant_validar_usuarios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo  jsonb := to_jsonb(new);
  v_velho jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col   text;
  v_user  uuid;
begin
  foreach v_col in array tg_argv loop
    v_user := (v_novo ->> v_col)::uuid;
    continue when v_user is null;
    continue when v_velho is not null and (v_velho ->> v_col) is not distinct from (v_novo ->> v_col);
    if v_user = (select auth.uid()) and public.acesso_global_ativo(new.tenant_id) then
      continue when public.coluna_de_autoria(tg_table_name, v_col);
      raise exception 'Escolha um usuário ativo da empresa como responsável (%): o Super Admin não assume carteira.', v_col
        using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.tenant_memberships m
       where m.tenant_id = new.tenant_id and m.user_id = v_user and m.ativo
    ) then
      raise exception 'O usuário informado em % não pertence a esta empresa.', v_col
        using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Abrir / encerrar o acesso (painel global) — sempre auditado
-- ---------------------------------------------------------------------------

-- Fecha TODAS as janelas abertas do usuário atual (logout, novo login, troca
-- de empresa), auditando cada uma. Para quem não é Super Admin não faz nada
-- (o logout de qualquer usuário pode chamar sem erro). Devolve quantas fechou.
create function public.encerrar_meus_acessos_globais(p_motivo text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_janela record;
  v_n      integer := 0;
begin
  if not public.is_super_admin() then
    return 0;
  end if;

  for v_janela in
    update public.super_admin_acessos a
       set encerrado_em = now()
     where a.user_id = (select auth.uid()) and a.encerrado_em is null
    returning a.tenant_id, a.expira_em
  loop
    v_n := v_n + 1;
    perform public.registrar_auditoria(
      'acesso_empresa_encerrado', v_janela.tenant_id,
      jsonb_build_object(
        'motivo', left(coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'encerrado'), 60),
        'ja_vencido', v_janela.expira_em <= now()
      )
    );
  end loop;
  return v_n;
end;
$$;
create function public.admin_acessar_empresa(p_tenant uuid, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug   text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_expira timestamptz := now() + interval '8 hours';
begin
  perform public.exigir_super_admin();

  select t.slug into v_slug from public.tenants t where t.id = p_tenant;
  if v_slug is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_motivo is not null and char_length(v_motivo) > 300 then
    raise exception 'Motivo muito longo (máximo 300 caracteres).' using errcode = '22023';
  end if;

  -- Uma empresa por vez: abrir esta encerra TODAS as janelas anteriores
  -- (desta ou de outra empresa, desta ou de outra sessão), cada uma auditada.
  perform public.encerrar_meus_acessos_globais('troca de empresa');

  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, expira_em)
  values ((select auth.uid()), p_tenant, v_motivo, public.sessao_atual(), v_expira);

  perform public.registrar_auditoria(
    'acesso_empresa_iniciado', p_tenant,
    jsonb_build_object('motivo', coalesce(v_motivo, 'Acesso pelo painel global'), 'expira_em', v_expira)
  );

  return v_slug;
end;
$$;

create function public.admin_encerrar_acesso_empresa(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();

  update public.super_admin_acessos a
     set encerrado_em = now()
   where a.user_id = (select auth.uid()) and a.tenant_id = p_tenant and a.encerrado_em is null;

  if found then
    perform public.registrar_auditoria('acesso_empresa_encerrado', p_tenant, jsonb_build_object('motivo', 'encerrado pelo Super Admin'));
  end if;
end;
$$;

revoke execute on function public.admin_acessar_empresa(uuid, text) from public, anon;
revoke execute on function public.admin_encerrar_acesso_empresa(uuid) from public, anon;
grant execute on function public.admin_acessar_empresa(uuid, text) to authenticated;
grant execute on function public.admin_encerrar_acesso_empresa(uuid) to authenticated;
revoke execute on function public.encerrar_meus_acessos_globais(text) from public, anon;
grant execute on function public.encerrar_meus_acessos_globais(text) to authenticated;
revoke execute on function public.sessao_atual() from public, anon;
grant execute on function public.sessao_atual() to authenticated;
