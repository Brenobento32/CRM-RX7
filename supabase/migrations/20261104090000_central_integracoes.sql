set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Central de Integrações (LOCAL — não aplicada em produção)
--
--  1. Liberação por empresa: o plano continua sendo a regra (recursos de
--     `planos`); o Super Admin pode abrir EXCEÇÃO por empresa (liberar ou
--     bloquear), auditada. Três cotas SEPARADAS, sem quantidade inventada:
--     fontes de captação (formulários, Respondi, webhook, Google Sheets —
--     coluna `limite_integracoes`, que já existia), números de WhatsApp e
--     funis. Número de WhatsApp NÃO gasta a cota de fontes; Agenda Google
--     depende só do recurso do plano. A chave global de lançamento/homologação
--     (`plataforma_integracoes` + lista de empresas) continua valendo ANTES de
--     tudo: integração não lançada nunca funciona.
--     `integracao_habilitada()` passa a exigir lançamento E permissão — como
--     ela já é chamada pelas funções de conexão, entrada de mensagens e envio,
--     o bloqueio vale no banco, não só na tela.
--  2. Pedido de upgrade feito pelo Administrador da empresa (o Super Admin vê
--     e atende no painel).
--  3. Respostas dinâmicas de formulários/planilhas: TODAS as perguntas além
--     de nome/telefone/e-mail/empresa ficam guardadas por negociação, por
--     envio, sem duplicar e sem sobrescrever envios anteriores.
--  4. WhatsApp em coexistência (app WhatsApp Business + Cloud API):
--     ecos das mensagens enviadas pelo app, histórico compartilhado pela
--     empresa (até 180 dias, se ela aceitar) e contatos do app. O histórico
--     entra nas conversas, mas NÃO cria negociação (só mensagens novas seguem
--     a regra de destino do número).
--
-- Segurança para aplicar: recusa se alguma empresa com integração em uso
-- deixaria de ter permissão com a regra nova (nada é desligado em silêncio).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Regras por empresa
-- ---------------------------------------------------------------------------
create function public.integracoes_central()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['formularios', 'google_sheets', 'whatsapp_oficial', 'meta_conversoes'] $$;

create table public.empresa_integracoes_regras (
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  integracao    text not null check (integracao = any (public.integracoes_central())),
  regra         text not null check (regra in ('liberar', 'bloquear')),
  motivo        text check (motivo is null or length(motivo) <= 300),
  definido_por  uuid references auth.users (id) on delete set null,
  definido_em   timestamptz not null default now(),
  primary key (tenant_id, integracao)
);
alter table public.empresa_integracoes_regras enable row level security;
revoke all on public.empresa_integracoes_regras from public, anon, authenticated;

create function public.empresa_integracoes_regras_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()),
          case tg_op when 'DELETE' then 'integracao_empresa_regra_removida' else 'integracao_empresa_regra_definida' end,
          coalesce(new.tenant_id, old.tenant_id),
          jsonb_strip_nulls(jsonb_build_object('integracao', coalesce(new.integracao, old.integracao),
                                               'antes', case when tg_op <> 'INSERT' then old.regra end,
                                               'depois', case when tg_op <> 'DELETE' then new.regra end,
                                               'motivo', case when tg_op <> 'DELETE' then new.motivo end)));
  return null;
end;
$$;
revoke all on function public.empresa_integracoes_regras_auditar() from public, anon, authenticated;
create trigger empresa_integracoes_regras_auditar after insert or update or delete on public.empresa_integracoes_regras
  for each row execute function public.empresa_integracoes_regras_auditar();

-- Tipo de fonte → integração da Central (meta_lead_ads ainda não lançada: null).
create function public.integracao_da_fonte(p_tipo public.fonte_lead_tipo)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_tipo in ('formulario_rx7', 'webhook', 'respondi') then 'formularios'
              when p_tipo = 'google_sheets' then 'google_sheets'
              when p_tipo = 'whatsapp_cloud' then 'whatsapp_oficial' end
$$;

-- Recurso novo do plano: `formularios` = só captação por formulário (Formulário
-- AVANTE, Respondi, webhook), SEM Google Sheets. Permite vender formulários a um
-- plano (ex.: Starter) sem liberar planilhas. `ingestao_leads` continua sendo a
-- captação completa (formulários + Google Sheets), como nos planos atuais.
create or replace function public.recursos_validos()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads', 'whatsapp', 'relatorios', 'meta_conversoes', 'formularios'] $$;

-- Recursos do plano que liberam cada integração (basta um).
create function public.recursos_da_integracao(p_integracao text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_integracao when 'formularios' then array['ingestao_leads', 'formularios']
                           when 'google_sheets' then array['ingestao_leads']
                           when 'whatsapp_oficial' then array['whatsapp']
                           when 'meta_conversoes' then array['meta_conversoes'] end
$$;

-- O plano inclui? Mesma regra que já valia para as fontes (empresa sem
-- assinatura não é barrada pelo plano) e para Meta Ads (só com plano em
-- teste/ativo; interna sempre).
create function public.integracao_no_plano(p_integracao text, p_tenant uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.tenants;
  v_p public.planos;
begin
  select * into v_t from public.tenants where id = p_tenant;
  if v_t.id is null or v_t.tipo = 'arquivo' then return false; end if;
  if v_t.tipo = 'interno' then return true; end if;
  if p_integracao = 'meta_conversoes' then
    if v_t.status not in ('ativo', 'teste') then return false; end if;
    return coalesce((select 'meta_conversoes' = any (p.recursos)
                       from public.assinaturas a join public.planos p on p.id = a.plano_id
                      where a.tenant_id = v_t.id and a.status in ('teste', 'ativa')), false);
  end if;
  v_p := public.plano_da_empresa(p_tenant);
  if v_p.id is null then return true; end if;
  return coalesce(public.recursos_da_integracao(p_integracao) && v_p.recursos, false);
end;
$$;

-- Regra comercial aprovada: Meta Ads (conversões) não existe para o Starter,
-- nem por exceção do Super Admin. Pro só com liberação individual; Business no plano.
create function public.integracao_vedada_no_plano(p_integracao text, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_integracao = 'meta_conversoes'
     and coalesce((select p.codigo = 'starter' from public.assinaturas a join public.planos p on p.id = a.plano_id
                    where a.tenant_id = p_tenant), false)
$$;
revoke all on function public.integracao_vedada_no_plano(text, uuid) from public, anon, authenticated;

-- Permissão final da empresa (sem olhar o lançamento): exceção do Super Admin > plano.
create function public.integracao_permitida(p_integracao text, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_tenant is null or not (p_integracao = any (public.integracoes_central())) then false
    when exists (select 1 from public.tenants t where t.id = p_tenant and t.tipo = 'arquivo') then false
    when public.integracao_vedada_no_plano(p_integracao, p_tenant) then false
    else coalesce((select r.regra = 'liberar' from public.empresa_integracoes_regras r
                    where r.tenant_id = p_tenant and r.integracao = p_integracao),
                  public.integracao_no_plano(p_integracao, p_tenant))
  end
$$;

-- Lançamento (regra anterior, sem mudança): chave global OU empresa na lista de homologação.
create function public.integracao_lancada(p_tipo text, p_tenant uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case p_tipo when 'google_sheets' then p.google_sheets
                                      when 'whatsapp_oficial' then p.whatsapp_oficial
                                      when 'meta_conversoes' then p.meta_conversoes
                                      when 'formularios' then true end
                     from public.plataforma_integracoes p), p_tipo = 'formularios')
      or (p_tenant is not null
          and exists (select 1 from public.plataforma_integracoes_empresas e where e.tipo = p_tipo and e.tenant_id = p_tenant));
$$;

-- Habilitada = lançada E permitida para a empresa (plano ou exceção).
create or replace function public.integracao_habilitada(p_tipo text, p_tenant uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.integracao_lancada(p_tipo, p_tenant)
     and (p_tenant is null or public.integracao_permitida(p_tipo, p_tenant));
$$;

-- Mensagem certa para cada caso: não lançada (RX030) × fora do plano/bloqueada (RX003).
create or replace function public.exigir_integracao_habilitada(p_tipo text, p_tenant uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.integracao_lancada(p_tipo, p_tenant) then
    raise exception 'Esta integração ainda não foi liberada na plataforma.' using errcode = 'RX030';
  end if;
  if p_tenant is not null and not public.integracao_permitida(p_tipo, p_tenant) then
    raise exception 'Esta integração não faz parte do plano desta empresa (ou foi bloqueada pelo Super Admin).' using errcode = 'RX003';
  end if;
end;
$$;

-- Meta Ads: plano Business por padrão; outro plano só com liberação do Super Admin.
create or replace function public.capi_exigir()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
begin
  perform public.exigir_integracao_habilitada('meta_conversoes', v_tenant);
  if not public.meta_conversoes_elegivel(v_tenant) then
    raise exception 'Conversões do CRM para Meta Ads fazem parte do plano Business (ou de uma liberação do Super Admin).' using errcode = 'RX003';
  end if;
  return v_tenant;
end;
$$;

-- Meta Ads: a elegibilidade passa a respeitar a exceção do Super Admin.
create or replace function public.meta_conversoes_elegivel(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.integracao_permitida('meta_conversoes', p_tenant)
         and exists (select 1 from public.tenants t where t.id = p_tenant and t.status in ('ativo', 'teste'));
$$;

-- ---------------------------------------------------------------------------
-- 5b. Limites reais (ausência de limite NÃO é autorização ilimitada)
--
-- Três cotas independentes, cada uma com sua coluna no plano e sua contagem:
--   fontes            planos.limite_integracoes (já existia)  uso_fontes()
--   numeros_whatsapp  planos.limite_numeros_whatsapp (novo)    uso_numeros_whatsapp()
--   funis             planos.limite_funis (novo)               funis ativos
-- Nulo = "a definir": nenhuma conexão NOVA até o Super Admin definir no plano ou
-- na empresa. O que já está em uso é preservado. Empresa interna (Rio X7)
-- segue sem limite de plano, como antes.
-- ---------------------------------------------------------------------------
alter table public.planos
  add column limite_numeros_whatsapp integer check (limite_numeros_whatsapp is null or limite_numeros_whatsapp >= 0),
  add column limite_funis integer check (limite_funis is null or limite_funis >= 1);

comment on column public.planos.limite_integracoes is
  'Fontes de captação ativas (Formulário AVANTE, Respondi, webhook, Google Sheets, credenciais de ingestão). Não inclui números de WhatsApp (limite_numeros_whatsapp) nem funis (limite_funis). Nulo = a definir: bloqueia fonte nova.';
comment on column public.planos.limite_numeros_whatsapp is
  'Números de WhatsApp conectados (API oficial e app existente somados). Nulo = a definir: bloqueia número novo.';
comment on column public.planos.limite_funis is
  'Funis ativos (o primeiro é sempre permitido). Nulo = a definir: bloqueia o segundo funil.';

-- Fontes de captação em uso. Número de WhatsApp (fonte `whatsapp_cloud`) fica de
-- fora — ele conta só em `uso_numeros_whatsapp`. Agenda Google também: não é
-- fonte de lead (continua valendo só o recurso `agenda_google` do plano).
create function public.uso_fontes(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.ingestao_credenciais c where c.tenant_id = p_tenant and c.ativo)::integer
       + (select count(*) from public.fontes_leads f
           where f.tenant_id = p_tenant and f.status = 'ativa' and f.tipo <> 'whatsapp_cloud')::integer;
$$;
revoke all on function public.uso_fontes(uuid) from public, anon, authenticated;

-- Nome antigo (telas de assinatura e do Super Admin): passa a ser a mesma conta de fontes.
create or replace function public.uso_integracoes(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select public.uso_fontes(p_tenant) $$;

create table public.empresa_limites (
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  recurso       text not null check (recurso in ('fontes', 'numeros_whatsapp', 'funis')),
  limite        integer not null check (limite between 0 and 1000),
  motivo        text not null check (length(btrim(motivo)) between 2 and 300),
  definido_por  uuid references auth.users (id) on delete set null,
  definido_em   timestamptz not null default now(),
  primary key (tenant_id, recurso)
);
alter table public.empresa_limites enable row level security;
revoke all on public.empresa_limites from public, anon, authenticated;

create function public.empresa_limites_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), case tg_op when 'DELETE' then 'limite_empresa_removido' else 'limite_empresa_definido' end,
          coalesce(new.tenant_id, old.tenant_id),
          jsonb_strip_nulls(jsonb_build_object('recurso', coalesce(new.recurso, old.recurso),
                                               'antes', case when tg_op <> 'INSERT' then old.limite end,
                                               'depois', case when tg_op <> 'DELETE' then new.limite end,
                                               'motivo', case when tg_op <> 'DELETE' then new.motivo end)));
  return null;
end;
$$;
revoke all on function public.empresa_limites_auditar() from public, anon, authenticated;
create trigger empresa_limites_auditar after insert or update or delete on public.empresa_limites
  for each row execute function public.empresa_limites_auditar();

-- (definido, limite): interna = (true, null = sem limite); exceção da empresa; plano; senão (false, null) = a definir.
create function public.limite_efetivo(p_tenant uuid, p_recurso text)
returns table (definido boolean, limite integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo public.tenant_tipo;
  v_l    integer;
  v_p    public.planos;
begin
  select t.tipo into v_tipo from public.tenants t where t.id = p_tenant;
  if v_tipo = 'interno' then return query select true, null::integer; return; end if;
  select l.limite into v_l from public.empresa_limites l where l.tenant_id = p_tenant and l.recurso = p_recurso;
  if found then return query select true, v_l; return; end if;
  v_p := public.plano_da_empresa(p_tenant);
  v_l := case p_recurso when 'fontes' then v_p.limite_integracoes when 'numeros_whatsapp' then v_p.limite_numeros_whatsapp
                       when 'funis' then v_p.limite_funis end;
  return query select v_l is not null, v_l;
end;
$$;
revoke all on function public.limite_efetivo(uuid, text) from public, anon, authenticated;

-- Números em uso: API oficial e app existente (coexistência) contam juntos — os dois cartões, um limite.
create function public.uso_numeros_whatsapp(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.whatsapp_numeros n where n.tenant_id = p_tenant and n.situacao <> 'desconectado')::integer;
$$;
revoke all on function public.uso_numeros_whatsapp(uuid) from public, anon, authenticated;

create function public.exigir_limite(p_tenant uuid, p_recurso text, p_uso integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_nome text := case p_recurso when 'fontes' then 'fontes de captação' when 'funis' then 'funis' else 'números de WhatsApp' end;
begin
  select * into v from public.limite_efetivo(p_tenant, p_recurso);
  if not v.definido then
    raise exception 'O limite de % do plano desta empresa ainda não foi definido. Fale com a Rio X7.', v_nome using errcode = 'RX002';
  end if;
  if v.limite is not null and p_uso >= v.limite then
    raise exception 'Limite de % do plano atingido (%).', v_nome, v.limite using errcode = 'RX002';
  end if;
end;
$$;
revoke all on function public.exigir_limite(uuid, text, integer) from public, anon, authenticated;

-- Funis: só funil NOVO (ou reativado) entra na conta; os que existem continuam. O primeiro é sempre permitido.
create function public.funis_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uso integer;
begin
  if new.ativo and (tg_op = 'INSERT' or not old.ativo) then
    perform 1 from public.tenants where id = new.tenant_id for update;
    select count(*) into v_uso from public.funis f where f.tenant_id = new.tenant_id and f.ativo and f.id <> new.id;
    if v_uso > 0 then
      perform public.exigir_limite(new.tenant_id, 'funis', v_uso);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.funis_limite() from public, anon, authenticated;
create trigger zz_funis_limite before insert or update of ativo on public.funis
  for each row execute function public.funis_limite();

-- ---------------------------------------------------------------------------
-- 2. Pedidos de upgrade
-- ---------------------------------------------------------------------------
create table public.integracoes_solicitacoes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  integracao      text not null check (integracao = any (public.integracoes_central())),
  solicitado_por  uuid references auth.users (id) on delete set null,
  solicitado_em   timestamptz not null default now(),
  situacao        text not null default 'aberta' check (situacao in ('aberta', 'atendida', 'recusada')),
  resolvido_por   uuid references auth.users (id) on delete set null,
  resolvido_em    timestamptz
);
create unique index integracoes_solicitacoes_aberta on public.integracoes_solicitacoes (tenant_id, integracao) where situacao = 'aberta';
alter table public.integracoes_solicitacoes enable row level security;
revoke all on public.integracoes_solicitacoes from public, anon, authenticated;

create function public.solicitar_integracao(p_integracao text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
begin
  if not (p_integracao = any (public.integracoes_central())) then
    raise exception 'Integração desconhecida.' using errcode = '22023';
  end if;
  if not public.integracao_lancada(p_integracao, v_tenant) then
    raise exception 'Esta integração ainda não foi lançada.' using errcode = 'RX030';
  end if;
  if public.integracao_permitida(p_integracao, v_tenant) then
    return false; -- já liberada: nada a pedir
  end if;
  insert into public.integracoes_solicitacoes (tenant_id, integracao, solicitado_por)
  values (v_tenant, p_integracao, (select auth.uid()))
  on conflict (tenant_id, integracao) where situacao = 'aberta' do nothing;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'integracao_upgrade_solicitado', v_tenant, jsonb_build_object('integracao', p_integracao));
  return true;
end;
$$;
revoke all on function public.solicitar_integracao(text) from public, anon;
grant execute on function public.solicitar_integracao(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Leitura da Central (empresa da aba) e do painel do Super Admin
-- ---------------------------------------------------------------------------
create function public.uso_por_integracao(p_tenant uuid)
returns table (integracao text, em_uso integer, com_erro integer, pendentes integer, ultima_atividade timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select 'formularios',
         count(*) filter (where f.status = 'ativa')::integer,
         count(*) filter (where f.status = 'ativa' and f.ultimo_erro is not null and f.ultimo_erro_em > coalesce(f.ultimo_lead_em, '-infinity'))::integer,
         0, max(f.ultimo_lead_em)
    from public.fontes_leads f where f.tenant_id = p_tenant and f.tipo in ('formulario_rx7', 'webhook', 'respondi')
  union all
  select 'google_sheets',
         count(*) filter (where f.status = 'ativa')::integer,
         count(*) filter (where f.status = 'ativa' and g.situacao in ('erro', 'erro_autorizacao'))::integer,
         count(*) filter (where f.status = 'ativa' and g.situacao = 'aguardando')::integer,
         greatest(max(g.ultimo_sucesso_em), max(f.ultimo_lead_em))
    from public.fontes_leads f left join public.fontes_google_sheets g on g.fonte_id = f.id
   where f.tenant_id = p_tenant and f.tipo = 'google_sheets'
  union all
  select 'whatsapp_oficial',
         count(*) filter (where n.situacao <> 'desconectado')::integer,
         count(*) filter (where n.situacao <> 'desconectado' and (n.bloqueado_por_cobranca or n.ultimo_erro_em > now() - interval '1 day'))::integer,
         count(*) filter (where n.situacao = 'pendente_registro')::integer,
         max(n.ultimo_evento_em)
    from public.whatsapp_numeros n where n.tenant_id = p_tenant
  union all
  select 'meta_conversoes',
         count(*) filter (where c.situacao <> 'desconectada')::integer,
         count(*) filter (where c.situacao = 'erro_autorizacao')::integer,
         count(*) filter (where c.situacao = 'configurando')::integer,
         max(c.ultimo_envio_em)
    from public.meta_conversoes_conexoes c where c.tenant_id = p_tenant;
$$;
revoke all on function public.uso_por_integracao(uuid) from public, anon, authenticated;

create function public.central_integracoes_de(p_tenant uuid)
returns table (integracao text, lancada boolean, no_plano boolean, regra text, permitida boolean,
               em_uso integer, com_erro integer, pendentes integer, ultima_atividade timestamptz, solicitada_em timestamptz,
               plano_nome text, limite_fontes integer, uso_fontes integer,
               limite_fontes_definido boolean, limite_numeros integer, limite_numeros_definido boolean, uso_numeros integer)
language sql
stable
security definer
set search_path = ''
as $$
  select i.integracao,
         public.integracao_lancada(i.integracao, p_tenant),
         public.integracao_no_plano(i.integracao, p_tenant),
         r.regra,
         public.integracao_permitida(i.integracao, p_tenant),
         coalesce(u.em_uso, 0), coalesce(u.com_erro, 0), coalesce(u.pendentes, 0), u.ultima_atividade,
         (select s.solicitado_em from public.integracoes_solicitacoes s
           where s.tenant_id = p_tenant and s.integracao = i.integracao and s.situacao = 'aberta'),
         p.nome, li.limite, public.uso_fontes(p_tenant),
         li.definido, ln.limite, ln.definido, public.uso_numeros_whatsapp(p_tenant)
    from unnest(public.integracoes_central()) with ordinality as i (integracao, ordem)
    left join public.empresa_integracoes_regras r on r.tenant_id = p_tenant and r.integracao = i.integracao
    left join public.uso_por_integracao(p_tenant) u on u.integracao = i.integracao
    left join lateral (select pl.* from public.assinaturas a join public.planos pl on pl.id = a.plano_id where a.tenant_id = p_tenant) p on true
    cross join lateral public.limite_efetivo(p_tenant, 'fontes') li
    cross join lateral public.limite_efetivo(p_tenant, 'numeros_whatsapp') ln
   order by i.ordem;
$$;
revoke all on function public.central_integracoes_de(uuid) from public, anon, authenticated;

-- Administrador (ou Gerente) da empresa da aba.
create function public.central_integracoes_empresa()
returns table (integracao text, lancada boolean, no_plano boolean, regra text, permitida boolean,
               em_uso integer, com_erro integer, pendentes integer, ultima_atividade timestamptz, solicitada_em timestamptz,
               plano_nome text, limite_fontes integer, uso_fontes integer,
               limite_fontes_definido boolean, limite_numeros integer, limite_numeros_definido boolean, uso_numeros integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa', 'gerente']::public.tenant_papel[]) then
    raise exception 'Somente o Administrador da empresa vê as integrações.' using errcode = '42501';
  end if;
  return query select * from public.central_integracoes_de(v_tenant);
end;
$$;
revoke all on function public.central_integracoes_empresa() from public, anon;
grant execute on function public.central_integracoes_empresa() to authenticated;

-- Super Admin: mesma visão de qualquer empresa (sem precisar abrir o CRM dela).
create function public.admin_central_integracoes(p_tenant uuid)
returns table (integracao text, lancada boolean, no_plano boolean, regra text, permitida boolean,
               em_uso integer, com_erro integer, pendentes integer, ultima_atividade timestamptz, solicitada_em timestamptz,
               plano_nome text, limite_fontes integer, uso_fontes integer,
               limite_fontes_definido boolean, limite_numeros integer, limite_numeros_definido boolean, uso_numeros integer, motivo text, definido_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
    select c.*, r.motivo, r.definido_em
      from public.central_integracoes_de(p_tenant) c
      left join public.empresa_integracoes_regras r on r.tenant_id = p_tenant and r.integracao = c.integracao;
end;
$$;
revoke all on function public.admin_central_integracoes(uuid) from public, anon;
grant execute on function public.admin_central_integracoes(uuid) to authenticated;

-- 'plano' remove a exceção (volta à regra do plano). Liberar atende os pedidos abertos.
create function public.admin_definir_integracao_empresa(p_tenant uuid, p_integracao text, p_regra text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if not (p_integracao = any (public.integracoes_central())) or p_regra not in ('plano', 'liberar', 'bloquear') then
    raise exception 'Integração ou regra inválida.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.tipo <> 'arquivo') then
    raise exception 'Empresa inexistente ou arquivada.' using errcode = 'P0002';
  end if;
  if p_regra <> 'plano' and nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo da exceção.' using errcode = '22023';
  end if;
  if p_regra = 'liberar' and public.integracao_vedada_no_plano(p_integracao, p_tenant) then
    raise exception 'Meta Ads (conversões) não está disponível no plano Starter, nem por exceção.' using errcode = 'RX003';
  end if;
  if p_regra = 'plano' then
    delete from public.empresa_integracoes_regras where tenant_id = p_tenant and integracao = p_integracao;
  else
    insert into public.empresa_integracoes_regras (tenant_id, integracao, regra, motivo, definido_por)
    values (p_tenant, p_integracao, p_regra, left(btrim(p_motivo), 300), (select auth.uid()))
    on conflict (tenant_id, integracao) do update
      set regra = excluded.regra, motivo = excluded.motivo, definido_por = excluded.definido_por, definido_em = now();
  end if;
  update public.integracoes_solicitacoes
     set situacao = case when public.integracao_permitida(p_integracao, p_tenant) then 'atendida' else situacao end,
         resolvido_por = (select auth.uid()), resolvido_em = now()
   where tenant_id = p_tenant and integracao = p_integracao and situacao = 'aberta'
     and public.integracao_permitida(p_integracao, p_tenant);
end;
$$;
revoke all on function public.admin_definir_integracao_empresa(uuid, text, text, text) from public, anon;
grant execute on function public.admin_definir_integracao_empresa(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Respostas dinâmicas (formulários e planilhas)
-- ---------------------------------------------------------------------------
create table public.negociacao_respostas (
  id             bigserial primary key,
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  negociacao_id  uuid not null references public.negociacoes (id) on delete cascade,
  fonte_id       uuid references public.fontes_leads (id) on delete set null,
  envio          text not null check (length(envio) between 1 and 300),  -- linha da planilha / envio do formulário
  chave          text not null check (length(chave) between 1 and 140),  -- pergunta normalizada (+ _n se repetida)
  pergunta       text not null check (length(pergunta) between 1 and 500),
  resposta       text not null check (length(resposta) between 1 and 5000),
  ordem          integer not null default 0,
  recebida_em    timestamptz not null default now(),
  unique (negociacao_id, envio, chave)
);
create index negociacao_respostas_neg on public.negociacao_respostas (negociacao_id, recebida_em desc, ordem);
alter table public.negociacao_respostas enable row level security;
revoke all on public.negociacao_respostas from public, anon, authenticated;
grant select on public.negociacao_respostas to authenticated;
create policy negociacao_respostas_ler on public.negociacao_respostas for select to authenticated
  using (tenant_id = (select public.tenant_atual())
         and (public.is_gerente()
              or exists (select 1 from public.negociacoes n
                          where n.id = negociacao_respostas.negociacao_id and public.pode_ver_etapa(n.funil_id, n.etapa_id))));

create function public.normalizar_pergunta(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(lower(translate(coalesce(p, ''),
           'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
           'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', '_', 'g'), '_'), 120), '')
$$;

-- Itens: [{pergunta, resposta}] na ordem do formulário. Vazios são ignorados;
-- pergunta repetida no mesmo envio vira chave_2, chave_3…; o mesmo envio
-- reprocessado atualiza (não duplica); outro envio fica guardado à parte.
create function public.registrar_respostas_lead(p_tenant uuid, p_negociacao uuid, p_fonte uuid, p_envio text, p_respostas jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
begin
  if p_negociacao is null or p_respostas is null or jsonb_typeof(p_respostas) <> 'array' or nullif(btrim(coalesce(p_envio, '')), '') is null then
    return 0;
  end if;
  with itens as (
    select left(btrim(e.value ->> 'pergunta'), 500) as pergunta,
           left(btrim(e.value ->> 'resposta'), 5000) as resposta,
           e.ordinality::integer as ordem
      from jsonb_array_elements(p_respostas) with ordinality as e (value, ordinality)
     where jsonb_typeof(e.value) = 'object' and e.ordinality <= 200
  ), validos as (
    select i.*, public.normalizar_pergunta(i.pergunta) as base
      from itens i
     where nullif(i.pergunta, '') is not null and nullif(i.resposta, '') is not null
  ), numerados as (
    select v.*, row_number() over (partition by v.base order by v.ordem) as n from validos v where v.base is not null
  ), gravados as (
    insert into public.negociacao_respostas (tenant_id, negociacao_id, fonte_id, envio, chave, pergunta, resposta, ordem)
    select p_tenant, p_negociacao, p_fonte, left(p_envio, 300),
           case when x.n = 1 then x.base else left(x.base, 130) || '_' || x.n end,
           x.pergunta, x.resposta, x.ordem
      from numerados x
    on conflict (negociacao_id, envio, chave) do update
      set resposta = excluded.resposta, pergunta = excluded.pergunta, ordem = excluded.ordem
    returning 1
  )
  select count(*) into v_total from gravados;
  return v_total;
end;
$$;
revoke all on function public.registrar_respostas_lead(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Planilhas: mesma função de antes + respostas (coluna `respostas` de cada linha).
create or replace function public.sheets_processar_linhas(p_fonte uuid, p_linhas jsonb, p_primeira boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g        public.fontes_google_sheets;
  v_item     jsonb;
  v_chave    text;
  v_visto    public.fontes_google_sheets_linhas;
  v_r        record;
  v_codigo   text;
  v_msg      text;
  v_import   integer := 0;
  v_novas    integer := 0;
  v_exist    integer := 0;
  v_ignor    integer := 0;
  v_invalid  integer := 0;
  v_erros    integer := 0;
  v_baseline boolean;
  v_lead     text;
begin
  select * into v_g from public.fontes_google_sheets where fonte_id = p_fonte;
  if v_g.fonte_id is null then raise exception 'Planilha inexistente.' using errcode = 'P0002'; end if;
  v_baseline := coalesce(p_primeira, false) and not v_g.importar_existentes;

  for v_item in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_chave := left(btrim(coalesce(v_item ->> 'chave', '')), 200);
    continue when v_chave = '';
    select * into v_visto from public.fontes_google_sheets_linhas where fonte_id = p_fonte and chave = v_chave;
    continue when v_visto.fonte_id is not null and (v_visto.resultado <> 'erro' or v_visto.tentativas >= 5);

    if v_baseline then
      insert into public.fontes_google_sheets_linhas (fonte_id, chave, resultado, linha)
      values (p_fonte, v_chave, 'ignorada_inicial', (v_item ->> 'linha')::integer)
      on conflict (fonte_id, chave) do nothing;
      v_ignor := v_ignor + 1;
      continue;
    end if;

    -- Só um ID de lead da Meta com formato válido (15 a 17 dígitos); nunca inventado.
    v_lead := nullif(regexp_replace(coalesce(v_item ->> 'meta_lead_id', ''), '\D', '', 'g'), '');
    if v_lead !~ '^[0-9]{15,17}$' then v_lead := null; end if;

    begin
      select * into v_r from public.ingerir_lead_integracao(
        p_fonte, 'gs:' || v_chave, v_item ->> 'nome', v_item ->> 'telefone', v_item ->> 'email', v_item ->> 'empresa',
        jsonb_strip_nulls(jsonb_build_object('planilha', v_g.planilha_nome, 'aba', v_g.aba_nome, 'meta_lead_id', v_lead)));
      perform public.registrar_respostas_lead(v_g.tenant_id, v_r.negociacao_id, p_fonte, 'gs:' || v_chave, v_item -> 'respostas');
      insert into public.fontes_google_sheets_linhas (fonte_id, chave, resultado, negociacao_id, linha)
      values (p_fonte, v_chave, case when v_r.resultado in ('importada', 'nova_oportunidade') then 'importada' else 'contato_existente' end,
              v_r.negociacao_id, (v_item ->> 'linha')::integer)
      on conflict (fonte_id, chave) do update
        set resultado = excluded.resultado, negociacao_id = excluded.negociacao_id, ultimo_erro = null, ultima_vez_em = now();
      if v_r.resultado = 'importada' then v_import := v_import + 1;
      elsif v_r.resultado = 'nova_oportunidade' then v_novas := v_novas + 1;
      else v_exist := v_exist + 1; end if;
    exception when others then
      get stacked diagnostics v_codigo = returned_sqlstate, v_msg = message_text;
      insert into public.fontes_google_sheets_linhas (fonte_id, chave, resultado, linha, ultimo_erro)
      values (p_fonte, v_chave, case when v_codigo = '22023' then 'invalida' else 'erro' end, (v_item ->> 'linha')::integer, left(v_msg, 300))
      on conflict (fonte_id, chave) do update
        set resultado = excluded.resultado, ultimo_erro = excluded.ultimo_erro, ultima_vez_em = now(),
            tentativas = public.fontes_google_sheets_linhas.tentativas + 1;
      insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, erro_codigo, erro_mensagem)
      values (v_g.tenant_id, p_fonte, left('gs:' || v_chave, 300), 'erro', v_codigo, left(v_msg, 300));
      if v_codigo = '22023' then v_invalid := v_invalid + 1; else v_erros := v_erros + 1; end if;
    end;
  end loop;

  update public.fontes_google_sheets
     set total_importados = total_importados + v_import + v_novas, total_existentes = total_existentes + v_exist,
         total_erros = total_erros + v_erros + v_invalid
   where fonte_id = p_fonte;
  return jsonb_build_object('importadas', v_import + v_novas, 'novas_oportunidades', v_novas, 'existentes', v_exist,
                            'ignoradas_inicio', v_ignor, 'invalidas', v_invalid, 'erros', v_erros);
end;
$$;

-- Formulários por token (Respondi, webhook, Formulário AVANTE): respostas que
-- não casam com uma pergunta cadastrada deixavam de ser guardadas. Agora vão
-- para negociacao_respostas, sem mudar o resto do núcleo.
create or replace function public.ingerir_lead_nucleo(
  p_tenant uuid, p_origem public.origem_negociacao, p_external_id text,
  p_funil uuid, p_etapa uuid, p_responsavel uuid, p_nicho uuid, p_formulario uuid,
  p_nome text, p_telefone text, p_email text, p_empresa text, p_instagram text,
  p_respostas jsonb, p_atribuicao jsonb)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome          text := public.normalizar_texto(p_nome, 200);
  v_tel           text := public.normalizar_telefone(p_telefone);
  v_email         text := public.normalizar_email(p_email);
  v_empresa       text := public.normalizar_texto(p_empresa, 200);
  v_insta         text := public.normalizar_texto(p_instagram, 200);
  v_ext           text := public.normalizar_texto(p_external_id, 300);
  v_cliente_id    uuid;
  v_negociacao_id uuid;
  v_criado        boolean := false;
  v_item          jsonb;
  v_pergunta_id   uuid;
  v_resposta      text;
  v_soltas        jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.tenants t
                  where t.id = p_tenant and t.tipo <> 'arquivo' and t.status in ('ativo', 'teste')) then
    raise exception 'Empresa indisponível para receber leads.' using errcode = '42501';
  end if;
  if v_ext is null then
    raise exception 'external_id é obrigatório.' using errcode = '22023';
  end if;
  if v_nome is null then
    v_nome := coalesce(v_tel, v_email);
  end if;
  if v_tel is null and v_email is null then
    raise exception 'Informe ao menos telefone ou e-mail válidos.' using errcode = '22023';
  end if;
  if p_atribuicao is not null and jsonb_typeof(p_atribuicao) <> 'object' then
    raise exception 'atribuicao precisa ser um objeto JSON.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.etapas_funil e
                  where e.id = p_etapa and e.funil_id = p_funil and e.tenant_id = p_tenant and e.ativo and e.tipo = 'aberta') then
    raise exception 'Etapa de entrada inválida.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':lead:' || p_origem || ':' || v_ext, 0));

  select n.cliente_id, n.id into v_cliente_id, v_negociacao_id
    from public.negociacoes n
   where n.tenant_id = p_tenant and n.origem = p_origem and n.external_id = v_ext
     for update;

  if v_negociacao_id is not null then
    update public.clientes
       set nome = coalesce(v_nome, nome), empresa = coalesce(v_empresa, empresa), telefone = coalesce(v_tel, telefone),
           email = coalesce(v_email, email), instagram = coalesce(v_insta, instagram)
     where id = v_cliente_id and tenant_id = p_tenant and deleted_at is null;
    update public.negociacoes
       set atribuicao = coalesce(p_atribuicao, atribuicao)
     where id = v_negociacao_id and tenant_id = p_tenant;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':contato:' ||
      coalesce(v_tel, '') || '|' || coalesce(v_email, ''), 0));

    select c.id into v_cliente_id
      from public.clientes c
     where c.tenant_id = p_tenant
       and c.deleted_at is null
       and ((v_tel is not null and (c.telefone = v_tel or c.whatsapp = v_tel))
            or (v_email is not null and lower(c.email) = v_email))
     order by c.created_at
     limit 1
     for update;

    if v_cliente_id is null then
      insert into public.clientes (tenant_id, tipo_cliente, nome, empresa, telefone, whatsapp, email, instagram, owner_id)
      values (p_tenant, 'pessoa_fisica', v_nome, v_empresa, v_tel,
              case when p_origem = 'whatsapp' then v_tel end, v_email, v_insta, p_responsavel)
      returning id into v_cliente_id;
    end if;

    insert into public.negociacoes (tenant_id, cliente_id, owner_id, etapa_id, origem, nicho_id, formulario_id, external_id, atribuicao)
    values (p_tenant, v_cliente_id, null, p_etapa, p_origem, p_nicho, p_formulario, v_ext, p_atribuicao)
    returning id into v_negociacao_id;
    v_criado := true;
  end if;

  for v_item in select * from jsonb_array_elements(case when jsonb_typeof(p_respostas) = 'array' then p_respostas else '[]'::jsonb end) loop
    v_pergunta_id := null;
    v_resposta := left(v_item ->> 'resposta', 5000);
    continue when v_resposta is null or btrim(v_resposta) = '';
    if p_formulario is not null then
      select p.id into v_pergunta_id
        from public.perguntas p
       where p.formulario_id = p_formulario and p.tenant_id = p_tenant and p.ativo
         and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');
    end if;
    if v_pergunta_id is null then
      v_soltas := v_soltas || jsonb_build_array(jsonb_build_object('pergunta', v_item ->> 'pergunta_externa', 'resposta', v_resposta));
      continue;
    end if;

    insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
    select v_negociacao_id, v_pergunta_id,
           case when p.tipo = 'texto_livre' then v_resposta end,
           case when p.tipo <> 'texto_livre' then v_resposta end
      from public.perguntas p
     where p.id = v_pergunta_id
    on conflict (negociacao_id, pergunta_id) do update
      set resposta_texto = excluded.resposta_texto, resposta_opcao = excluded.resposta_opcao;
  end loop;
  perform public.registrar_respostas_lead(p_tenant, v_negociacao_id, null, v_ext, v_soltas);

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;
revoke all on function public.ingerir_lead_nucleo(uuid, public.origem_negociacao, text, uuid, uuid, uuid, uuid, uuid,
  text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;

-- Resumo para o cartão do funil e lista completa para a página do lead (respeita a RLS).
create function public.respostas_da_negociacao(p_negociacao uuid)
returns table (pergunta text, resposta text, envio text, recebida_em timestamptz, origem text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.pergunta, r.resposta, r.envio, r.recebida_em, coalesce(f.nome, 'Formulário')
    from public.negociacao_respostas r left join public.fontes_leads f on f.id = r.fonte_id
   where r.negociacao_id = p_negociacao
   order by r.recebida_em desc, r.envio, r.ordem;
$$;
grant execute on function public.respostas_da_negociacao(uuid) to authenticated;

-- Cartão do funil: até 2 respostas do envio mais recente de cada negociação (RLS vale: security invoker).
create function public.resumo_respostas_negociacoes(p_ids uuid[])
returns table (negociacao_id uuid, pergunta text, resposta text)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.negociacao_id, x.pergunta, x.resposta
    from (select r.negociacao_id, r.pergunta, r.resposta, r.ordem,
                 dense_rank() over (partition by r.negociacao_id order by r.recebida_em desc, r.envio) as envio_n,
                 row_number() over (partition by r.negociacao_id, r.envio order by r.ordem) as n
            from public.negociacao_respostas r
           where r.negociacao_id = any (p_ids[1:1000])) x
   where x.envio_n = 1 and x.n <= 2
   order by x.negociacao_id, x.ordem;
$$;
grant execute on function public.resumo_respostas_negociacoes(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. WhatsApp em coexistência: ecos, histórico e contatos do app
-- ---------------------------------------------------------------------------
alter table public.mensagens
  add column origem_app text check (origem_app is null or origem_app in ('eco_app', 'historico'));

create table public.whatsapp_sincronizacoes (
  numero_id      uuid not null references public.whatsapp_numeros (id) on delete cascade,
  tipo           text not null check (tipo in ('contatos', 'historico')),
  situacao       text not null default 'pedida' check (situacao in ('pedida', 'recebendo', 'concluida', 'recusada', 'erro')),
  request_id     text check (request_id is null or length(request_id) <= 120),
  fase           integer,
  progresso      integer check (progresso is null or progresso between 0 and 100),
  mensagens      integer not null default 0,
  erro           text check (erro is null or length(erro) <= 300),
  pedida_em      timestamptz not null default now(),
  atualizada_em  timestamptz not null default now(),
  primary key (numero_id, tipo)
);
alter table public.whatsapp_sincronizacoes enable row level security;
revoke all on public.whatsapp_sincronizacoes from public, anon, authenticated;

create table public.whatsapp_contatos_app (
  numero_id     uuid not null references public.whatsapp_numeros (id) on delete cascade,
  telefone      text not null,
  nome          text check (nome is null or length(nome) <= 200),
  removido_em   timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (numero_id, telefone)
);
alter table public.whatsapp_contatos_app enable row level security;
revoke all on public.whatsapp_contatos_app from public, anon, authenticated;

-- Pedido de sincronização feito pelo servidor logo após a conexão (a Meta dá 24 h, uma vez por tipo).
create function public.whatsapp_sincronizacao_registrar(p_numero uuid, p_tipo text, p_ok boolean, p_request_id text, p_erro text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.whatsapp_sincronizacoes (numero_id, tipo, situacao, request_id, erro)
  values (p_numero, p_tipo, case when p_ok then 'pedida' else 'erro' end, left(p_request_id, 120), left(p_erro, 300))
  on conflict (numero_id, tipo) do update
    set situacao = excluded.situacao, request_id = coalesce(excluded.request_id, public.whatsapp_sincronizacoes.request_id),
        erro = excluded.erro, atualizada_em = now();
$$;
revoke all on function public.whatsapp_sincronizacao_registrar(uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_sincronizacao_registrar(uuid, text, boolean, text, text) to service_role;

-- Conversa do número com o telefone (cria se preciso). Vincula cliente da MESMA empresa, sem criar negociação.
create function public.whatsapp_conversa_do_contato(p_numero public.whatsapp_numeros, p_tel text, p_nome text, p_em timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
  v_cli  uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_numero.id::text || ':' || p_tel, 0));
  select c.id into v_conv from public.conversas c where c.whatsapp_numero_id = p_numero.id and c.telefone = p_tel;
  if v_conv is null then
    select c.id into v_cli from public.clientes c
     where c.tenant_id = p_numero.tenant_id and c.deleted_at is null and (c.telefone = p_tel or c.whatsapp = p_tel)
     order by c.created_at limit 1;
    insert into public.conversas (tenant_id, telefone, whatsapp_numero_id, nome_contato, cliente_id, ultima_mensagem_em, escopo)
    values (p_numero.tenant_id, p_tel, p_numero.id,
            left(coalesce(p_nome, (select a.nome from public.whatsapp_contatos_app a where a.numero_id = p_numero.id and a.telefone = p_tel)), 200),
            v_cli, coalesce(p_em, now()), 'rx7')
    returning id into v_conv;
  end if;
  return v_conv;
end;
$$;
revoke all on function public.whatsapp_conversa_do_contato(public.whatsapp_numeros, text, text, timestamptz) from public, anon, authenticated, service_role;

create function public.status_historico_whatsapp(p text)
returns public.status_mensagem
language sql
immutable
set search_path = ''
as $$
  select case upper(coalesce(p, '')) when 'READ' then 'lido' when 'PLAYED' then 'lido' when 'DELIVERED' then 'entregue'
                                     when 'ERROR' then 'falhou' when 'PENDING' then 'pendente' else 'enviado' end::public.status_mensagem
$$;

-- Itens: [{id, telefone, da_empresa, tipo, texto, em, status}] — eco (origem 'eco_app') ou histórico ('historico').
-- Idempotente pelo ID da Meta. Não conta na franquia do AVANTE (não saiu pelo AVANTE) e não cria negociação.
create function public.whatsapp_registrar_mensagens_app(p_phone_number_id text, p_origem text, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n     public.whatsapp_numeros;
  v_item  jsonb;
  v_tel   text;
  v_conv  uuid;
  v_em    timestamptz;
  v_tipo  text;
  v_msg   uuid;
  v_novas integer := 0;
  v_dup   integer := 0;
  v_conteudo text;
  v_saida boolean;
begin
  if p_origem not in ('eco_app', 'historico') then raise exception 'Origem inválida.' using errcode = '22023'; end if;
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null then return jsonb_build_object('ignorado', 'numero_desconhecido'); end if;
  if v_n.situacao = 'desconectado' then return jsonb_build_object('ignorado', 'numero_desconectado'); end if;
  if v_n.modo_conexao <> 'coexistencia' then return jsonb_build_object('ignorado', 'nao_coexistencia'); end if;
  if not public.integracao_habilitada('whatsapp_oficial', v_n.tenant_id) then return jsonb_build_object('ignorado', 'whatsapp_desativado'); end if;
  update public.whatsapp_numeros set ultimo_evento_em = now() where id = v_n.id;

  for v_item in select * from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) loop
    v_tel := public.normalizar_telefone(v_item ->> 'telefone');
    continue when v_tel is null or nullif(v_item ->> 'id', '') is null;
    v_em := coalesce(nullif(v_item ->> 'em', '')::timestamptz, now());
    v_tipo := coalesce(nullif(v_item ->> 'tipo', ''), 'text');
    v_saida := coalesce((v_item ->> 'da_empresa')::boolean, p_origem = 'eco_app');
    v_conteudo := case when v_tipo = 'text' then coalesce(nullif(btrim(v_item ->> 'texto'), ''), '[mensagem vazia]')
                       when v_tipo = 'media_placeholder' then '[mídia do histórico — conteúdo não enviado pela Meta]'
                       else '[' || v_tipo || ' — visualização ainda não disponível no AVANTE]' end;
    v_conv := public.whatsapp_conversa_do_contato(v_n, v_tel, null, v_em);
    v_msg := null;
    insert into public.mensagens (tenant_id, conversa_id, direcao, tipo, conteudo, whatsapp_message_id, whatsapp_numero_id,
                                  status, status_detalhe, origem_app, created_at)
    values (v_n.tenant_id, v_conv, case when v_saida then 'saida' else 'entrada' end::public.direcao_mensagem, 'texto', left(v_conteudo, 4096),
            left(v_item ->> 'id', 200), v_n.id,
            case when p_origem = 'historico' then public.status_historico_whatsapp(v_item ->> 'status') else 'enviado' end,
            case when p_origem = 'historico' then 'Histórico do app WhatsApp Business' else 'Enviada pelo app WhatsApp Business' end,
            p_origem, v_em)
    on conflict (whatsapp_numero_id, whatsapp_message_id) where whatsapp_numero_id is not null and whatsapp_message_id is not null
    do nothing
    returning id into v_msg;
    if v_msg is null then v_dup := v_dup + 1; continue; end if;
    v_novas := v_novas + 1;
    update public.conversas
       set ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, '-infinity'), v_em),
           ultima_entrada_em = case when v_saida then ultima_entrada_em else greatest(coalesce(ultima_entrada_em, '-infinity'), v_em) end
     where id = v_conv;
  end loop;

  if p_origem = 'historico' and v_novas > 0 then
    update public.whatsapp_sincronizacoes set mensagens = mensagens + v_novas, atualizada_em = now()
     where numero_id = v_n.id and tipo = 'historico';
  end if;
  return jsonb_build_object('novas', v_novas, 'duplicadas', v_dup);
end;
$$;
revoke all on function public.whatsapp_registrar_mensagens_app(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_mensagens_app(text, text, jsonb) to service_role;

-- Andamento do histórico (fase 0–2, progresso 0–100) ou recusa da empresa (erro 2593109).
create function public.whatsapp_historico_andamento(p_phone_number_id text, p_fase integer, p_progresso integer, p_recusado boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.whatsapp_numeros;
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null then return; end if;
  insert into public.whatsapp_sincronizacoes (numero_id, tipo, situacao, fase, progresso)
  values (v_n.id, 'historico',
          case when p_recusado then 'recusada' when p_progresso >= 100 and p_fase >= 2 then 'concluida' else 'recebendo' end,
          p_fase, least(greatest(p_progresso, 0), 100))
  on conflict (numero_id, tipo) do update
    set situacao = excluded.situacao, fase = coalesce(excluded.fase, public.whatsapp_sincronizacoes.fase),
        progresso = coalesce(excluded.progresso, public.whatsapp_sincronizacoes.progresso),
        erro = case when p_recusado then 'A empresa não compartilhou o histórico no app WhatsApp Business.' end,
        atualizada_em = now();
end;
$$;
revoke all on function public.whatsapp_historico_andamento(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_historico_andamento(text, integer, integer, boolean) to service_role;

-- Contatos do app (só nome por telefone; não vira lead).
create function public.whatsapp_registrar_contatos_app(p_phone_number_id text, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n    public.whatsapp_numeros;
  v_item jsonb;
  v_tel  text;
  v_tot  integer := 0;
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null or v_n.modo_conexao <> 'coexistencia' or v_n.situacao = 'desconectado' then return 0; end if;
  for v_item in select * from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) loop
    v_tel := public.normalizar_telefone(v_item ->> 'telefone');
    continue when v_tel is null;
    if v_item ->> 'acao' = 'remove' then
      update public.whatsapp_contatos_app set removido_em = now(), atualizado_em = now() where numero_id = v_n.id and telefone = v_tel;
    else
      insert into public.whatsapp_contatos_app (numero_id, telefone, nome)
      values (v_n.id, v_tel, left(nullif(btrim(v_item ->> 'nome'), ''), 200))
      on conflict (numero_id, telefone) do update set nome = coalesce(excluded.nome, public.whatsapp_contatos_app.nome), removido_em = null, atualizado_em = now();
      update public.conversas set nome_contato = left(nullif(btrim(v_item ->> 'nome'), ''), 200)
       where whatsapp_numero_id = v_n.id and telefone = v_tel and nome_contato is null;
    end if;
    v_tot := v_tot + 1;
  end loop;
  update public.whatsapp_sincronizacoes set situacao = 'concluida', atualizada_em = now() where numero_id = v_n.id and tipo = 'contatos';
  return v_tot;
end;
$$;
revoke all on function public.whatsapp_registrar_contatos_app(text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_contatos_app(text, jsonb) to service_role;

-- Situação das sincronizações para a tela do Administrador (sem dado sensível).
create function public.whatsapp_sincronizacoes_da_empresa()
returns table (numero_id uuid, tipo text, situacao text, fase integer, progresso integer, mensagens integer, erro text, atualizada_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.numero_id, s.tipo, s.situacao, s.fase, s.progresso, s.mensagens, s.erro, s.atualizada_em
    from public.whatsapp_sincronizacoes s join public.whatsapp_numeros n on n.id = s.numero_id
   where n.tenant_id = public.tenant_atual()
     and public.tem_papel_no_tenant(n.tenant_id, array['admin_empresa', 'gerente']::public.tenant_papel[]);
$$;
revoke all on function public.whatsapp_sincronizacoes_da_empresa() from public, anon;
grant execute on function public.whatsapp_sincronizacoes_da_empresa() to authenticated;

-- Modo de conexão de cada número (Cloud API ou coexistência), para o painel.
create function public.whatsapp_modos_da_empresa()
returns table (numero_id uuid, modo text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.modo_conexao from public.whatsapp_numeros n
   where n.tenant_id = public.tenant_atual()
     and public.tem_papel_no_tenant(n.tenant_id, array['admin_empresa', 'gerente']::public.tenant_papel[]);
$$;
revoke all on function public.whatsapp_modos_da_empresa() from public, anon;
grant execute on function public.whatsapp_modos_da_empresa() to authenticated;

-- Fontes: o limite de integrações passa a valer também quando o plano não definiu (a definir = bloqueia nova).
create or replace function public.fontes_leads_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano public.planos;
  v_funil uuid;
  v_tipo  public.tipo_etapa;
  v_ativa boolean;
  v_integ text := public.integracao_da_fonte(new.tipo);
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id or new.tipo <> old.tipo then
      raise exception 'Empresa e tipo da fonte não mudam.' using errcode = '23514';
    end if;
    if old.status = 'revogada' and new.status <> 'revogada' then
      raise exception 'Fonte revogada não volta: crie uma nova.' using errcode = '23514';
    end if;
  end if;

  select e.funil_id, e.tipo, e.ativo into v_funil, v_tipo, v_ativa
    from public.etapas_funil e where e.id = new.etapa_id and e.tenant_id = new.tenant_id;
  if v_funil is distinct from new.funil_id or v_tipo <> 'aberta' or not v_ativa then
    raise exception 'A etapa de entrada precisa ser uma etapa aberta e ativa do funil escolhido.' using errcode = '23514';
  end if;
  if public.papel_comercial(new.responsavel_id, new.tenant_id) is null then
    raise exception 'O responsável precisa ser membro ativo da empresa.' using errcode = '23514';
  end if;

  if new.status = 'ativa' and (tg_op = 'INSERT' or old.status <> 'ativa') then
    if v_integ is not null and not public.integracao_permitida(v_integ, new.tenant_id) then
      raise exception 'Integração não incluída no plano desta empresa (ou bloqueada pelo Super Admin).' using errcode = 'RX003';
    end if;
    v_plano := public.plano_da_empresa(new.tenant_id);
    if v_integ is null and v_plano.id is not null and not (public.recurso_da_fonte(new.tipo) = any (v_plano.recursos)) then
      raise exception 'Recurso "%" não incluído no plano %.', public.recurso_da_fonte(new.tipo), v_plano.nome using errcode = 'RX003';
    end if;
    -- Número de WhatsApp: a cota é a de números (trigger em whatsapp_numeros), nunca a de fontes.
    if new.tipo <> 'whatsapp_cloud' then
      perform 1 from public.tenants where id = new.tenant_id for update;
      perform public.exigir_limite(new.tenant_id, 'fontes', public.uso_fontes(new.tenant_id));
    end if;
  end if;
  return new;
end;
$$;

-- Credenciais de ingestão (Respondi via Apps Script) são fonte de captação: mesma
-- permissão dos formulários e mesma cota de fontes. Agenda Google: só o recurso
-- do plano (não é fonte de lead e não gasta cota).
create or replace function public.limite_integracoes_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano public.planos;
begin
  if tg_table_name = 'ingestao_credenciais' then
    if not coalesce((to_jsonb(new) ->> 'ativo')::boolean, true) then
      return new;
    end if;
    if not public.integracao_permitida('formularios', new.tenant_id) then
      raise exception 'Captação por formulário não incluída no plano desta empresa (ou bloqueada pelo Super Admin).' using errcode = 'RX003';
    end if;
    perform 1 from public.tenants where id = new.tenant_id for update;
    perform public.exigir_limite(new.tenant_id, 'fontes', public.uso_fontes(new.tenant_id));
    return new;
  end if;
  -- agenda_google_conexao: reconectar (mesma empresa) não é conexão nova.
  if exists (select 1 from public.agenda_google_conexao g where g.tenant_id = new.tenant_id) then
    return new;
  end if;
  v_plano := public.plano_da_empresa(new.tenant_id);
  if v_plano.id is not null and not ('agenda_google' = any (v_plano.recursos)) then
    raise exception 'Recurso "agenda_google" não incluído no plano %.', v_plano.nome using errcode = 'RX003';
  end if;
  return new;
end;
$$;

-- Números: conta as duas modalidades; o que já está conectado continua (só NOVO ou reconexão entra na conta).
create function public.whatsapp_numeros_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.situacao <> 'desconectado' and (tg_op = 'INSERT' or old.situacao = 'desconectado') then
    perform 1 from public.tenants where id = new.tenant_id for update;
    perform public.exigir_limite(new.tenant_id, 'numeros_whatsapp',
      public.uso_numeros_whatsapp(new.tenant_id));
  end if;
  return new;
end;
$$;
revoke all on function public.whatsapp_numeros_limite() from public, anon, authenticated;
create trigger zz_whatsapp_numeros_limite before insert or update of situacao on public.whatsapp_numeros
  for each row execute function public.whatsapp_numeros_limite();

-- Super Admin: limites novos do plano (números de WhatsApp e funis). O restante continua em admin_salvar_plano.
create function public.admin_definir_limites_plano(p_codigo text, p_numeros integer, p_funis integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if (p_numeros is not null and p_numeros not between 0 and 1000) or (p_funis is not null and p_funis not between 1 and 1000) then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;
  update public.planos set limite_numeros_whatsapp = p_numeros, limite_funis = p_funis where codigo = p_codigo;
  if not found then raise exception 'Plano inexistente.' using errcode = 'P0002'; end if;
  perform public.registrar_auditoria('plano_limites_definidos', null, jsonb_build_object('codigo', p_codigo, 'numeros_whatsapp', p_numeros, 'funis', p_funis));
end;
$$;
revoke all on function public.admin_definir_limites_plano(text, integer, integer) from public, anon;
grant execute on function public.admin_definir_limites_plano(text, integer, integer) to authenticated;

create function public.admin_limites_planos()
returns table (codigo text, limite_numeros_whatsapp integer, limite_funis integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query select p.codigo, p.limite_numeros_whatsapp, p.limite_funis from public.planos p order by p.ordem;
end;
$$;
revoke all on function public.admin_limites_planos() from public, anon;
grant execute on function public.admin_limites_planos() to authenticated;

-- Painel do Super Admin: para cada cota, o padrão do plano, a exceção da empresa
-- (se houver), o limite que vale e o uso atual. Uso acima do limite (limite
-- reduzido pelo Super Admin) não apaga nada: só barra criações novas.
create function public.admin_limites_empresa(p_tenant uuid)
returns table (recurso text, padrao integer, padrao_definido boolean, excecao integer, motivo text, definido_em timestamptz,
               efetivo integer, efetivo_definido boolean, uso integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.planos;
begin
  perform public.exigir_super_admin();
  v_p := public.plano_da_empresa(p_tenant);
  return query
    select r.recurso,
           case r.recurso when 'fontes' then v_p.limite_integracoes when 'numeros_whatsapp' then v_p.limite_numeros_whatsapp else v_p.limite_funis end,
           (case r.recurso when 'fontes' then v_p.limite_integracoes when 'numeros_whatsapp' then v_p.limite_numeros_whatsapp else v_p.limite_funis end) is not null,
           l.limite, l.motivo, l.definido_em, e.limite, e.definido,
           case r.recurso when 'fontes' then public.uso_fontes(p_tenant)
                          when 'numeros_whatsapp' then public.uso_numeros_whatsapp(p_tenant)
                          else (select count(*) from public.funis f where f.tenant_id = p_tenant and f.ativo)::integer end
      from unnest(array['fontes', 'numeros_whatsapp', 'funis']) with ordinality as r (recurso, ordem)
      left join public.empresa_limites l on l.tenant_id = p_tenant and l.recurso = r.recurso
      cross join lateral public.limite_efetivo(p_tenant, r.recurso) e
     order by r.ordem;
end;
$$;
revoke all on function public.admin_limites_empresa(uuid) from public, anon;
grant execute on function public.admin_limites_empresa(uuid) to authenticated;

-- Super Admin: limite próprio de uma empresa (null = volta ao do plano). Sempre com motivo, auditado.
create function public.admin_definir_limite_empresa(p_tenant uuid, p_recurso text, p_limite integer, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_recurso not in ('fontes', 'numeros_whatsapp', 'funis') then raise exception 'Recurso inválido.' using errcode = '22023'; end if;
  if p_limite is null then
    delete from public.empresa_limites where tenant_id = p_tenant and recurso = p_recurso;
    return;
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Informe o motivo do limite.' using errcode = '22023'; end if;
  insert into public.empresa_limites (tenant_id, recurso, limite, motivo, definido_por)
  values (p_tenant, p_recurso, p_limite, left(btrim(p_motivo), 300), (select auth.uid()))
  on conflict (tenant_id, recurso) do update set limite = excluded.limite, motivo = excluded.motivo, definido_por = excluded.definido_por, definido_em = now();
end;
$$;
revoke all on function public.admin_definir_limite_empresa(uuid, text, integer, text) from public, anon;
grant execute on function public.admin_definir_limite_empresa(uuid, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5c. Padrões dos planos aprovados pelo proprietário (29/10/2026)
--
--   Plano     usuários  fontes  funis  números WhatsApp  Meta Ads
--   Starter       1       1       1          1           não disponível
--   Pro           3       3       3          3           só com liberação individual
--   Business     10      10      10         10           incluído
--
-- Starter: captação básica por formulário (`formularios`), sem Google Sheets.
-- WhatsApp no plano de todos (cota de números), mas a chave global continua
-- DESLIGADA: limite disponível não liga integração nenhuma. Exceções por
-- empresa (Super Admin, com motivo e auditoria) prevalecem sobre o padrão.
-- O que já existe acima de uma cota é preservado: só criações novas são barradas.
-- ---------------------------------------------------------------------------
create function pg_temp.recursos_com(p_atual text[], p_incluir text[], p_tirar text[])
returns text[] language sql immutable as $$
  select array(select x from unnest(p_atual || array(select y from unnest(p_incluir) y where not (y = any (p_atual)))) with ordinality u (x, o)
                where not (x = any (p_tirar)) order by o)
$$;

update public.planos set limite_usuarios = 1, limite_integracoes = 1, limite_funis = 1, limite_numeros_whatsapp = 1,
       recursos = pg_temp.recursos_com(recursos, array['formularios', 'whatsapp'], array['meta_conversoes'])
 where codigo = 'starter';
update public.planos set limite_usuarios = 3, limite_integracoes = 3, limite_funis = 3, limite_numeros_whatsapp = 3,
       recursos = pg_temp.recursos_com(recursos, array['whatsapp'], array['meta_conversoes'])
 where codigo = 'pro';
update public.planos set limite_usuarios = 10, limite_integracoes = 10, limite_funis = 10, limite_numeros_whatsapp = 10,
       recursos = pg_temp.recursos_com(recursos, array['whatsapp', 'meta_conversoes'], array[]::text[])
 where codigo = 'business';

insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
select null, 'planos_padroes_aprovados', null,
       jsonb_build_object('origem', 'migration 20261104090000', 'aprovado_em', '2026-10-29',
                          'planos', jsonb_agg(jsonb_build_object('codigo', p.codigo, 'usuarios', p.limite_usuarios, 'fontes', p.limite_integracoes,
                                                                 'funis', p.limite_funis, 'numeros_whatsapp', p.limite_numeros_whatsapp,
                                                                 'recursos', p.recursos) order by p.ordem))
  from public.planos p where p.codigo in ('starter', 'pro', 'business');

-- ---------------------------------------------------------------------------
-- 6. Trava de aplicação: nenhuma integração em uso pode perder a permissão.
-- ---------------------------------------------------------------------------
do $$
declare
  v_lista text;
begin
  select string_agg(distinct t.nome || ' (' || u.integracao || ')', ', ') into v_lista
    from public.tenants t
    cross join lateral public.uso_por_integracao(t.id) u
   where u.em_uso > 0 and public.integracao_lancada(u.integracao, t.id) and not public.integracao_permitida(u.integracao, t.id);
  if v_lista is not null then
    raise exception 'Integrações em uso sem permissão pela regra nova: %. Defina a exceção antes de aplicar.', v_lista;
  end if;
end;
$$;
