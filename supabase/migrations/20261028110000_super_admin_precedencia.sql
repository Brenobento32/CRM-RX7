-- =============================================================================
-- Super Admin: a janela de acesso global vale MESMO com vínculo na empresa
-- =============================================================================
-- Em 20261028100000, tenant_atual(), papel_no_tenant() e papel_comercial()
-- consultavam primeiro o vínculo (tenant_memberships) e só depois a janela
-- aberta por admin_acessar_empresa. Um Super Admin com vínculo antigo numa
-- empresa (ex.: admin_empresa) entrava nela pelo vínculo, sem "Acessar CRM",
-- sem prazo e sem auditoria.
--
-- Regra definitiva: para quem é Super Admin, o vínculo NÃO dá acesso
-- operacional — só a janela vigente (8 h, presa à sessão, auditada). Os
-- vínculos e os dados históricos ficam intactos; só deixam de valer para o
-- próprio Super Admin enquanto ele for Super Admin. Usuários comuns não mudam.
--
-- Todas as políticas RLS das tabelas de empresa, os helpers (membro_do_tenant,
-- tem_papel_no_tenant, is_gerente, pode_escrever_no_tenant, tenant_exigir) e
-- as RPCs passam por estas três funções — a correção vale para leitura,
-- criação e alteração, via app ou API.
-- =============================================================================

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

  -- Super Admin: só a janela de acesso aberta pelo painel, com ou sem vínculo.
  if public.is_super_admin() then
    select t.id into v_id
      from public.tenants t
     where t.slug = v_slug
       and public.acesso_global_ativo(t.id);
    return v_id;
  end if;

  select t.id into v_id
    from public.tenants t
    join public.tenant_memberships m on m.tenant_id = t.id
    join public.profiles p on p.id = m.user_id
   where t.slug = v_slug
     and m.user_id = v_uid
     and m.ativo
     and p.ativo;

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
  select case
    -- Super Admin: poderes de Administrador só com a janela vigente.
    when public.is_super_admin() then
      case when public.acesso_global_ativo(p_tenant) then 'gerente'::public.tenant_papel end
    else
      (select m.papel
         from public.tenant_memberships m
         join public.tenants t on t.id = m.tenant_id
        where m.tenant_id = p_tenant
          and m.user_id = (select auth.uid())
          and m.ativo)
  end;
$$;

create or replace function public.papel_comercial(p_user uuid, p_tenant uuid)
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- O próprio Super Admin: só com a janela vigente nesta empresa.
    when p_user = (select auth.uid()) and public.is_super_admin() then
      case when public.acesso_global_ativo(p_tenant) then 'gerente'::public.user_role end
    else
      (select public.papel_do_cargo(m.papel)
         from public.tenant_memberships m
         join public.profiles p on p.id = m.user_id
        where m.tenant_id = p_tenant
          and m.user_id = p_user
          and m.ativo
          and p.ativo)
  end;
$$;

-- Lista de empresas "do usuário" pelo vínculo: não vale para o Super Admin.
create or replace function public.tenants_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.tenant_memberships m
   where m.user_id = (select auth.uid())
     and m.ativo
     and not public.is_super_admin();
$$;

-- =============================================================================
-- Responsável comercial nunca é Super Admin (qualquer Super Admin)
-- =============================================================================
-- Super Admin é privilégio global da Rio X7: pode criar e editar registros nos
-- CRMs (aparece como AUTOR), mas não pode ser RESPONSÁVEL comercial (carteira,
-- reunião, fechamento, meta, padrão de leads/WhatsApp, permissões) — mesmo
-- com vínculo antigo na empresa.
--
-- Vale para quem grava logado (app ou API, Super Admin ou Administrador) e
-- para processos automáticos (ingestão de leads via service_role, WhatsApp):
-- um lead cujo responsável configurado é Super Admin é RECUSADO com mensagem
-- clara (fica como erro na planilha / em ingestao_eventos, para reenviar
-- depois de configurar um usuário operacional) — nunca cai no Super Admin.
-- Não vale para coluna que não mudou: registros e configurações históricas
-- seguem como estão e continuam editáveis; nada é reatribuído automaticamente.
-- =============================================================================

create function public.eh_super_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.super_admins s where s.user_id = p_user);
$$;

revoke execute on function public.eh_super_admin(uuid) from public, anon, authenticated;

-- Super Admins com vínculo ativo na empresa da requisição: as telas os tiram
-- das listas de responsáveis (só ids de membros da própria empresa).
create function public.super_admins_na_empresa_atual()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
    from public.tenant_memberships m
    join public.super_admins s on s.user_id = m.user_id
   where m.tenant_id = public.tenant_atual()
     and m.ativo;
$$;

revoke execute on function public.super_admins_na_empresa_atual() from public, anon;
grant execute on function public.super_admins_na_empresa_atual() to authenticated;

create or replace function public.tenant_validar_usuarios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo    jsonb := to_jsonb(new);
  v_velho   jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col     text;
  v_user    uuid;
  v_autoria boolean;
begin
  foreach v_col in array tg_argv loop
    v_user := (v_novo ->> v_col)::uuid;
    continue when v_user is null;
    continue when v_velho is not null and (v_velho ->> v_col) is not distinct from (v_novo ->> v_col);
    v_autoria := public.coluna_de_autoria(tg_table_name, v_col);

    -- Responsável comercial: nunca um Super Admin — nem atribuído por usuário
    -- logado, nem por processo automático (ingestão de leads, WhatsApp).
    if not v_autoria and public.eh_super_admin(v_user) then
      if (select auth.uid()) is null then
        raise exception 'Responsável automático inválido (%): o Super Admin não recebe leads. Configure um usuário operacional ativo da empresa e reenvie o lead.', v_col
          using errcode = '23514';
      end if;
      raise exception 'Escolha um usuário ativo da empresa como responsável (%): o Super Admin não assume carteira.', v_col
        using errcode = '23514';
    end if;

    -- Autoria do próprio Super Admin no acesso global (com ou sem vínculo).
    continue when v_autoria and v_user = (select auth.uid()) and public.acesso_global_ativo(new.tenant_id);

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

-- =============================================================================
-- Empresa nova: o administrador inicial nunca é um Super Admin
-- =============================================================================
-- Sem isto, informar o e-mail de um Super Admin como administrador inicial
-- criaria um vínculo admin_empresa para ele (o "híbrido" que esta migration
-- neutraliza) e o poria como responsável padrão de leads. Mesma função de
-- produção, só com a checagem nova logo depois da validação do usuário.
-- =============================================================================
create or replace function public.provisionar_empresa(p_nome text, p_slug text, p_admin_user uuid, p_tipo tenant_tipo DEFAULT 'assinante'::tenant_tipo, p_status tenant_status DEFAULT 'teste'::tenant_status)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_slug   text := lower(btrim(p_slug));
  v_tenant uuid;
  v_tipo   public.tenant_tipo;
  v_nova   boolean := false;
  v_plano  public.planos;
begin
  perform public.exigir_super_admin();
  if p_tipo is null or p_tipo = 'arquivo' or p_status in ('arquivo', 'cancelado') then
    raise exception 'Tipo ou status de empresa inválido.' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 63 then
    raise exception 'Identificador (slug) inválido.' using errcode = '22023';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Informe o nome da empresa.' using errcode = '22023';
  end if;
  if p_admin_user is null
     or not exists (select 1 from auth.users u where u.id = p_admin_user)
     or not exists (select 1 from public.profiles p where p.id = p_admin_user and p.ativo) then
    raise exception 'Usuário administrador não encontrado ou inativo.' using errcode = 'P0002';
  end if;
  -- Super Admin não vira administrador (nem membro) de empresa nova: não teria
  -- vínculo operacional e acabaria como responsável padrão de leads.
  if public.eh_super_admin(p_admin_user) then
    raise exception 'O administrador inicial precisa ser um usuário da empresa, não um Super Admin.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('rx7:provisionar:' || v_slug));

  select t.id, t.tipo into v_tenant, v_tipo from public.tenants t where t.slug = v_slug;
  if v_tenant is null then
    insert into public.tenants (nome, slug, tipo, status, criado_por)
    values (btrim(p_nome), v_slug, p_tipo,
            case when p_tipo = 'interno' then 'ativo'::public.tenant_status else p_status end,
            (select auth.uid()))
    returning id into v_tenant;
    v_nova := true;
  elsif v_tipo = 'arquivo' then
    raise exception 'Esse identificador pertence à empresa de arquivo.' using errcode = '22023';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, papel, convidado_por)
  values (v_tenant, p_admin_user, 'admin_empresa', (select auth.uid()))
  on conflict (tenant_id, user_id) do update
    set papel = 'admin_empresa', ativo = true;

  perform public.garantir_estrutura_inicial(v_tenant, p_admin_user);

  -- Assinante nova começa em teste no Starter (uma vez).
  if p_tipo = 'assinante' and not exists (select 1 from public.assinaturas a where a.tenant_id = v_tenant) then
    select * into v_plano from public.planos where codigo = 'starter';
    perform set_config('rx7.origem_assinatura', 'super_admin', true);
    perform set_config('rx7.motivo_assinatura', 'Criação da empresa', true);
    insert into public.assinaturas (tenant_id, plano_id, status, teste_ate)
    values (v_tenant, v_plano.id, 'teste',
            case when v_plano.dias_teste is not null then now() + make_interval(days => v_plano.dias_teste) end);
  end if;

  perform public.registrar_auditoria(case when v_nova then 'empresa_criada' else 'empresa_provisionada_novamente' end,
    v_tenant, jsonb_build_object('slug', v_slug, 'admin_id', p_admin_user));
  return v_tenant;
end;
$function$;
