-- ===========================================================================
-- T14 — Fontes de leads por empresa (depende de T9–T13).
--
-- Cada empresa cadastra as próprias fontes: formulário RX7, webhook (API),
-- Respondi da empresa, Google Sheets (Apps Script), Meta Lead Ads e WhatsApp
-- Cloud API. Cadastro manual continua nativo (tela de clientes).
--
-- - A empresa SEMPRE vem da fonte, nunca do remetente:
--     push (webhook/Respondi/Sheets): token `rx7f_<id>_<segredo>` (só hash salvo);
--     Meta/WhatsApp: payload assinado pela Meta (validado na Edge Function) +
--       page_id/phone_number_id cadastrado numa fonte VALIDADA com o provedor;
--     formulário RX7: id público da fonte (página do RX7) + isca + limite por minuto.
-- - Cada fonte escolhe funil, etapa de entrada e responsável (mesma empresa).
-- - Núcleo único (`ingerir_lead_nucleo`): normaliza, deduplica cliente e
--   torna o lead idempotente por fonte, só dentro da empresa.
-- - Todo recebimento é registrado em `ingestao_eventos` (inclusive erros).
-- - Fonte revogada/pausada ou empresa suspensa/cancelada não recebe lead.
-- - Limite de integrações e recursos do plano valem para fontes ativas.
-- - Segredos de provedor (token da página/WhatsApp) só no Vault.
-- - Meta e WhatsApp ficam "não validados" até a validação real com o provedor:
--   enquanto isso, nenhum evento é aceito para eles.
-- ===========================================================================

do $$
begin
  if to_regclass('public.planos') is null then
    raise exception 'T14 exige a T13.';
  end if;
  if to_regclass('public.fontes_leads') is not null then
    raise exception 'T14 já aplicada.';
  end if;
end $$;

create type public.fonte_lead_tipo as enum (
  'formulario_rx7', 'webhook', 'respondi', 'google_sheets', 'meta_lead_ads', 'whatsapp_cloud');
create type public.fonte_lead_status as enum ('ativa', 'pausada', 'revogada');

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.fontes_leads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  tipo            public.fonte_lead_tipo not null,
  nome            text not null check (btrim(nome) <> '' and length(nome) <= 80),
  status          public.fonte_lead_status not null default 'ativa',
  funil_id        uuid not null,
  etapa_id        uuid not null,
  responsavel_id  uuid not null references public.profiles (id) on delete restrict,
  nicho_id        uuid,
  formulario_id   uuid,
  configuracao    jsonb not null default '{}'::jsonb check (jsonb_typeof(configuracao) = 'object'),
  segredo_hash    bytea,                 -- token push (sha256 do segredo)
  token_prefixo   text,
  vault_secret_id uuid,                  -- token do provedor (Meta/WhatsApp)
  validada_em     timestamptz,           -- validação real com o provedor
  ultimo_lead_em  timestamptz,
  ultimo_erro     text,
  ultimo_erro_em  timestamptz,
  criado_por      uuid references public.profiles (id) on delete set null,
  revogada_em     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, funil_id) references public.funis (tenant_id, id),
  foreign key (tenant_id, etapa_id) references public.etapas_funil (tenant_id, id),
  foreign key (tenant_id, nicho_id) references public.nichos (tenant_id, id),
  foreign key (tenant_id, formulario_id) references public.formularios (tenant_id, id)
);
create index fontes_leads_tenant_idx on public.fontes_leads (tenant_id);
-- Uma página/número do provedor pertence a uma só fonte não revogada (de qualquer empresa).
create unique index fontes_leads_meta_pagina on public.fontes_leads ((configuracao ->> 'page_id'))
  where tipo = 'meta_lead_ads' and status <> 'revogada';
create unique index fontes_leads_whatsapp_numero on public.fontes_leads ((configuracao ->> 'phone_number_id'))
  where tipo = 'whatsapp_cloud' and status <> 'revogada';

create table public.ingestao_eventos (
  id             bigserial primary key,
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  fonte_id       uuid not null,
  external_id    text,
  resultado      text not null check (resultado in ('criado', 'atualizado', 'recusado', 'erro')),
  negociacao_id  uuid,
  erro_codigo    text,
  erro_mensagem  text,
  recebido_em    timestamptz not null default now(),
  foreign key (tenant_id, fonte_id) references public.fontes_leads (tenant_id, id) on delete cascade
);
create index ingestao_eventos_fonte_idx on public.ingestao_eventos (fonte_id, recebido_em desc);
create index ingestao_eventos_tenant_idx on public.ingestao_eventos (tenant_id, recebido_em desc);

create trigger fontes_leads_set_updated_at before update on public.fontes_leads
  for each row execute function public.set_updated_at();
create trigger zz_tenant_30_usuarios after insert or update on public.fontes_leads
  for each row execute function public.tenant_validar_usuarios('responsavel_id', 'criado_por');

alter table public.fontes_leads enable row level security;
alter table public.ingestao_eventos enable row level security;
revoke all on public.fontes_leads from anon, authenticated;
revoke all on public.ingestao_eventos from anon, authenticated;
-- Nunca hash, nem referência do Vault.
grant select (id, tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id, nicho_id, formulario_id,
              configuracao, token_prefixo, validada_em, ultimo_lead_em, ultimo_erro, ultimo_erro_em,
              criado_por, revogada_em, created_at, updated_at)
  on public.fontes_leads to authenticated;
grant select on public.ingestao_eventos to authenticated;
create policy fontes_leads_select on public.fontes_leads for select to authenticated
  using (tenant_id = (select public.tenant_atual()) and public.is_gerente());
create policy ingestao_eventos_select on public.ingestao_eventos for select to authenticated
  using (tenant_id = (select public.tenant_atual()) and public.is_gerente());

-- ---------------------------------------------------------------------------
-- Regras da fonte: funil/etapa coerentes, plano, limites
-- ---------------------------------------------------------------------------
create function public.recurso_da_fonte(p_tipo public.fonte_lead_tipo)
returns text
language sql
immutable
set search_path = ''
as $$ select case when p_tipo = 'whatsapp_cloud' then 'whatsapp' else 'ingestao_leads' end $$;

create function public.fontes_leads_regras()
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
  v_uso   integer;
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

  -- Plano: recurso e limite só quando a fonte passa a ativa.
  if new.status = 'ativa' and (tg_op = 'INSERT' or old.status <> 'ativa') then
    v_plano := public.plano_da_empresa(new.tenant_id);
    if v_plano.id is not null then
      if not (public.recurso_da_fonte(new.tipo) = any (v_plano.recursos)) then
        raise exception 'Recurso "%" não incluído no plano %.', public.recurso_da_fonte(new.tipo), v_plano.nome
          using errcode = 'RX003';
      end if;
      if v_plano.limite_integracoes is not null then
        perform 1 from public.tenants where id = new.tenant_id for update;
        v_uso := public.uso_integracoes(new.tenant_id);
        if v_uso >= v_plano.limite_integracoes then
          raise exception 'Limite de integrações do plano atingido (%).', v_plano.limite_integracoes using errcode = 'RX002';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger fontes_leads_regras before insert or update on public.fontes_leads
  for each row execute function public.fontes_leads_regras();

-- Integrações em uso passam a contar as fontes ativas.
create or replace function public.uso_integracoes(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.ingestao_credenciais c where c.tenant_id = p_tenant and c.ativo)::integer
       + (select count(*) from public.agenda_google_conexao g where g.tenant_id = p_tenant)::integer
       + (select count(*) from public.fontes_leads f where f.tenant_id = p_tenant and f.status = 'ativa')::integer;
$$;

-- ---------------------------------------------------------------------------
-- Normalização
-- ---------------------------------------------------------------------------
create function public.normalizar_telefone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when d is null or d = '' then null
           when length(d) in (10, 11) then '55' || d        -- celular/fixo BR sem DDI
           when length(d) between 12 and 13 then d
           else null                                       -- fora do formato aceito: descartado
         end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

create function public.normalizar_email(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then v end
    from (select lower(btrim(coalesce(p, ''))) as v) x;
$$;

create function public.normalizar_texto(p text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(left(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), p_max), '') $$;

-- ---------------------------------------------------------------------------
-- Núcleo (interno): destino explícito, já autenticado
-- ---------------------------------------------------------------------------
create function public.ingerir_lead_nucleo(
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

  -- Reenvio/concorrência do mesmo lead na mesma empresa: um por vez.
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

  if p_formulario is not null then
    for v_item in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) loop
      select p.id into v_pergunta_id
        from public.perguntas p
       where p.formulario_id = p_formulario and p.tenant_id = p_tenant and p.ativo
         and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');
      continue when v_pergunta_id is null;
      v_resposta := left(v_item ->> 'resposta', 5000);
      continue when v_resposta is null or btrim(v_resposta) = '';

      insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
      select v_negociacao_id, v_pergunta_id,
             case when p.tipo = 'texto_livre' then v_resposta end,
             case when p.tipo <> 'texto_livre' then v_resposta end
        from public.perguntas p
       where p.id = v_pergunta_id
      on conflict (negociacao_id, pergunta_id) do update
        set resposta_texto = excluded.resposta_texto, resposta_opcao = excluded.resposta_opcao;
    end loop;
  end if;

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;

revoke all on function public.ingerir_lead_nucleo(uuid, public.origem_negociacao, text, uuid, uuid, uuid, uuid, uuid,
  text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ingestão por fonte (registra o resultado; nunca levanta erro ao chamador)
-- ---------------------------------------------------------------------------
create function public.ingerir_lead_fonte(
  p_fonte uuid, p_external_id text, p_nome text, p_telefone text, p_email text,
  p_empresa text default null, p_instagram text default null,
  p_respostas jsonb default '[]'::jsonb, p_atribuicao jsonb default null)
returns table (resultado text, negociacao_id uuid, erro_codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f      public.fontes_leads;
  v_r      record;
  v_cod    text;
  v_msg    text;
  v_res    text;
begin
  select * into v_f from public.fontes_leads f where f.id = p_fonte for update;
  if v_f.id is null then
    return query select 'recusado'::text, null::uuid, 'fonte_desconhecida'::text;
    return;
  end if;

  if v_f.status <> 'ativa' then
    v_cod := 'fonte_' || v_f.status;
  elsif v_f.tipo in ('meta_lead_ads', 'whatsapp_cloud') and v_f.validada_em is null then
    v_cod := 'fonte_nao_validada';
  elsif not exists (select 1 from public.tenants t
                     where t.id = v_f.tenant_id and t.tipo <> 'arquivo' and t.status in ('ativo', 'teste')) then
    v_cod := 'empresa_indisponivel';
  end if;

  if v_cod is not null then
    insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, erro_codigo)
    values (v_f.tenant_id, v_f.id, left(p_external_id, 300), 'recusado', v_cod);
    return query select 'recusado'::text, null::uuid, v_cod;
    return;
  end if;

  begin
    select * into v_r from public.ingerir_lead_nucleo(
      v_f.tenant_id,
      case when v_f.tipo = 'whatsapp_cloud' then 'whatsapp' else 'formulario' end::public.origem_negociacao,
      v_f.id::text || ':' || coalesce(p_external_id, ''),
      v_f.funil_id, v_f.etapa_id, v_f.responsavel_id, v_f.nicho_id, v_f.formulario_id,
      p_nome, p_telefone, p_email, p_empresa, p_instagram, p_respostas,
      coalesce(p_atribuicao, '{}'::jsonb) || jsonb_build_object('fonte', v_f.tipo, 'fonte_id', v_f.id));
    v_res := case when v_r.criado then 'criado' else 'atualizado' end;
  exception when others then
    get stacked diagnostics v_cod = returned_sqlstate, v_msg = message_text;
    insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, erro_codigo, erro_mensagem)
    values (v_f.tenant_id, v_f.id, left(p_external_id, 300), 'erro', v_cod, left(v_msg, 300));
    update public.fontes_leads set ultimo_erro = left(v_msg, 300), ultimo_erro_em = now() where id = v_f.id;
    return query select 'erro'::text, null::uuid, v_cod;
    return;
  end;

  insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, negociacao_id)
  values (v_f.tenant_id, v_f.id, left(p_external_id, 300), v_res, v_r.negociacao_id);
  update public.fontes_leads set ultimo_lead_em = now() where id = v_f.id;
  return query select v_res, v_r.negociacao_id, null::text;
end;
$$;

revoke all on function public.ingerir_lead_fonte(uuid, text, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingerir_lead_fonte(uuid, text, text, text, text, text, text, jsonb, jsonb) to service_role;

-- Token push → fonte (webhook, Respondi, Google Sheets). Só service_role.
create function public.fonte_por_token(p_token text)
returns table (id uuid, tipo public.fonte_lead_tipo, configuracao jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m text[] := regexp_match(coalesce(p_token, ''), '^rx7f_([0-9a-f]{32})_([0-9a-f]{64})$');
begin
  if v_m is null then
    return;
  end if;
  return query
    select f.id, f.tipo, f.configuracao
      from public.fontes_leads f
     where f.id = v_m[1]::uuid
       and f.tipo in ('webhook', 'respondi', 'google_sheets')
       and f.segredo_hash = sha256(convert_to(v_m[2], 'UTF8'));
end;
$$;

-- Página/número da Meta → fonte VALIDADA. Só service_role.
create function public.fonte_por_provedor(p_tipo public.fonte_lead_tipo, p_ref text)
returns table (id uuid, vault_secret_id uuid, configuracao jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.vault_secret_id, f.configuracao
    from public.fontes_leads f
   where f.tipo = p_tipo
     and f.status = 'ativa'
     and f.validada_em is not null
     and p_tipo in ('meta_lead_ads', 'whatsapp_cloud')
     and f.configuracao ->> (case when p_tipo = 'meta_lead_ads' then 'page_id' else 'phone_number_id' end) = p_ref;
$$;

-- Token do provedor (Vault). Só service_role.
create function public.fonte_segredo_provedor(p_fonte uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s text;
begin
  select s.decrypted_secret::text into v_s
    from public.fontes_leads f
    join vault.decrypted_secrets s on s.id = f.vault_secret_id
   where f.id = p_fonte and f.status <> 'revogada';
  return v_s;
end;
$$;

-- Validação real com o provedor (feita pela Edge Function com o token da fonte).
create function public.marcar_fonte_validada(p_fonte uuid, p_valida boolean, p_erro text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fontes_leads
     set validada_em = case when p_valida then now() end,
         ultimo_erro = case when p_valida then null else left(p_erro, 300) end,
         ultimo_erro_em = case when p_valida then null else now() end
   where id = p_fonte and status <> 'revogada';
$$;

do $$
declare
  v_f text;
begin
  foreach v_f in array array['public.fonte_por_token(text)', 'public.fonte_por_provedor(public.fonte_lead_tipo, text)',
                             'public.fonte_segredo_provedor(uuid)', 'public.marcar_fonte_validada(uuid, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_f);
    execute format('grant execute on function %s to service_role', v_f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Formulário RX7 (página pública do próprio CRM): anon, sem segredo
-- ---------------------------------------------------------------------------
create function public.formulario_rx7_publico(p_fonte uuid)
returns table (nome text, empresa text, ativo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.nome, t.nome, (f.status = 'ativa' and t.status in ('ativo', 'teste'))
    from public.fontes_leads f join public.tenants t on t.id = f.tenant_id
   where f.id = p_fonte and f.tipo = 'formulario_rx7' and f.status <> 'revogada';
$$;

create function public.enviar_formulario_rx7(
  p_fonte uuid, p_envio uuid, p_nome text, p_telefone text, p_email text,
  p_empresa text default null, p_mensagem text default null, p_isca text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.fontes_leads;
  v_n integer;
  v_r record;
begin
  select * into v_f from public.fontes_leads f where f.id = p_fonte and f.tipo = 'formulario_rx7';
  if v_f.id is null or p_envio is null then
    return false;
  end if;
  -- Isca (campo invisível) preenchida = robô: finge sucesso, não grava lead.
  if coalesce(btrim(p_isca), '') <> '' then
    insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, erro_codigo)
    values (v_f.tenant_id, v_f.id, p_envio::text, 'recusado', 'isca');
    return true;
  end if;
  -- Limite por fonte: 30 envios por minuto.
  select count(*) into v_n from public.ingestao_eventos e
   where e.fonte_id = v_f.id and e.recebido_em > now() - interval '1 minute';
  if v_n >= 30 then
    insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, erro_codigo)
    values (v_f.tenant_id, v_f.id, p_envio::text, 'recusado', 'limite_por_minuto');
    return false;
  end if;

  select * into v_r from public.ingerir_lead_fonte(
    v_f.id, p_envio::text, p_nome, p_telefone, p_email, p_empresa, null,
    '[]'::jsonb,
    case when public.normalizar_texto(p_mensagem, 2000) is not null
         then jsonb_build_object('mensagem', public.normalizar_texto(p_mensagem, 2000)) end);
  return v_r.resultado in ('criado', 'atualizado');
end;
$$;

revoke all on function public.formulario_rx7_publico(uuid) from public;
revoke all on function public.enviar_formulario_rx7(uuid, uuid, text, text, text, text, text, text) from public;
grant execute on function public.formulario_rx7_publico(uuid) to anon, authenticated;
grant execute on function public.enviar_formulario_rx7(uuid, uuid, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gestão pelo admin_empresa (empresa da requisição)
-- ---------------------------------------------------------------------------
create function public.exigir_admin_empresa()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa']::public.tenant_papel[])
     or not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Somente o administrador da empresa gerencia as fontes de leads.' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

create function public.configuracao_fonte_valida(p_tipo public.fonte_lead_tipo, p_cfg jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
begin
  p_cfg := coalesce(p_cfg, '{}'::jsonb);
  if p_tipo = 'meta_lead_ads' then
    if coalesce(p_cfg ->> 'page_id', '') !~ '^[0-9]{5,30}$' then
      raise exception 'Informe o ID numérico da página do Facebook.' using errcode = '22023';
    end if;
    v := jsonb_build_object('page_id', p_cfg ->> 'page_id');
    if coalesce(p_cfg ->> 'form_id', '') ~ '^[0-9]{5,30}$' then
      v := v || jsonb_build_object('form_id', p_cfg ->> 'form_id');
    end if;
  elsif p_tipo = 'whatsapp_cloud' then
    if coalesce(p_cfg ->> 'phone_number_id', '') !~ '^[0-9]{5,30}$' then
      raise exception 'Informe o Phone Number ID do WhatsApp Cloud API.' using errcode = '22023';
    end if;
    v := jsonb_build_object('phone_number_id', p_cfg ->> 'phone_number_id');
  elsif p_tipo = 'respondi' and jsonb_typeof(p_cfg -> 'campos') = 'object' then
    -- Mapa opcional: { campos: { nome: "título", telefone: "título", email: "título", empresa: "título" } }
    v := jsonb_build_object('campos', (
      select coalesce(jsonb_object_agg(k, left(p_cfg -> 'campos' ->> k, 300)), '{}'::jsonb)
        from unnest(array['nome', 'telefone', 'email', 'empresa']) k
       where p_cfg -> 'campos' ? k));
  end if;
  return v;
end;
$$;

create function public.criar_fonte_lead(
  p_tipo public.fonte_lead_tipo, p_nome text, p_funil uuid, p_etapa uuid, p_responsavel uuid,
  p_configuracao jsonb default '{}'::jsonb)
returns table (id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := public.exigir_admin_empresa();
  v_id      uuid := gen_random_uuid();
  v_segredo text;
  v_token   text;
begin
  if p_tipo in ('webhook', 'respondi', 'google_sheets') then
    v_segredo := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    v_token := 'rx7f_' || replace(v_id::text, '-', '') || '_' || v_segredo;
  end if;

  insert into public.fontes_leads (id, tenant_id, tipo, nome, funil_id, etapa_id, responsavel_id, configuracao,
                                   segredo_hash, token_prefixo, criado_por)
  values (v_id, v_tenant, p_tipo, btrim(p_nome), p_funil, p_etapa, coalesce(p_responsavel, (select auth.uid())),
          public.configuracao_fonte_valida(p_tipo, p_configuracao),
          case when v_segredo is not null then sha256(convert_to(v_segredo, 'UTF8')) end,
          case when v_token is not null then left(v_token, 13) end,
          (select auth.uid()));

  return query select v_id, v_token;
end;
$$;

create function public.atualizar_fonte_lead(
  p_id uuid, p_nome text, p_funil uuid, p_etapa uuid, p_responsavel uuid, p_configuracao jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_admin_empresa();
  v_f      public.fontes_leads;
  v_cfg    jsonb;
begin
  select * into v_f from public.fontes_leads f where f.id = p_id and f.tenant_id = v_tenant for update;
  if v_f.id is null or v_f.status = 'revogada' then
    raise exception 'Fonte não encontrada.' using errcode = 'P0002';
  end if;
  v_cfg := case when p_configuracao is null then v_f.configuracao
                else public.configuracao_fonte_valida(v_f.tipo, p_configuracao) end;
  update public.fontes_leads
     set nome = btrim(p_nome), funil_id = p_funil, etapa_id = p_etapa, responsavel_id = p_responsavel,
         configuracao = v_cfg,
         -- Trocar página/número exige validar de novo com o provedor.
         validada_em = case when v_cfg is distinct from v_f.configuracao then null else validada_em end
   where id = p_id and tenant_id = v_tenant;
end;
$$;

create function public.definir_status_fonte(p_id uuid, p_status public.fonte_lead_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_admin_empresa();
begin
  if p_status = 'revogada' then
    raise exception 'Use revogar_fonte_lead.' using errcode = '22023';
  end if;
  update public.fontes_leads set status = p_status where id = p_id and tenant_id = v_tenant and status <> 'revogada';
  if not found then
    raise exception 'Fonte não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- Revogar: para de receber na hora, apaga o hash do token e o segredo do provedor.
create function public.revogar_fonte_lead(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_admin_empresa();
  v_secret uuid;
begin
  select f.vault_secret_id into v_secret
    from public.fontes_leads f
   where f.id = p_id and f.tenant_id = v_tenant and f.status <> 'revogada'
     for update;
  if not found then
    raise exception 'Fonte não encontrada.' using errcode = 'P0002';
  end if;
  update public.fontes_leads
     set status = 'revogada', revogada_em = now(), segredo_hash = null, validada_em = null,
         vault_secret_id = null
   where id = p_id;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

-- Novo token (o anterior deixa de valer imediatamente).
create function public.girar_token_fonte(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := public.exigir_admin_empresa();
  v_segredo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token   text := 'rx7f_' || replace(p_id::text, '-', '') || '_' || v_segredo;
begin
  update public.fontes_leads
     set segredo_hash = sha256(convert_to(v_segredo, 'UTF8')), token_prefixo = left(v_token, 13)
   where id = p_id and tenant_id = v_tenant and status <> 'revogada'
     and tipo in ('webhook', 'respondi', 'google_sheets');
  if not found then
    raise exception 'Fonte não encontrada ou sem token.' using errcode = 'P0002';
  end if;
  return v_token;
end;
$$;

-- Token do provedor (Meta/WhatsApp) → Vault. Nunca volta para a tela.
create function public.definir_segredo_fonte(p_id uuid, p_segredo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_admin_empresa();
  v_f      public.fontes_leads;
  v_secret uuid;
begin
  select * into v_f from public.fontes_leads f where f.id = p_id and f.tenant_id = v_tenant for update;
  if v_f.id is null or v_f.status = 'revogada' or v_f.tipo not in ('meta_lead_ads', 'whatsapp_cloud') then
    raise exception 'Fonte não encontrada.' using errcode = 'P0002';
  end if;
  if p_segredo is null or length(btrim(p_segredo)) < 20 or length(p_segredo) > 2000 then
    raise exception 'Token do provedor inválido.' using errcode = '22023';
  end if;
  if v_f.vault_secret_id is not null and exists (select 1 from vault.secrets s where s.id = v_f.vault_secret_id) then
    perform vault.update_secret(v_f.vault_secret_id, btrim(p_segredo));
    v_secret := v_f.vault_secret_id;
  else
    v_secret := vault.create_secret(btrim(p_segredo),
      'fonte_lead_' || replace(p_id::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
      'Token do provedor da fonte de leads ' || p_id);
  end if;
  update public.fontes_leads set vault_secret_id = v_secret, validada_em = null where id = p_id;
end;
$$;

do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.exigir_admin_empresa()',
    'public.criar_fonte_lead(public.fonte_lead_tipo, text, uuid, uuid, uuid, jsonb)',
    'public.atualizar_fonte_lead(uuid, text, uuid, uuid, uuid, jsonb)',
    'public.definir_status_fonte(uuid, public.fonte_lead_status)',
    'public.revogar_fonte_lead(uuid)', 'public.girar_token_fonte(uuid)', 'public.definir_segredo_fonte(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_f);
    execute format('grant execute on function %s to authenticated', v_f);
  end loop;
  foreach v_f in array array['public.fontes_leads_regras()', 'public.configuracao_fonte_valida(public.fonte_lead_tipo, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_f);
  end loop;
end $$;
