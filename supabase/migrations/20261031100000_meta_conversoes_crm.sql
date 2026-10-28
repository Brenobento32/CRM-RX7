set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Meta Ads — Conversões do CRM (Conversions API for CRM / Conversion Leads)
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- O que a Meta exige (documentação oficial, payload "Conversion Leads"):
--   action_source = 'system_generated'; user_data.lead_id = ID do lead de
--   formulário nativo (Lead Ads, 15–17 dígitos); custom_data.event_source =
--   'crm' e custom_data.lead_event_source = nome do CRM; event_name livre (a
--   etapa do CRM), enviando TODAS as etapas na ordem; event_time até 7 dias
--   antes do envio e depois da geração do lead.
--
-- Regras do AVANTE:
--   - cada empresa tem a própria conexão (dataset da própria conta Meta); um
--     dataset nunca serve a duas empresas; o token fica no Vault;
--   - só PRO/Business: recurso de plano 'meta_conversoes' (o Super Admin liga
--     o recurso no plano; esta migration NÃO altera planos);
--   - eventos nascem do histórico de etapas (historico_etapas), só para funis
--     monitorados e etapas mapeadas, e só viram envio quando o lead tem um ID
--     de lead da Meta legítimo (Lead Ads, ou coluna da planilha alimentada
--     pelos Lead Ads). Sem isso: registrado como "sem correspondência", nunca
--     enviado — o AVANTE não presume que o lead veio de anúncio;
--   - idempotência: event_id = negociação + etapa (um evento por etapa);
--   - fila com lease, retry com recuo, limite da API e auditoria;
--   - sem dados pessoais na fila nem nos logs; e-mail/telefone (com hash
--     SHA-256) só se o Administrador ligar essa opção.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Recurso de plano (sem alterar nenhum plano)
-- ---------------------------------------------------------------------------
create or replace function public.recursos_validos()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['funis_multiplos', 'metas', 'agenda_google', 'ingestao_leads', 'whatsapp', 'relatorios', 'meta_conversoes'] $$;

-- Empresa interna (Rio X7): liberada. Assinante: só se o plano tiver o recurso
-- e a assinatura estiver em teste ou ativa. Arquivo: nunca.
create function public.meta_conversoes_elegivel(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.tipo = 'interno' then true
    when t.tipo = 'arquivo' or t.status not in ('ativo', 'teste') then false
    else coalesce((select 'meta_conversoes' = any (p.recursos)
                     from public.assinaturas a join public.planos p on p.id = a.plano_id
                    where a.tenant_id = t.id and a.status in ('teste', 'ativa')), false)
  end
  from public.tenants t where t.id = p_tenant;
$$;

-- ---------------------------------------------------------------------------
-- 1. Conexão, funis monitorados e mapeamento
-- ---------------------------------------------------------------------------
create table public.meta_conversoes_conexoes (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null unique references public.tenants (id) on delete cascade,
  business_id          text not null check (business_id ~ '^[0-9]{5,30}$'),
  dataset_id           text not null check (dataset_id ~ '^[0-9]{5,30}$'),
  dataset_nome         text check (dataset_nome is null or length(dataset_nome) <= 200),
  vault_secret_id      uuid,
  situacao             text not null default 'configurando'
                       check (situacao in ('configurando', 'ativa', 'pausada', 'erro_autorizacao', 'desconectada')),
  enviar_contato_hash  boolean not null default false,
  codigo_teste         text check (codigo_teste is null or codigo_teste ~ '^[A-Za-z0-9_-]{3,40}$'),
  conectado_por        uuid references auth.users (id) on delete set null,
  conectado_em         timestamptz not null default now(),
  ativada_em           timestamptz,
  ultimo_envio_em      timestamptz,
  enviados             integer not null default 0,
  rejeitados           integer not null default 0,
  ultimo_erro          text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  ultimo_erro_em       timestamptz,
  unique (tenant_id, id)
);
-- Um dataset (da conta Meta de uma empresa) nunca recebe eventos de outra empresa.
create unique index meta_conversoes_dataset_unico on public.meta_conversoes_conexoes (dataset_id) where situacao <> 'desconectada';
alter table public.meta_conversoes_conexoes enable row level security;
revoke all on public.meta_conversoes_conexoes from public, anon, authenticated;

create table public.meta_conversoes_funis (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  funil_id  uuid not null references public.funis (id) on delete cascade,
  primary key (tenant_id, funil_id)
);
alter table public.meta_conversoes_funis enable row level security;
revoke all on public.meta_conversoes_funis from public, anon, authenticated;

create table public.meta_conversoes_mapeamento (
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  funil_id      uuid not null references public.funis (id) on delete cascade,
  etapa_id      uuid not null references public.etapas_funil (id) on delete cascade,
  evento        text not null check (evento ~ '^[[:alnum:] _À-ÿ-]{2,50}$'),
  enviar_valor  boolean not null default false,
  primary key (tenant_id, etapa_id)
);
alter table public.meta_conversoes_mapeamento enable row level security;
revoke all on public.meta_conversoes_mapeamento from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fila de eventos (sem dados pessoais)
-- ---------------------------------------------------------------------------
create table public.meta_conversoes_eventos (
  id                    bigint generated always as identity primary key,
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  conexao_id            uuid not null,
  negociacao_id         uuid not null,
  funil_id              uuid not null,
  etapa_id              uuid not null,
  evento                text not null,
  event_id              text not null,
  event_time            timestamptz not null,
  lead_id               text check (lead_id is null or lead_id ~ '^[0-9]{15,17}$'),
  enviar_valor          boolean not null default false,
  situacao              text not null default 'pendente'
                        check (situacao in ('pendente', 'enviando', 'enviado', 'rejeitado', 'sem_correspondencia', 'expirado')),
  tentativas            integer not null default 0,
  proxima_tentativa_em  timestamptz not null default now(),
  bloqueado_ate         timestamptz,
  ultimo_erro           text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  fbtrace_id            text check (fbtrace_id is null or length(fbtrace_id) <= 100),
  enviado_em            timestamptz,
  created_at            timestamptz not null default now(),
  unique (tenant_id, event_id),
  foreign key (tenant_id, conexao_id) references public.meta_conversoes_conexoes (tenant_id, id) on delete cascade
);
create index meta_conversoes_eventos_fila on public.meta_conversoes_eventos (proxima_tentativa_em) where situacao = 'pendente';
alter table public.meta_conversoes_eventos enable row level security;
revoke all on public.meta_conversoes_eventos from public, anon, authenticated;

-- ID do lead da Meta guardado na entrada (nunca presumido): Lead Ads
-- (meta-webhooks: leadgen_id) ou coluna da planilha (meta_lead_id), também
-- quando chegou como origem adicional de uma negociação reaproveitada.
create function public.meta_lead_id_da_negociacao(p_atribuicao jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select v from (
    select p_atribuicao ->> 'leadgen_id' as v, 1 as o
    union all select p_atribuicao ->> 'meta_lead_id', 2
    union all select x ->> 'meta_lead_id', 3 from jsonb_array_elements(coalesce(p_atribuicao -> 'origens_adicionais', '[]'::jsonb)) x
  ) t
  where v ~ '^[0-9]{15,17}$'
  order by o limit 1;
$$;

-- Gatilho no histórico do funil: etapa mapeada de funil monitorado → evento.
create function public.meta_conversoes_enfileirar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_con   public.meta_conversoes_conexoes;
  v_map   public.meta_conversoes_mapeamento;
  v_neg   public.negociacoes;
  v_lead  text;
  v_criado timestamptz;
  v_sit   text;
begin
  if not public.integracao_habilitada('meta_conversoes', new.tenant_id) then return null; end if;
  select * into v_con from public.meta_conversoes_conexoes where tenant_id = new.tenant_id and situacao = 'ativa';
  if v_con.id is null or not public.meta_conversoes_elegivel(new.tenant_id) then return null; end if;
  select m.* into v_map from public.meta_conversoes_mapeamento m
    join public.meta_conversoes_funis f on f.tenant_id = m.tenant_id and f.funil_id = m.funil_id
   where m.tenant_id = new.tenant_id and m.etapa_id = new.etapa_nova_id;
  if v_map.etapa_id is null then return null; end if;
  select * into v_neg from public.negociacoes where id = new.negociacao_id and tenant_id = new.tenant_id;
  if v_neg.id is null then return null; end if;

  v_lead := public.meta_lead_id_da_negociacao(v_neg.atribuicao);
  v_criado := case when (v_neg.atribuicao ->> 'created_time') ~ '^\d{4}-\d{2}-\d{2}' then (v_neg.atribuicao ->> 'created_time')::timestamptz end;
  v_sit := case when v_lead is null then 'sem_correspondencia'
                when v_criado is not null and new.created_at < v_criado then 'expirado'
                else 'pendente' end;
  insert into public.meta_conversoes_eventos (tenant_id, conexao_id, negociacao_id, funil_id, etapa_id, evento, event_id, event_time,
                                              lead_id, enviar_valor, situacao)
  values (new.tenant_id, v_con.id, new.negociacao_id, v_map.funil_id, v_map.etapa_id, v_map.evento,
          'avante-' || new.negociacao_id::text || '-' || v_map.etapa_id::text, new.created_at, v_lead, v_map.enviar_valor, v_sit)
  on conflict (tenant_id, event_id) do nothing;
  return null;
exception when others then
  -- Nunca atrapalha a movimentação do funil.
  return null;
end;
$$;
revoke all on function public.meta_conversoes_enfileirar() from public, anon, authenticated;
create trigger zz_meta_conversoes_enfileirar after insert on public.historico_etapas
  for each row execute function public.meta_conversoes_enfileirar();

-- ---------------------------------------------------------------------------
-- 3. Administrador (empresa da aba; o banco confere cargo e plano)
-- ---------------------------------------------------------------------------
create function public.capi_exigir()
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
    raise exception 'Conversões do CRM para Meta Ads estão disponíveis nos planos Pro e Business.' using errcode = 'RX003';
  end if;
  return v_tenant;
end;
$$;

create function public.capi_da_empresa()
returns table (elegivel boolean, conexao_id uuid, situacao text, business_id text, dataset_id text, dataset_nome text,
               enviar_contato_hash boolean, codigo_teste text, conectado_em timestamptz, ativada_em timestamptz,
               ultimo_envio_em timestamptz, enviados integer, rejeitados integer, pendentes integer, sem_correspondencia integer,
               ultimo_erro text, funis uuid[], mapeamento jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
begin
  return query
  select public.meta_conversoes_elegivel(v_tenant) and public.integracao_habilitada('meta_conversoes', v_tenant), c.id, c.situacao, c.business_id, c.dataset_id, c.dataset_nome,
         coalesce(c.enviar_contato_hash, false), c.codigo_teste, c.conectado_em, c.ativada_em, c.ultimo_envio_em,
         coalesce(c.enviados, 0), coalesce(c.rejeitados, 0),
         (select count(*)::integer from public.meta_conversoes_eventos e where e.tenant_id = v_tenant and e.situacao in ('pendente', 'enviando')),
         (select count(*)::integer from public.meta_conversoes_eventos e where e.tenant_id = v_tenant and e.situacao = 'sem_correspondencia'),
         c.ultimo_erro,
         coalesce((select array_agg(f.funil_id) from public.meta_conversoes_funis f where f.tenant_id = v_tenant), '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('funil_id', m.funil_id, 'etapa_id', m.etapa_id, 'evento', m.evento, 'enviar_valor', m.enviar_valor))
                     from public.meta_conversoes_mapeamento m where m.tenant_id = v_tenant), '[]'::jsonb)
    from (select 1) um
    left join public.meta_conversoes_conexoes c on c.tenant_id = v_tenant and c.situacao <> 'desconectada';
end;
$$;

-- Funis monitorados + etapa → evento. Só funis/etapas DESTA empresa; etapa do funil escolhido.
create function public.capi_definir_configuracao(p_funis uuid[], p_mapeamento jsonb, p_enviar_contato_hash boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.capi_exigir();
  v_item   jsonb;
  v_etapa  public.etapas_funil;
begin
  if not exists (select 1 from public.meta_conversoes_conexoes where tenant_id = v_tenant and situacao <> 'desconectada') then
    raise exception 'Conecte a conta Meta Ads antes de configurar.' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(coalesce(p_funis, '{}')) f
              where not exists (select 1 from public.funis x where x.id = f and x.tenant_id = v_tenant and x.ativo)) then
    raise exception 'Funil inválido para esta empresa.' using errcode = '23503';
  end if;
  delete from public.meta_conversoes_mapeamento where tenant_id = v_tenant;
  delete from public.meta_conversoes_funis where tenant_id = v_tenant;
  insert into public.meta_conversoes_funis (tenant_id, funil_id) select distinct v_tenant, f from unnest(coalesce(p_funis, '{}')) f;
  for v_item in select * from jsonb_array_elements(coalesce(p_mapeamento, '[]'::jsonb)) loop
    select * into v_etapa from public.etapas_funil where id = (v_item ->> 'etapa_id')::uuid and tenant_id = v_tenant;
    if v_etapa.id is null or not (v_etapa.funil_id = any (coalesce(p_funis, '{}'))) then
      raise exception 'Etapa inválida: precisa ser de um funil monitorado desta empresa.' using errcode = '23503';
    end if;
    insert into public.meta_conversoes_mapeamento (tenant_id, funil_id, etapa_id, evento, enviar_valor)
    values (v_tenant, v_etapa.funil_id, v_etapa.id, btrim(v_item ->> 'evento'),
            coalesce((v_item ->> 'enviar_valor')::boolean, false) and v_etapa.tipo = 'ganha');
  end loop;
  update public.meta_conversoes_conexoes set enviar_contato_hash = coalesce(p_enviar_contato_hash, false)
   where tenant_id = v_tenant and situacao <> 'desconectada';
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_configuracao', v_tenant,
          jsonb_build_object('funis', coalesce(p_funis, '{}'), 'etapas', jsonb_array_length(coalesce(p_mapeamento, '[]'::jsonb)),
                             'enviar_contato_hash', coalesce(p_enviar_contato_hash, false)));
end;
$$;

create function public.capi_acao(p_acao text, p_codigo_teste text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_c      public.meta_conversoes_conexoes;
begin
  select * into v_c from public.meta_conversoes_conexoes where tenant_id = v_tenant and situacao <> 'desconectada' for update;
  if v_c.id is null then raise exception 'Nenhuma conta Meta Ads conectada nesta empresa.' using errcode = 'P0002'; end if;
  if p_acao in ('ativar', 'retomar') then
    perform public.capi_exigir();
    if v_c.vault_secret_id is null then raise exception 'Conecte a conta Meta Ads de novo.' using errcode = '23514'; end if;
    if not exists (select 1 from public.meta_conversoes_mapeamento where tenant_id = v_tenant) then
      raise exception 'Mapeie ao menos uma etapa para um evento antes de ativar.' using errcode = '23514';
    end if;
    update public.meta_conversoes_conexoes set situacao = 'ativa', ativada_em = coalesce(ativada_em, now()), ultimo_erro = null
     where id = v_c.id;
  elsif p_acao = 'pausar' then
    update public.meta_conversoes_conexoes set situacao = 'pausada' where id = v_c.id;
  elsif p_acao = 'definir_codigo_teste' then
    update public.meta_conversoes_conexoes set codigo_teste = nullif(btrim(coalesce(p_codigo_teste, '')), '') where id = v_c.id;
  elsif p_acao = 'desconectar' then
    if v_c.vault_secret_id is not null then delete from vault.secrets where id = v_c.vault_secret_id; end if;
    update public.meta_conversoes_conexoes set situacao = 'desconectada', vault_secret_id = null where id = v_c.id;
    update public.meta_conversoes_eventos set situacao = 'rejeitado', ultimo_erro = 'Conexão desconectada antes do envio.'
     where conexao_id = v_c.id and situacao in ('pendente', 'enviando');
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_' || p_acao, v_tenant, jsonb_build_object('conexao', v_c.id));
end;
$$;

create function public.capi_reprocessar(p_evento bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.capi_exigir();
begin
  update public.meta_conversoes_eventos
     set situacao = 'pendente', tentativas = 0, proxima_tentativa_em = now(), ultimo_erro = null, bloqueado_ate = null
   where id = p_evento and tenant_id = v_tenant and situacao = 'rejeitado' and lead_id is not null
     and event_time > now() - interval '7 days';
  if not found then
    raise exception 'Só eventos rejeitados, com ID de lead e com menos de 7 dias podem ser reenviados.' using errcode = '23514';
  end if;
end;
$$;

create function public.capi_eventos_recentes(p_limite integer default 50)
returns table (id bigint, evento text, situacao text, negociacao_id uuid, cliente_nome text, funil_nome text, event_time timestamptz,
               enviado_em timestamptz, tentativas integer, ultimo_erro text, com_lead_id boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.evento, e.situacao, e.negociacao_id, c.nome, f.nome, e.event_time, e.enviado_em, e.tentativas, e.ultimo_erro, e.lead_id is not null
    from public.meta_conversoes_eventos e
    left join public.negociacoes n on n.id = e.negociacao_id
    left join public.clientes c on c.id = n.cliente_id
    left join public.funis f on f.id = e.funil_id
   where e.tenant_id = public.exigir_administrador_integracoes()
   order by e.created_at desc
   limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- 4. Serviço (Edge Function, service_role)
-- ---------------------------------------------------------------------------
create function public.capi_salvar_conexao(p_tenant uuid, p_usuario uuid, p_business_id text, p_dataset_id text, p_dataset_nome text, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual  public.meta_conversoes_conexoes;
  v_secret uuid;
  v_id     uuid;
begin
  perform public.exigir_integracao_habilitada('meta_conversoes', p_tenant);
  if not public.usuario_administra_integracoes(p_usuario, p_tenant) then
    raise exception 'Usuário não administra as integrações desta empresa.' using errcode = '42501';
  end if;
  if not public.meta_conversoes_elegivel(p_tenant) then
    raise exception 'Conversões do CRM para Meta Ads estão disponíveis nos planos Pro e Business.' using errcode = 'RX003';
  end if;
  if exists (select 1 from public.meta_conversoes_conexoes where dataset_id = p_dataset_id and tenant_id <> p_tenant and situacao <> 'desconectada') then
    raise exception 'Este conjunto de dados da Meta já está ligado a outra empresa.' using errcode = '23505';
  end if;
  if p_token is null or length(p_token) < 20 then raise exception 'Token inválido.' using errcode = '22023'; end if;
  v_secret := vault.create_secret(p_token, null, 'meta-capi ' || p_tenant::text);
  select * into v_atual from public.meta_conversoes_conexoes where tenant_id = p_tenant for update;
  if v_atual.id is not null and v_atual.vault_secret_id is not null then delete from vault.secrets where id = v_atual.vault_secret_id; end if;
  insert into public.meta_conversoes_conexoes (tenant_id, business_id, dataset_id, dataset_nome, vault_secret_id, situacao, conectado_por)
  values (p_tenant, p_business_id, p_dataset_id, left(p_dataset_nome, 200), v_secret, 'configurando', p_usuario)
  on conflict (tenant_id) do update
     set business_id = excluded.business_id, dataset_id = excluded.dataset_id, dataset_nome = excluded.dataset_nome,
         vault_secret_id = excluded.vault_secret_id, conectado_por = excluded.conectado_por, conectado_em = now(),
         -- trocar de dataset reinicia o aprendizado na Meta: volta para configuração, nunca ativa sozinha
         situacao = case when public.meta_conversoes_conexoes.dataset_id = excluded.dataset_id
                          and public.meta_conversoes_conexoes.situacao in ('ativa', 'pausada', 'erro_autorizacao')
                         then 'pausada' else 'configurando' end,
         ultimo_erro = null, ultimo_erro_em = null
  returning id into v_id;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (p_usuario, 'capi_conectada', p_tenant, jsonb_build_object('conexao', v_id, 'business_id', p_business_id, 'dataset_id', p_dataset_id));
  return v_id;
end;
$$;

-- Reserva um lote (lease + SKIP LOCKED). Eventos com mais de 7 dias expiram sem envio.
create function public.capi_reservar(p_limite integer default 50)
returns table (evento_id bigint, tenant_id uuid, conexao_id uuid, dataset_id text, codigo_teste text, evento text, event_id text,
               event_time_unix bigint, lead_id text, valor numeric, moeda text, email text, telefone text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.meta_conversoes_eventos e set situacao = 'expirado', ultimo_erro = 'Mais de 7 dias: a Meta não aceita mais este evento.'
   where e.situacao = 'pendente' and e.event_time < now() - interval '7 days';
  return query
  with lote as (
    select e.id
      from public.meta_conversoes_eventos e
      join public.meta_conversoes_conexoes c on c.id = e.conexao_id
     where e.situacao = 'pendente' and e.proxima_tentativa_em <= now() and e.lead_id is not null
       and (e.bloqueado_ate is null or e.bloqueado_ate < now())
       and c.situacao = 'ativa' and c.vault_secret_id is not null and public.meta_conversoes_elegivel(e.tenant_id)
       and public.integracao_habilitada('meta_conversoes', e.tenant_id)
     order by e.proxima_tentativa_em
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
     for update of e skip locked
  ), marcados as (
    update public.meta_conversoes_eventos e
       set situacao = 'enviando', tentativas = e.tentativas + 1, bloqueado_ate = now() + interval '5 minutes'
      from lote where e.id = lote.id
    returning e.*
  )
  select m.id, m.tenant_id, m.conexao_id, c.dataset_id, c.codigo_teste, m.evento, m.event_id,
         extract(epoch from m.event_time)::bigint, m.lead_id,
         case when m.enviar_valor then (select f.valor_vendido from public.fechamentos f
                                         where f.negociacao_id = m.negociacao_id and f.anulado_em is null
                                         order by f.fechado_em desc limit 1) end,
         case when m.enviar_valor then 'BRL' end,
         case when c.enviar_contato_hash then cl.email end,
         case when c.enviar_contato_hash then cl.telefone end
    from marcados m
    join public.meta_conversoes_conexoes c on c.id = m.conexao_id
    left join public.negociacoes n on n.id = m.negociacao_id
    left join public.clientes cl on cl.id = n.cliente_id;
end;
$$;

create function public.capi_obter_token(p_conexao uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::text
    from public.meta_conversoes_conexoes c join vault.decrypted_secrets s on s.id = c.vault_secret_id
   where c.id = p_conexao and c.situacao = 'ativa';
$$;

-- Resultado do envio: ok | temporário (recuo até 6 h, máx. 8 tentativas) | permanente | autorização.
create function public.capi_concluir(p_evento bigint, p_resultado text, p_erro text, p_fbtrace text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.meta_conversoes_eventos;
begin
  select * into v_e from public.meta_conversoes_eventos where id = p_evento and situacao = 'enviando' for update;
  if v_e.id is null then return; end if;
  if p_resultado = 'ok' then
    update public.meta_conversoes_eventos set situacao = 'enviado', enviado_em = now(), ultimo_erro = null,
                                              fbtrace_id = left(p_fbtrace, 100), bloqueado_ate = null
     where id = v_e.id;
    update public.meta_conversoes_conexoes set enviados = enviados + 1, ultimo_envio_em = now() where id = v_e.conexao_id;
  elsif p_resultado = 'permanente' or (p_resultado = 'temporario' and v_e.tentativas >= 8) then
    update public.meta_conversoes_eventos set situacao = 'rejeitado', ultimo_erro = left(p_erro, 300), fbtrace_id = left(p_fbtrace, 100),
                                              bloqueado_ate = null
     where id = v_e.id;
    update public.meta_conversoes_conexoes set rejeitados = rejeitados + 1, ultimo_erro = left(p_erro, 300), ultimo_erro_em = now()
     where id = v_e.conexao_id;
  else
    -- temporário / limite da API / autorização: volta para a fila com recuo exponencial.
    update public.meta_conversoes_eventos
       set situacao = 'pendente', ultimo_erro = left(p_erro, 300), bloqueado_ate = null,
           proxima_tentativa_em = now() + least(interval '6 hours', make_interval(mins => (2 ^ least(v_e.tentativas, 9))::integer))
     where id = v_e.id;
    if p_resultado = 'autorizacao' then
      update public.meta_conversoes_conexoes set situacao = 'erro_autorizacao', ultimo_erro = left(p_erro, 300), ultimo_erro_em = now()
       where id = v_e.conexao_id and situacao = 'ativa';
    else
      update public.meta_conversoes_conexoes set ultimo_erro = left(p_erro, 300), ultimo_erro_em = now() where id = v_e.conexao_id;
    end if;
  end if;
end;
$$;

-- Super Admin: situação no painel global (sem segredos).
create or replace function public.admin_integracoes_empresa(p_tenant uuid)
returns table (tipo text, nome text, status text, situacao text, ultimo_erro text, ultima_atividade timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
  select f.tipo::text, f.nome, f.status::text, coalesce(g.situacao, n.situacao, f.status::text),
         coalesce(g.ultimo_erro, n.ultimo_erro, f.ultimo_erro), greatest(f.ultimo_lead_em, g.ultima_sincronizacao_em, n.ultimo_evento_em)
    from public.fontes_leads f
    left join public.fontes_google_sheets g on g.fonte_id = f.id
    left join public.whatsapp_numeros n on n.fonte_id = f.id
   where f.tenant_id = p_tenant and f.tipo in ('google_sheets', 'whatsapp_cloud')
  union all
  select 'meta_conversoes', coalesce(c.dataset_nome, 'Meta Ads — Conversões do CRM'), c.situacao, c.situacao, c.ultimo_erro, c.ultimo_envio_em
    from public.meta_conversoes_conexoes c
   where c.tenant_id = p_tenant and c.situacao <> 'desconectada';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Permissões
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.capi_salvar_conexao(uuid, uuid, text, text, text, text)',
    'public.capi_reservar(integer)',
    'public.capi_obter_token(uuid)',
    'public.capi_concluir(bigint, text, text, text)',
    'public.meta_conversoes_elegivel(uuid)',
    'public.meta_lead_id_da_negociacao(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.capi_exigir()',
    'public.capi_da_empresa()',
    'public.capi_definir_configuracao(uuid[], jsonb, boolean)',
    'public.capi_acao(text, text)',
    'public.capi_reprocessar(bigint)',
    'public.capi_eventos_recentes(integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
