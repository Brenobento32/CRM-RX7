-- ===========================================================================
-- T9 — Onboarding de empresa (depende de T1–T8).
--
-- `provisionar_empresa(nome, slug, admin)` — só Super Admin, idempotente e
-- atômica (uma chamada = uma transação; qualquer falha desfaz tudo):
--   1. cria a empresa (ou reaproveita a mesma, pelo slug);
--   2. garante o administrador (`admin_empresa` ativo);
--   3. garante a estrutura inicial UMA vez: funil principal com as etapas
--      padrão (as mesmas regras do funil principal atual: Lead Novo, Reunião
--      agendada/realizada, Fechado, Perdido, Recuperação), nicho "Geral",
--      formulário "padrao" e `tenant_configuracoes`.
-- Nada vem do arquivo legado: a empresa nova nasce sem clientes,
-- negociações, fechamentos ou metas.
--
-- Etapas de sistema (com `chave`) continuam bloqueadas para usuários; só a
-- função de estrutura as cria, sinalizando a empresa que está montando.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.tenant_exigir()') is null then
    raise exception 'T9 exige a T4/T8.';
  end if;
  if to_regclass('public.tenant_configuracoes') is not null then
    raise exception 'T9 já aplicada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Configurações por empresa
-- ---------------------------------------------------------------------------
create table public.tenant_configuracoes (
  tenant_id              uuid primary key references public.tenants (id) on delete restrict,
  fuso_horario           text not null default 'America/Sao_Paulo',
  moeda                  text not null default 'BRL' check (moeda ~ '^[A-Z]{3}$'),
  lead_funil_id          uuid,
  lead_responsavel_id    uuid references public.profiles (id) on delete restrict,
  lead_nicho_id          uuid,
  lead_formulario_id     uuid,
  google_conta_permitida text check (google_conta_permitida is null or google_conta_permitida = lower(btrim(google_conta_permitida))),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (tenant_id, lead_funil_id) references public.funis (tenant_id, id),
  foreign key (tenant_id, lead_nicho_id) references public.nichos (tenant_id, id),
  foreign key (tenant_id, lead_formulario_id) references public.formularios (tenant_id, id)
);

comment on table public.tenant_configuracoes is
  'Configurações iniciais por empresa: destino dos leads automáticos, fuso, moeda, conta Google aceita.';

create trigger tenant_configuracoes_set_updated_at before update on public.tenant_configuracoes
  for each row execute function public.set_updated_at();
create trigger zz_tenant_30_usuarios after insert or update on public.tenant_configuracoes
  for each row execute function public.tenant_validar_usuarios('lead_responsavel_id');

alter table public.tenant_configuracoes enable row level security;
revoke all on public.tenant_configuracoes from anon, authenticated;
grant select on public.tenant_configuracoes to authenticated;
create policy tenant_configuracoes_select on public.tenant_configuracoes for select to authenticated
  using (tenant_id = (select public.tenant_atual()));

-- ---------------------------------------------------------------------------
-- Montagem da estrutura: libera as travas só para a empresa sinalizada
-- (`rx7.estrutura_tenant`, local à transação) e só fora dos papéis da API.
-- ---------------------------------------------------------------------------
create function public.estrutura_em_montagem(p_tenant uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tenant is not null
     and current_setting('rx7.estrutura_tenant', true) = p_tenant::text
     and current_user not in ('anon', 'authenticated', 'service_role');
$$;

-- Chamada pelos triggers (inclusive em gravações de usuário, onde devolve
-- false): precisa ser executável por todos. Não libera nada por si só.
revoke all on function public.estrutura_em_montagem(uuid) from public, anon;
grant execute on function public.estrutura_em_montagem(uuid) to authenticated, service_role;

-- tenant_validar_gravacao: igual à T4 + exceção da montagem.
create or replace function public.tenant_validar_gravacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'A empresa de um registro não pode ser alterada.' using errcode = '23514';
  end if;

  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;

  if public.estrutura_em_montagem(v_tenant) and tg_op = 'INSERT' then
    return new;
  end if;

  if (select auth.uid()) is not null and not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Você não tem permissão para gravar nesta empresa.' using errcode = '42501';
  end if;

  if v_claims is not null and exists (
    select 1 from public.tenants t where t.id = v_tenant and t.somente_leitura
  ) then
    raise exception 'Esta empresa está somente leitura.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- etapas_funil_regras: igual à original + etapas de sistema só na montagem.
do $$
declare
  v_def text := pg_get_functiondef('public.etapas_funil_regras()'::regprocedure);
  v_novo text;
begin
  v_novo := replace(v_def,
    'if new.sistema or new.chave is not null then',
    'if (new.sistema or new.chave is not null) and not public.estrutura_em_montagem(new.tenant_id) then');
  if v_novo = v_def then
    raise exception 'T9 abortada: trecho esperado de etapas_funil_regras não encontrado.';
  end if;
  execute v_novo;
end $$;

-- ---------------------------------------------------------------------------
-- Estrutura inicial (idempotente; interna)
-- ---------------------------------------------------------------------------
create function public.garantir_estrutura_inicial(p_tenant uuid, p_admin uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil uuid;
  v_nicho uuid;
  v_form  uuid;
begin
  -- Serializa provisionamentos simultâneos da mesma empresa.
  perform 1 from public.tenants where id = p_tenant for update;

  perform set_config('rx7.estrutura_tenant', p_tenant::text, true);

  select f.id into v_funil from public.funis f where f.tenant_id = p_tenant and f.padrao;
  if v_funil is null then
    v_funil := gen_random_uuid();
    insert into public.funis (id, tenant_id, nome, padrao, ordem, criado_por)
    values (v_funil, p_tenant, 'Funil Principal', true, 1000, p_admin);

    -- Fechamento primeiro (as abertas precisam do limite pronto).
    insert into public.etapas_funil (funil_id, tenant_id, nome, cor, ordem, tipo, sistema, chave, etapa_inicial, pos_fechamento, participa_conversao, criado_por)
    values
      (v_funil, p_tenant, 'Fechado', 'verde',    100000, 'ganha',   true, 'fechado', false, false, true,  p_admin),
      (v_funil, p_tenant, 'Perdido', 'vermelho', 100001, 'perdida', true, 'perdido', false, false, false, p_admin);
    insert into public.etapas_funil (funil_id, tenant_id, nome, cor, ordem, tipo, sistema, chave, etapa_inicial, pos_fechamento, participa_conversao, criado_por)
    values
      (v_funil, p_tenant, 'Lead Novo',         'turquesa', 500,    'aberta', false, null,                true,  false, true,  p_admin),
      (v_funil, p_tenant, 'Reunião agendada',  'azul',     1000,   'aberta', true,  'reuniao_agendada',  false, false, true,  p_admin),
      (v_funil, p_tenant, 'Reunião realizada', 'violeta',  2000,   'aberta', true,  'reuniao_realizada', false, false, true,  p_admin),
      (v_funil, p_tenant, 'Recuperação',       'laranja',  101001, 'aberta', false, null,                false, true,  false, p_admin);
  end if;

  select n.id into v_nicho from public.nichos n where n.tenant_id = p_tenant and n.slug = 'geral';
  if v_nicho is null then
    insert into public.nichos (tenant_id, nome, slug, cor, ordem)
    values (p_tenant, 'Geral', 'geral', 'azul', 1000)
    returning id into v_nicho;
  end if;

  select f.id into v_form from public.formularios f where f.tenant_id = p_tenant and f.slug = 'padrao';
  if v_form is null then
    insert into public.formularios (tenant_id, nicho_id, nome, slug)
    values (p_tenant, v_nicho, 'Formulário padrão', 'padrao')
    returning id into v_form;
  end if;

  insert into public.tenant_configuracoes (tenant_id, lead_funil_id, lead_responsavel_id, lead_nicho_id, lead_formulario_id)
  values (p_tenant, v_funil, p_admin, v_nicho, v_form)
  on conflict (tenant_id) do nothing;

  perform set_config('rx7.estrutura_tenant', '', true);
  return v_funil;
end;
$$;

revoke all on function public.garantir_estrutura_inicial(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Provisionamento (Super Admin)
-- ---------------------------------------------------------------------------
create function public.provisionar_empresa(
  p_nome text,
  p_slug text,
  p_admin_user uuid,
  p_tipo public.tenant_tipo default 'assinante',
  p_status public.tenant_status default 'teste')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug   text := lower(btrim(p_slug));
  v_tenant uuid;
  v_tipo   public.tenant_tipo;
begin
  if not public.is_super_admin() then
    raise exception 'Somente o Super Admin pode criar empresas.' using errcode = '42501';
  end if;
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

  perform pg_advisory_xact_lock(hashtext('rx7:provisionar:' || v_slug));

  select t.id, t.tipo into v_tenant, v_tipo from public.tenants t where t.slug = v_slug;
  if v_tenant is null then
    insert into public.tenants (nome, slug, tipo, status, criado_por)
    values (btrim(p_nome), v_slug, p_tipo,
            case when p_tipo = 'interno' then 'ativo'::public.tenant_status else p_status end,
            (select auth.uid()))
    returning id into v_tenant;
  elsif v_tipo = 'arquivo' then
    raise exception 'Esse identificador pertence à empresa de arquivo.' using errcode = '22023';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, papel, convidado_por)
  values (v_tenant, p_admin_user, 'admin_empresa', (select auth.uid()))
  on conflict (tenant_id, user_id) do update
    set papel = 'admin_empresa', ativo = true;

  perform public.garantir_estrutura_inicial(v_tenant, p_admin_user);
  return v_tenant;
end;
$$;

revoke all on function public.provisionar_empresa(text, text, uuid, public.tenant_tipo, public.tenant_status) from public, anon;
grant execute on function public.provisionar_empresa(text, text, uuid, public.tenant_tipo, public.tenant_status) to authenticated;

-- Usuário por e-mail (só service_role: Edge Function de usuários decide se
-- convida ou só vincula, sem duplicar identidade).
create function public.usuario_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;

revoke all on function public.usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.usuario_por_email(text) to service_role;

-- Rio X7 (empresa interna, sem dados: o legado está no arquivo) recebe a
-- mesma estrutura inicial, se o proprietário já estiver vinculado.
do $$
declare
  v_admin uuid;
begin
  select m.user_id into v_admin
    from public.tenant_memberships m
   where m.tenant_id = public.tenant_rio_x7_id() and m.papel = 'admin_empresa' and m.ativo
   order by m.created_at
   limit 1;
  if v_admin is null then
    raise notice 'T9: Rio X7 sem admin vinculado; rode garantir_estrutura_inicial depois de vincular_proprietario_rx7.';
  else
    perform public.garantir_estrutura_inicial(public.tenant_rio_x7_id(), v_admin);
  end if;
end $$;
