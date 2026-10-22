-- ===========================================================================
-- T13 — Super Admin, planos e assinaturas (depende de T9–T12).
--
-- PLANOS (`planos`): Starter, Pro, Business, configuráveis pelo Super Admin:
--   preço mensal/anual (NULO até a Rio X7 decidir — nenhum valor inventado),
--   limite de usuários, limite de integrações, dias de teste, recursos e
--   status (rascunho/ativo/inativo).
-- ASSINATURAS (`assinaturas`, uma por empresa): plano, status
--   (teste/ativa/vencida/suspensa/cancelada), ciclo, início, fim do teste,
--   renovação, cancelamento e a referência opcional do provedor de pagamento.
--   O status da assinatura define o da empresa (suspensa/cancelada = somente
--   leitura; nada é apagado). Histórico automático em `assinaturas_historico`.
-- PAGAMENTO: `pagamento_eventos` + `registrar_evento_pagamento` (service_role)
--   — independente do provedor, idempotente por (provedor, evento_id).
-- AUDITORIA: `admin_auditoria` registra toda ação administrativa.
-- LIMITES no banco: usuários ativos, integrações (credenciais de ingestão +
--   Google) e recursos do plano. Empresa sem assinatura (interna/arquivo) não
--   tem limite.
--
-- Acesso: tabelas sem nenhum GRANT para anon/authenticated; tudo por RPC
-- SECURITY DEFINER que confere `is_super_admin()` no banco. O Super Admin
-- continua SEM acesso a dados comerciais (as RPCs só devolvem cadastro,
-- contagem de usuários e assinatura). A empresa de arquivo não recebe
-- assinatura e não é suspensa/reativada; a empresa interna não é suspensa.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.provisionar_empresa(text, text, uuid, public.tenant_tipo, public.tenant_status)') is null then
    raise exception 'T13 exige a T9.';
  end if;
  if to_regclass('public.planos') is not null then
    raise exception 'T13 já aplicada.';
  end if;
end $$;

create type public.plano_status as enum ('rascunho', 'ativo', 'inativo');
create type public.assinatura_status as enum ('teste', 'ativa', 'vencida', 'suspensa', 'cancelada');
create type public.assinatura_ciclo as enum ('mensal', 'anual');

-- Recursos conhecidos (a lista de cada plano é configurável).
create function public.recursos_validos()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads', 'whatsapp', 'relatorios'] $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.planos (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique check (codigo ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nome                text not null check (btrim(nome) <> ''),
  preco_mensal        numeric(12, 2) check (preco_mensal is null or preco_mensal >= 0),
  preco_anual         numeric(12, 2) check (preco_anual is null or preco_anual >= 0),
  limite_usuarios     integer check (limite_usuarios is null or limite_usuarios >= 1),
  limite_integracoes  integer check (limite_integracoes is null or limite_integracoes >= 0),
  dias_teste          integer check (dias_teste is null or dias_teste between 0 and 365),
  recursos            text[] not null default '{}' check (recursos <@ public.recursos_validos()),
  status              public.plano_status not null default 'rascunho',
  ordem               integer not null default 1000,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.planos is 'Planos do SaaS. Preços e limites nulos = ainda não definidos (sem limite).';

create table public.assinaturas (
  tenant_id               uuid primary key references public.tenants (id) on delete restrict,
  plano_id                uuid not null references public.planos (id) on delete restrict,
  status                  public.assinatura_status not null default 'teste',
  ciclo                   public.assinatura_ciclo not null default 'mensal',
  inicio_em               timestamptz not null default now(),
  teste_ate               timestamptz,
  renovacao_em            timestamptz,
  cancelada_em            timestamptz,
  provedor                text check (provedor is null or provedor ~ '^[a-z0-9_]+$'),
  provedor_assinatura_id  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (provedor, provedor_assinatura_id)
);

create table public.assinaturas_historico (
  id            bigserial primary key,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  de_status     public.assinatura_status,
  para_status   public.assinatura_status not null,
  de_plano_id   uuid references public.planos (id),
  para_plano_id uuid not null references public.planos (id),
  origem        text not null check (origem in ('super_admin', 'pagamento', 'sistema')),
  motivo        text,
  ator_id       uuid,
  evento_id     bigint,
  criado_em     timestamptz not null default now()
);
create index assinaturas_historico_tenant_idx on public.assinaturas_historico (tenant_id, criado_em desc);

create table public.admin_auditoria (
  id         bigserial primary key,
  ator_id    uuid,
  acao       text not null,
  tenant_id  uuid references public.tenants (id) on delete restrict,
  detalhes   jsonb not null default '{}'::jsonb,
  criado_em  timestamptz not null default now()
);
create index admin_auditoria_tenant_idx on public.admin_auditoria (tenant_id, criado_em desc);
create index admin_auditoria_criado_idx on public.admin_auditoria (criado_em desc);

create table public.pagamento_eventos (
  id             bigserial primary key,
  provedor       text not null check (provedor ~ '^[a-z0-9_]+$'),
  evento_id      text not null check (btrim(evento_id) <> ''),
  tipo           text not null,
  tenant_id      uuid references public.tenants (id) on delete restrict,
  payload        jsonb,
  recebido_em    timestamptz not null default now(),
  processado_em  timestamptz,
  resultado      text,
  unique (provedor, evento_id)
);

create trigger planos_set_updated_at before update on public.planos
  for each row execute function public.set_updated_at();
create trigger assinaturas_set_updated_at before update on public.assinaturas
  for each row execute function public.set_updated_at();

-- Sem acesso direto: só RPCs.
do $$
declare
  v_t text;
begin
  foreach v_t in array array['planos', 'assinaturas', 'assinaturas_historico', 'admin_auditoria', 'pagamento_eventos'] loop
    execute format('alter table public.%I enable row level security', v_t);
    execute format('revoke all on public.%I from anon, authenticated', v_t);
  end loop;
end $$;

-- Planos iniciais: SEM preço e SEM limite (a definir pelo Super Admin).
insert into public.planos (codigo, nome, recursos, status, ordem) values
  ('starter',  'Starter',  array['metas'], 'rascunho', 1000),
  ('pro',      'Pro',      array['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads'], 'rascunho', 2000),
  ('business', 'Business', array['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads', 'whatsapp', 'relatorios'], 'rascunho', 3000);

-- ---------------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------------

-- Arquivo nunca tem assinatura; só empresa assinante.
create function public.assinaturas_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo public.tenant_tipo;
begin
  select t.tipo into v_tipo from public.tenants t where t.id = new.tenant_id;
  if v_tipo is distinct from 'assinante' then
    raise exception 'Só empresas assinantes têm assinatura (arquivo e interna não).' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.tenant_id <> old.tenant_id then
    raise exception 'A empresa da assinatura não muda.' using errcode = '23514';
  end if;
  if new.status = 'cancelada' and new.cancelada_em is null then
    new.cancelada_em := now();
  elsif new.status <> 'cancelada' then
    new.cancelada_em := null;
  end if;
  return new;
end;
$$;

create trigger assinaturas_regras before insert or update on public.assinaturas
  for each row execute function public.assinaturas_regras();

-- Histórico automático + empresa acompanha a assinatura.
create function public.assinaturas_apos_mudanca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.plano_id is distinct from old.plano_id then
    insert into public.assinaturas_historico (tenant_id, de_status, para_status, de_plano_id, para_plano_id, origem, motivo, ator_id, evento_id)
    values (new.tenant_id,
            case when tg_op = 'UPDATE' then old.status end, new.status,
            case when tg_op = 'UPDATE' then old.plano_id end, new.plano_id,
            coalesce(nullif(current_setting('rx7.origem_assinatura', true), ''), 'sistema'),
            nullif(current_setting('rx7.motivo_assinatura', true), ''),
            (select auth.uid()),
            nullif(current_setting('rx7.evento_pagamento', true), '')::bigint);
  end if;

  update public.tenants t
     set status = case new.status
                    when 'teste'     then 'teste'
                    when 'ativa'     then 'ativo'
                    when 'vencida'   then 'ativo'   -- carência: continua usando até suspender/cancelar
                    when 'suspensa'  then 'suspenso'
                    when 'cancelada' then 'cancelado'
                  end::public.tenant_status
   where t.id = new.tenant_id and t.tipo = 'assinante';
  return null;
end;
$$;

create trigger assinaturas_apos_mudanca after insert or update on public.assinaturas
  for each row execute function public.assinaturas_apos_mudanca();

-- Plano vigente (null = sem assinatura = sem limites).
create function public.plano_da_empresa(p_tenant uuid)
returns public.planos
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.assinaturas a join public.planos p on p.id = a.plano_id where a.tenant_id = p_tenant;
$$;

create function public.uso_integracoes(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.ingestao_credenciais c where c.tenant_id = p_tenant and c.ativo)::integer
       + (select count(*) from public.agenda_google_conexao g where g.tenant_id = p_tenant)::integer;
$$;

-- Usuários ativos por empresa.
create function public.limite_usuarios_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite integer;
  v_uso    integer;
begin
  if not new.ativo or (tg_op = 'UPDATE' and old.ativo) then
    return new;
  end if;
  select (public.plano_da_empresa(new.tenant_id)).limite_usuarios into v_limite;
  if v_limite is null then
    return new;
  end if;
  perform 1 from public.tenants where id = new.tenant_id for update;  -- serializa convites simultâneos
  select count(*) into v_uso from public.tenant_memberships m
   where m.tenant_id = new.tenant_id and m.ativo and m.id is distinct from new.id;
  if v_uso >= v_limite then
    raise exception 'Limite de usuários do plano atingido (%).', v_limite using errcode = 'RX001';
  end if;
  return new;
end;
$$;

create trigger zz_limite_usuarios before insert or update of ativo on public.tenant_memberships
  for each row execute function public.limite_usuarios_valida();

-- Integrações: recurso do plano + limite (credenciais ativas + Google).
create function public.limite_integracoes_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano   public.planos;
  v_recurso text := tg_argv[0];
begin
  -- to_jsonb: as duas tabelas têm colunas diferentes (agenda_google_conexao não tem `ativo`).
  if tg_table_name = 'ingestao_credenciais' and not coalesce((to_jsonb(new) ->> 'ativo')::boolean, true) then
    return new;
  end if;
  -- Reconectar o Google (upsert na mesma empresa) não é integração nova.
  if tg_table_name = 'agenda_google_conexao'
     and exists (select 1 from public.agenda_google_conexao g where g.tenant_id = new.tenant_id) then
    return new;
  end if;
  v_plano := public.plano_da_empresa(new.tenant_id);
  if v_plano.id is null then
    return new;
  end if;
  if not (v_recurso = any (v_plano.recursos)) then
    raise exception 'Recurso "%" não incluído no plano %.', v_recurso, v_plano.nome using errcode = 'RX003';
  end if;
  if v_plano.limite_integracoes is not null then
    perform 1 from public.tenants where id = new.tenant_id for update;
    if public.uso_integracoes(new.tenant_id) >= v_plano.limite_integracoes then
      raise exception 'Limite de integrações do plano atingido (%).', v_plano.limite_integracoes using errcode = 'RX002';
    end if;
  end if;
  return new;
end;
$$;

create trigger zz_limite_integracoes before insert on public.ingestao_credenciais
  for each row execute function public.limite_integracoes_valida('ingestao_leads');
create trigger zz_limite_integracoes before insert on public.agenda_google_conexao
  for each row execute function public.limite_integracoes_valida('agenda_google');

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
create function public.registrar_auditoria(p_acao text, p_tenant uuid, p_detalhes jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), p_acao, p_tenant, coalesce(p_detalhes, '{}'::jsonb));
$$;

create function public.exigir_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Somente o Super Admin.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding (T9) + assinatura de teste + auditoria
-- ---------------------------------------------------------------------------
create or replace function public.provisionar_empresa(
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
$$;

-- ---------------------------------------------------------------------------
-- RPCs do Super Admin
-- ---------------------------------------------------------------------------
create function public.admin_listar_empresas(p_tenant uuid default null)
returns table (
  id uuid, nome text, slug text, tipo public.tenant_tipo, status public.tenant_status, somente_leitura boolean,
  criado_em timestamptz, usuarios_ativos bigint, administradores text[],
  plano_codigo text, plano_nome text, assinatura_status public.assinatura_status, ciclo public.assinatura_ciclo,
  teste_ate timestamptz, renovacao_em timestamptz, cancelada_em timestamptz, integracoes_em_uso integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  -- Só cadastro, contagem de usuários e assinatura: nenhum dado comercial.
  return query
    select t.id, t.nome, t.slug, t.tipo, t.status, t.somente_leitura, t.created_at,
           (select count(*) from public.tenant_memberships m where m.tenant_id = t.id and m.ativo),
           array(select p.email from public.tenant_memberships m join public.profiles p on p.id = m.user_id
                  where m.tenant_id = t.id and m.papel = 'admin_empresa' and m.ativo order by p.email),
           pl.codigo, pl.nome, a.status, a.ciclo, a.teste_ate, a.renovacao_em, a.cancelada_em,
           public.uso_integracoes(t.id)
      from public.tenants t
      left join public.assinaturas a on a.tenant_id = t.id
      left join public.planos pl on pl.id = a.plano_id
     where p_tenant is null or t.id = p_tenant
     order by (t.tipo = 'arquivo'), t.created_at;
end;
$$;

create function public.admin_listar_planos()
returns setof public.planos
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query select * from public.planos order by ordem, codigo;
end;
$$;

create function public.admin_salvar_plano(
  p_codigo text, p_nome text, p_preco_mensal numeric, p_preco_anual numeric,
  p_limite_usuarios integer, p_limite_integracoes integer, p_dias_teste integer,
  p_recursos text[], p_status public.plano_status)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_antes jsonb;
begin
  perform public.exigir_super_admin();
  select to_jsonb(p) into v_antes from public.planos p where p.codigo = p_codigo;

  insert into public.planos (codigo, nome, preco_mensal, preco_anual, limite_usuarios, limite_integracoes, dias_teste, recursos, status)
  values (p_codigo, btrim(p_nome), p_preco_mensal, p_preco_anual, p_limite_usuarios, p_limite_integracoes, p_dias_teste,
          coalesce(p_recursos, '{}'), coalesce(p_status, 'rascunho'))
  on conflict (codigo) do update
    set nome = excluded.nome, preco_mensal = excluded.preco_mensal, preco_anual = excluded.preco_anual,
        limite_usuarios = excluded.limite_usuarios, limite_integracoes = excluded.limite_integracoes,
        dias_teste = excluded.dias_teste, recursos = excluded.recursos, status = excluded.status
  returning id into v_id;

  perform public.registrar_auditoria('plano_salvo', null,
    jsonb_build_object('codigo', p_codigo, 'antes', v_antes,
                       'depois', (select to_jsonb(p) from public.planos p where p.id = v_id)));
  return v_id;
end;
$$;

create function public.admin_definir_assinatura(
  p_tenant uuid, p_plano_codigo text, p_status public.assinatura_status, p_ciclo public.assinatura_ciclo,
  p_renovacao_em timestamptz, p_teste_ate timestamptz, p_motivo text,
  p_provedor text default null, p_provedor_assinatura_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano public.planos;
  v_tipo  public.tenant_tipo;
  v_antes jsonb;
begin
  perform public.exigir_super_admin();
  select t.tipo into v_tipo from public.tenants t where t.id = p_tenant for update;
  if v_tipo is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_tipo <> 'assinante' then
    raise exception 'Só empresas assinantes têm assinatura (arquivo e interna não).' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo da alteração.' using errcode = '22023';
  end if;
  select * into v_plano from public.planos p where p.codigo = p_plano_codigo;
  if v_plano.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'P0002';
  end if;

  select to_jsonb(a) into v_antes from public.assinaturas a where a.tenant_id = p_tenant;
  if v_plano.status = 'inativo' and (v_antes is null or (v_antes ->> 'plano_id')::uuid <> v_plano.id) then
    raise exception 'Plano inativo não pode ser atribuído.' using errcode = '22023';
  end if;

  perform set_config('rx7.origem_assinatura', 'super_admin', true);
  perform set_config('rx7.motivo_assinatura', btrim(p_motivo), true);

  insert into public.assinaturas (tenant_id, plano_id, status, ciclo, renovacao_em, teste_ate, provedor, provedor_assinatura_id)
  values (p_tenant, v_plano.id, coalesce(p_status, 'teste'), coalesce(p_ciclo, 'mensal'), p_renovacao_em, p_teste_ate,
          nullif(btrim(p_provedor), ''), nullif(btrim(p_provedor_assinatura_id), ''))
  on conflict (tenant_id) do update
    set plano_id = excluded.plano_id, status = excluded.status, ciclo = excluded.ciclo,
        renovacao_em = excluded.renovacao_em, teste_ate = excluded.teste_ate,
        provedor = coalesce(excluded.provedor, public.assinaturas.provedor),
        provedor_assinatura_id = coalesce(excluded.provedor_assinatura_id, public.assinaturas.provedor_assinatura_id);

  perform public.registrar_auditoria('assinatura_definida', p_tenant,
    jsonb_build_object('motivo', btrim(p_motivo), 'antes', v_antes,
                       'depois', (select to_jsonb(a) from public.assinaturas a where a.tenant_id = p_tenant)));
end;
$$;

-- Suspender: empresa somente leitura, nenhum dado apagado.
create function public.admin_suspender_empresa(p_tenant uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo   public.tenant_tipo;
  v_status public.tenant_status;
begin
  perform public.exigir_super_admin();
  select t.tipo, t.status into v_tipo, v_status from public.tenants t where t.id = p_tenant for update;
  if v_tipo is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_tipo <> 'assinante' then
    raise exception 'A empresa de arquivo e a empresa interna não podem ser suspensas.' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo da suspensão.' using errcode = '22023';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Empresa cancelada: reative a assinatura antes.' using errcode = '22023';
  end if;

  perform set_config('rx7.origem_assinatura', 'super_admin', true);
  perform set_config('rx7.motivo_assinatura', btrim(p_motivo), true);
  if exists (select 1 from public.assinaturas a where a.tenant_id = p_tenant) then
    update public.assinaturas set status = 'suspensa' where tenant_id = p_tenant;
  else
    update public.tenants set status = 'suspenso' where id = p_tenant;
  end if;

  perform public.registrar_auditoria('empresa_suspensa', p_tenant,
    jsonb_build_object('motivo', btrim(p_motivo), 'status_anterior', v_status));
end;
$$;

-- Reativar: mesma empresa, mesmos dados; volta a ativa (ou teste, se o teste não venceu).
create function public.admin_reativar_empresa(p_tenant uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo   public.tenant_tipo;
  v_status public.tenant_status;
  v_ass    public.assinaturas;
begin
  perform public.exigir_super_admin();
  select t.tipo, t.status into v_tipo, v_status from public.tenants t where t.id = p_tenant for update;
  if v_tipo is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_tipo <> 'assinante' then
    raise exception 'A empresa de arquivo e a empresa interna não são reativadas por aqui.' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo da reativação.' using errcode = '22023';
  end if;

  perform set_config('rx7.origem_assinatura', 'super_admin', true);
  perform set_config('rx7.motivo_assinatura', btrim(p_motivo), true);
  select * into v_ass from public.assinaturas a where a.tenant_id = p_tenant;
  if v_ass.tenant_id is not null then
    update public.assinaturas
       set status = case when teste_ate is not null and teste_ate > now() then 'teste' else 'ativa' end::public.assinatura_status
     where tenant_id = p_tenant;
  else
    update public.tenants set status = 'ativo' where id = p_tenant;
  end if;

  perform public.registrar_auditoria('empresa_reativada', p_tenant,
    jsonb_build_object('motivo', btrim(p_motivo), 'status_anterior', v_status));
end;
$$;

create function public.admin_listar_auditoria(p_tenant uuid default null, p_limite integer default 100)
returns table (id bigint, criado_em timestamptz, acao text, tenant_id uuid, empresa text, ator_email text, detalhes jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
    select a.id, a.criado_em, a.acao, a.tenant_id, t.nome, p.email, a.detalhes
      from public.admin_auditoria a
      left join public.tenants t on t.id = a.tenant_id
      left join public.profiles p on p.id = a.ator_id
     where p_tenant is null or a.tenant_id = p_tenant
     order by a.criado_em desc, a.id desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end;
$$;

create function public.admin_historico_assinatura(p_tenant uuid)
returns table (criado_em timestamptz, de_status public.assinatura_status, para_status public.assinatura_status,
               de_plano text, para_plano text, origem text, motivo text, ator_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
    select h.criado_em, h.de_status, h.para_status, pd.nome, pp.nome, h.origem, h.motivo, u.email
      from public.assinaturas_historico h
      left join public.planos pd on pd.id = h.de_plano_id
      join public.planos pp on pp.id = h.para_plano_id
      left join public.profiles u on u.id = h.ator_id
     where h.tenant_id = p_tenant
     order by h.criado_em desc, h.id desc
     limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cliente: "Minha assinatura" (admin_empresa da empresa da requisição; só leitura)
-- ---------------------------------------------------------------------------
create function public.minha_assinatura()
returns table (
  empresa text, plano_codigo text, plano_nome text, status public.assinatura_status, ciclo public.assinatura_ciclo,
  inicio_em timestamptz, teste_ate timestamptz, renovacao_em timestamptz, cancelada_em timestamptz,
  preco_mensal numeric, preco_anual numeric,
  limite_usuarios integer, usuarios_ativos bigint, limite_integracoes integer, integracoes_em_uso integer,
  recursos text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa']::public.tenant_papel[]) then
    raise exception 'Somente o administrador da empresa vê a assinatura.' using errcode = '42501';
  end if;
  return query
    select t.nome, p.codigo, p.nome, a.status, a.ciclo, a.inicio_em, a.teste_ate, a.renovacao_em, a.cancelada_em,
           p.preco_mensal, p.preco_anual,
           p.limite_usuarios, (select count(*) from public.tenant_memberships m where m.tenant_id = t.id and m.ativo),
           p.limite_integracoes, public.uso_integracoes(t.id), p.recursos
      from public.tenants t
      left join public.assinaturas a on a.tenant_id = t.id
      left join public.planos p on p.id = a.plano_id
     where t.id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pagamento (service_role): eventos idempotentes, independentes do provedor
-- ---------------------------------------------------------------------------
-- O adaptador do provedor (futura Edge Function) traduz o evento para:
-- provedor, id do evento, tipo, referência da assinatura no provedor e o
-- status resultante. Reenvio do mesmo evento = 'duplicado' e nada muda.
-- Suspensão manual do Super Admin nunca é desfeita por um pagamento.
create function public.registrar_evento_pagamento(
  p_provedor text, p_evento_id text, p_tipo text, p_provedor_assinatura_id text,
  p_novo_status public.assinatura_status default null, p_renovacao_em timestamptz default null,
  p_payload jsonb default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento bigint;
  v_ass    public.assinaturas;
  v_res    text;
begin
  if p_novo_status = 'suspensa' then
    raise exception 'Suspensão é só manual (Super Admin).' using errcode = '22023';
  end if;

  insert into public.pagamento_eventos (provedor, evento_id, tipo, payload)
  values (lower(btrim(p_provedor)), btrim(p_evento_id), btrim(p_tipo), p_payload)
  on conflict (provedor, evento_id) do nothing
  returning id into v_evento;
  if v_evento is null then
    return 'duplicado';
  end if;

  select * into v_ass from public.assinaturas a
   where a.provedor = lower(btrim(p_provedor)) and a.provedor_assinatura_id = btrim(p_provedor_assinatura_id)
     for update;

  if v_ass.tenant_id is null then
    v_res := 'ignorado_sem_assinatura';
  elsif v_ass.status = 'suspensa' then
    v_res := 'mantido_suspensa';
  elsif p_novo_status is null and p_renovacao_em is null then
    v_res := 'sem_mudanca';
  else
    perform set_config('rx7.origem_assinatura', 'pagamento', true);
    perform set_config('rx7.motivo_assinatura', 'Evento ' || btrim(p_tipo), true);
    perform set_config('rx7.evento_pagamento', v_evento::text, true);
    update public.assinaturas
       set status = coalesce(p_novo_status, status), renovacao_em = coalesce(p_renovacao_em, renovacao_em)
     where tenant_id = v_ass.tenant_id;
    v_res := 'processado';
  end if;

  update public.pagamento_eventos
     set tenant_id = v_ass.tenant_id, processado_em = now(), resultado = v_res
   where id = v_evento;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
do $$
declare
  v_f text;
begin
  -- Internas: ninguém chama direto.
  foreach v_f in array array[
    'public.assinaturas_regras()', 'public.assinaturas_apos_mudanca()', 'public.limite_usuarios_valida()',
    'public.limite_integracoes_valida()', 'public.registrar_auditoria(text, uuid, jsonb)',
    'public.plano_da_empresa(uuid)', 'public.uso_integracoes(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_f);
  end loop;

  -- Usuário logado (cada uma confere o papel no banco).
  foreach v_f in array array[
    'public.exigir_super_admin()', 'public.admin_listar_empresas(uuid)', 'public.admin_listar_planos()',
    'public.admin_salvar_plano(text, text, numeric, numeric, integer, integer, integer, text[], public.plano_status)',
    'public.admin_definir_assinatura(uuid, text, public.assinatura_status, public.assinatura_ciclo, timestamptz, timestamptz, text, text, text)',
    'public.admin_suspender_empresa(uuid, text)', 'public.admin_reativar_empresa(uuid, text)',
    'public.admin_listar_auditoria(uuid, integer)', 'public.admin_historico_assinatura(uuid)',
    'public.minha_assinatura()'
  ] loop
    execute format('revoke all on function %s from public, anon', v_f);
    execute format('grant execute on function %s to authenticated', v_f);
  end loop;

  revoke all on function public.registrar_evento_pagamento(text, text, text, text, public.assinatura_status, timestamptz, jsonb)
    from public, anon, authenticated;
  grant execute on function public.registrar_evento_pagamento(text, text, text, text, public.assinatura_status, timestamptz, jsonb)
    to service_role;
end $$;
