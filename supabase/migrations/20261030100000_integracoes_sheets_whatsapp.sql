set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- =============================================================================
-- Integrações por empresa: Google Sheets (OAuth) e WhatsApp oficial (Cloud API)
-- =============================================================================
-- Reaproveita o que já existe:
--   * fontes_leads = a integração/fonte com o DESTINO (funil, etapa inicial,
--     responsável), validado por fontes_leads_regras (etapa aberta e ativa do
--     funil, responsável membro ativo, recurso do plano) e pelo gatilho geral
--     de responsáveis (nunca Super Admin);
--   * múltiplos funis reais por empresa (funis + etapas_funil.funil_id);
--   * Vault do Supabase para segredos (refresh token do Google, token da Meta):
--     só funções security definer, chamadas pela Edge Function (service_role),
--     leem o segredo; nada vai para o navegador nem para tabela legível;
--   * conversas/mensagens (histórico preservado).
--
-- Novo:
--   1. Estado OAuth de uso único (Google e Meta), por empresa e usuário.
--   2. Contas Google conectadas por empresa (refresh token no Vault).
--   3. Planilhas conectadas (fonte google_sheets): aba, mapeamento, fila de
--      sincronização com reserva (lease) e recuo em erro; linhas já vistas por
--      chave estável (idempotência).
--   4. Regra explícita para contato que já existe (ingerir_lead_integracao).
--   5. Números WhatsApp oficiais por empresa (phone_number_id único), conversas
--      por número, mensagens com status e idempotência por ID da Meta.
--   6. Controle de custo: política "somente gratuitos" por padrão, janela de
--      24 h, limite diário local com trava, bloqueio automático se a Meta
--      indicar cobrança; mensagens pagas desligadas na plataforma.
--   7. Destino protegido: funil/etapa/responsável em uso por integração não
--      podem ser desativados; mudanças de destino auditadas.
--
-- Nada existente é apagado ou reescrito. Só local até autorização.
-- =============================================================================

alter type public.status_mensagem add value if not exists 'entregue';
alter type public.status_mensagem add value if not exists 'lido';

-- ---------------------------------------------------------------------------
-- 00. Chave da plataforma por integração. Nasce TUDO DESLIGADO: nenhuma
--     integração funciona só porque a migration foi aplicada ou porque algum
--     segredo foi cadastrado. Ligar é um passo explícito do dono da plataforma
--     (SQL com service_role/postgres), auditado.
-- ---------------------------------------------------------------------------
create table public.plataforma_integracoes (
  id                boolean primary key default true check (id),
  google_sheets     boolean not null default false,
  whatsapp_oficial  boolean not null default false,
  meta_conversoes   boolean not null default false,
  atualizado_em     timestamptz not null default now()
);
insert into public.plataforma_integracoes default values;
alter table public.plataforma_integracoes enable row level security;
revoke all on public.plataforma_integracoes from public, anon, authenticated;

create function public.plataforma_integracoes_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'plataforma_integracoes_alterada', null,
          jsonb_build_object('antes', to_jsonb(old) - 'atualizado_em', 'depois', to_jsonb(new) - 'atualizado_em'));
  return new;
end;
$$;
revoke all on function public.plataforma_integracoes_auditar() from public, anon, authenticated;
create trigger plataforma_integracoes_auditar before update on public.plataforma_integracoes
  for each row execute function public.plataforma_integracoes_auditar();

-- Liberação restrita (homologação): a integração funciona SÓ nas empresas desta
-- lista enquanto a chave global estiver desligada. Começa vazia.
create table public.plataforma_integracoes_empresas (
  tipo         text not null check (tipo in ('google_sheets', 'whatsapp_oficial', 'meta_conversoes')),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  liberado_em  timestamptz not null default now(),
  primary key (tipo, tenant_id)
);
alter table public.plataforma_integracoes_empresas enable row level security;
revoke all on public.plataforma_integracoes_empresas from public, anon, authenticated;

create function public.plataforma_integracoes_empresas_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), case tg_op when 'DELETE' then 'plataforma_integracao_empresa_retirada' else 'plataforma_integracao_empresa_liberada' end,
          coalesce(new.tenant_id, old.tenant_id), jsonb_build_object('tipo', coalesce(new.tipo, old.tipo)));
  return null;
end;
$$;
revoke all on function public.plataforma_integracoes_empresas_auditar() from public, anon, authenticated;
create trigger plataforma_integracoes_empresas_auditar after insert or delete on public.plataforma_integracoes_empresas
  for each row execute function public.plataforma_integracoes_empresas_auditar();

-- Ligada = chave global OU empresa liberada na lista de homologação.
create function public.integracao_habilitada(p_tipo text, p_tenant uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case p_tipo when 'google_sheets' then p.google_sheets
                                      when 'whatsapp_oficial' then p.whatsapp_oficial
                                      when 'meta_conversoes' then p.meta_conversoes end
                     from public.plataforma_integracoes p), false)
      or (p_tenant is not null
          and exists (select 1 from public.plataforma_integracoes_empresas e where e.tipo = p_tipo and e.tenant_id = p_tenant));
$$;

create function public.exigir_integracao_habilitada(p_tipo text, p_tenant uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.integracao_habilitada(p_tipo, p_tenant) then
    raise exception 'Esta integração ainda não foi liberada na plataforma.' using errcode = 'RX030';
  end if;
end;
$$;

-- Leitura para as telas (empresa da aba; só booleanos, nada sensível).
create function public.integracoes_habilitadas()
returns table (google_sheets boolean, whatsapp_oficial boolean, meta_conversoes boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select public.integracao_habilitada('google_sheets', public.tenant_atual()),
         public.integracao_habilitada('whatsapp_oficial', public.tenant_atual()),
         public.integracao_habilitada('meta_conversoes', public.tenant_atual());
$$;

-- ---------------------------------------------------------------------------
-- 0. Quem administra integrações: Administrador da empresa (admin_empresa ou
--    gerente) — inclusive o Super Admin dentro do acesso global auditado.
-- ---------------------------------------------------------------------------
create function public.exigir_administrador_integracoes()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa', 'gerente']::public.tenant_papel[])
     or not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Somente o Administrador da empresa gerencia as integrações.' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

-- Sem JWT (callback do provedor): o usuário que iniciou ainda administra a empresa?
create function public.usuario_administra_integracoes(p_user uuid, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.tenant_memberships m join public.profiles p on p.id = m.user_id
            where m.tenant_id = p_tenant and m.user_id = p_user and m.ativo and p.ativo
              and m.papel in ('admin_empresa', 'gerente')
              and not public.eh_super_admin(p_user))
      or (public.eh_super_admin(p_user)
          and exists (select 1 from public.super_admin_acessos a
                       where a.user_id = p_user and a.tenant_id = p_tenant
                         and a.encerrado_em is null and a.expira_em > now()));
$$;

-- ---------------------------------------------------------------------------
-- 1. Estado OAuth (uso único, 10 min)
-- ---------------------------------------------------------------------------
create table public.integracoes_oauth_estados (
  nonce      text primary key check (nonce ~ '^[0-9a-f]{64}$'),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  provedor   text not null check (provedor in ('google', 'meta')),
  retorno    text not null default '/configuracoes/integracoes' check (retorno ~ '^/[A-Za-z0-9_-][A-Za-z0-9/_?=&.-]*$' and retorno !~ '//' and length(retorno) <= 200),
  expira_em  timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
alter table public.integracoes_oauth_estados enable row level security;
revoke all on public.integracoes_oauth_estados from public, anon, authenticated;

-- Chamado COMO o usuário (JWT + empresa da aba): só o Administrador inicia.
create function public.integracao_criar_estado(p_provedor text, p_retorno text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_nonce  text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform public.exigir_integracao_habilitada(case p_provedor when 'google' then 'google_sheets' else 'whatsapp_oficial' end, v_tenant);
  delete from public.integracoes_oauth_estados where expira_em < now();
  insert into public.integracoes_oauth_estados (nonce, tenant_id, usuario_id, provedor, retorno)
  values (v_nonce, v_tenant, (select auth.uid()), p_provedor, coalesce(nullif(p_retorno, ''), '/configuracoes/integracoes'));
  return v_nonce;
end;
$$;

-- Serviço (callback): consome uma vez; só devolve se ainda vale.
create function public.integracao_consumir_estado(p_nonce text)
returns table (tenant_id uuid, usuario_id uuid, provedor text, retorno text)
language sql
security definer
set search_path = ''
as $$
  delete from public.integracoes_oauth_estados e
   where e.nonce = p_nonce and e.expira_em > now()
  returning e.tenant_id, e.usuario_id, e.provedor, e.retorno;
$$;

-- ---------------------------------------------------------------------------
-- 2. Contas Google por empresa
-- ---------------------------------------------------------------------------
create table public.integracoes_contas_google (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  conta_email     text not null check (length(conta_email) <= 254 and conta_email ~ '^[^@\s]+@[^@\s]+$'),
  escopos         text[] not null,
  vault_secret_id uuid,
  conectado_por   uuid references auth.users (id) on delete set null,
  conectado_em    timestamptz not null default now(),
  revogada_em     timestamptz,
  ultimo_erro     text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  ultimo_erro_em  timestamptz,
  unique (tenant_id, conta_email),
  unique (tenant_id, id)
);
alter table public.integracoes_contas_google enable row level security;
revoke all on public.integracoes_contas_google from public, anon, authenticated;

create function public.google_salvar_conta(p_tenant uuid, p_usuario uuid, p_email text, p_refresh_token text, p_escopos text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_secret uuid;
begin
  perform public.exigir_integracao_habilitada('google_sheets', p_tenant);
  if not public.usuario_administra_integracoes(p_usuario, p_tenant) then
    raise exception 'Usuário não administra as integrações desta empresa.' using errcode = '42501';
  end if;
  if p_refresh_token is null or length(p_refresh_token) < 10 then
    raise exception 'O Google não devolveu autorização permanente: autorize de novo.' using errcode = '22023';
  end if;
  select c.id, c.vault_secret_id into v_id, v_secret from public.integracoes_contas_google c
   where c.tenant_id = p_tenant and c.conta_email = lower(p_email) for update;
  if v_secret is not null and exists (select 1 from vault.secrets s where s.id = v_secret) then
    perform vault.update_secret(v_secret, p_refresh_token);
  else
    v_secret := vault.create_secret(p_refresh_token, null, 'google-sheets ' || p_tenant::text);
  end if;
  insert into public.integracoes_contas_google (tenant_id, conta_email, escopos, vault_secret_id, conectado_por)
  values (p_tenant, lower(p_email), p_escopos, v_secret, p_usuario)
  on conflict (tenant_id, conta_email) do update
     set escopos = excluded.escopos, vault_secret_id = excluded.vault_secret_id, conectado_por = excluded.conectado_por,
         conectado_em = now(), revogada_em = null, ultimo_erro = null, ultimo_erro_em = null
  returning id into v_id;
  -- Reconectar a mesma conta: planilhas paradas por autorização voltam para a fila;
  -- as desconectadas pelo Administrador ficam pausadas até ele retomar.
  update public.fontes_google_sheets g
     set situacao = 'ativa', falhas_seguidas = 0, proxima_sincronizacao_em = now(), bloqueado_ate = null
   where g.conta_id = v_id and g.situacao = 'erro_autorizacao';
  update public.fontes_google_sheets g
     set situacao = 'pausada'
    from public.fontes_leads f
   where g.conta_id = v_id and g.situacao = 'desconectada' and f.id = g.fonte_id and f.status <> 'revogada';
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (p_usuario, 'integracao_google_conectada', p_tenant, jsonb_build_object('conta', v_id, 'escopos', p_escopos));
  return v_id;
end;
$$;

create function public.google_obter_refresh_token(p_conta uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::text
    from public.integracoes_contas_google c
    join vault.decrypted_secrets s on s.id = c.vault_secret_id
   where c.id = p_conta and c.revogada_em is null;
$$;

-- Autorização recusada pelo Google: TODAS as planilhas dessa conta param juntas
-- (cada uma bateria no Google só para falhar igual) até o Administrador reconectar.
-- plpgsql (não sql): o corpo cita fontes_google_sheets, criada mais abaixo nesta migration.
create function public.google_registrar_erro_conta(p_conta uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integracoes_contas_google set ultimo_erro = left(p_erro, 300), ultimo_erro_em = now() where id = p_conta;
  update public.fontes_google_sheets
     set situacao = 'erro_autorizacao', ultimo_erro = left(p_erro, 300), ultimo_erro_em = now()
   where conta_id = p_conta and situacao in ('aguardando', 'ativa', 'erro');
end;
$$;

-- Administrador: confere se pode desconectar (a Edge Function revoga no Google antes de remover).
create function public.google_preparar_desconexao(p_conta uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
begin
  if not exists (select 1 from public.integracoes_contas_google c where c.id = p_conta and c.tenant_id = v_tenant and c.revogada_em is null) then
    raise exception 'Conta Google não encontrada nesta empresa.' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

create function public.google_remover_conta(p_conta uuid, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.integracoes_contas_google;
begin
  select * into v_c from public.integracoes_contas_google where id = p_conta for update;
  if v_c.id is null then return; end if;
  if v_c.vault_secret_id is not null then delete from vault.secrets where id = v_c.vault_secret_id; end if;
  update public.integracoes_contas_google set revogada_em = now(), vault_secret_id = null where id = p_conta;
  update public.fontes_google_sheets set situacao = 'desconectada', bloqueado_ate = null where conta_id = p_conta;
  update public.fontes_leads f set status = 'pausada'
    from public.fontes_google_sheets g where g.fonte_id = f.id and g.conta_id = p_conta and f.status = 'ativa';
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (p_usuario, 'integracao_google_desconectada', v_c.tenant_id, jsonb_build_object('conta', p_conta));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Planilhas conectadas (uma fonte google_sheets cada)
-- ---------------------------------------------------------------------------
create table public.fontes_google_sheets (
  fonte_id                 uuid primary key,
  tenant_id                uuid not null,
  conta_id                 uuid not null,
  planilha_id              text not null check (planilha_id ~ '^[A-Za-z0-9_-]{20,120}$'),
  planilha_nome            text not null check (length(planilha_nome) between 1 and 200),
  aba_id                   bigint not null,
  aba_nome                 text not null check (length(aba_nome) between 1 and 100),
  linha_cabecalho          integer not null default 1 check (linha_cabecalho between 1 and 50),
  mapeamento               jsonb not null check (jsonb_typeof(mapeamento) = 'object'
                                                 and (mapeamento ? 'telefone' or mapeamento ? 'email')),
  coluna_chave             text check (coluna_chave is null or length(coluna_chave) <= 100),
  importar_existentes      boolean not null default false,
  situacao                 text not null default 'aguardando'
                           check (situacao in ('aguardando', 'ativa', 'pausada', 'erro', 'erro_autorizacao', 'desconectada')),
  intervalo_minutos        integer not null default 10 check (intervalo_minutos between 5 and 1440),
  proxima_sincronizacao_em timestamptz not null default now(),
  bloqueado_ate            timestamptz,
  falhas_seguidas          integer not null default 0,
  ultima_sincronizacao_em  timestamptz,
  ultimo_sucesso_em        timestamptz,
  ultimo_pedido_manual_em  timestamptz,
  ultimo_erro              text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  ultimo_erro_em           timestamptz,
  linhas_lidas             integer not null default 0,
  total_importados         integer not null default 0,
  total_existentes         integer not null default 0,
  total_erros              integer not null default 0,
  created_at               timestamptz not null default now(),
  foreign key (tenant_id, fonte_id) references public.fontes_leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, conta_id) references public.integracoes_contas_google (tenant_id, id)
);
create index fontes_google_sheets_fila on public.fontes_google_sheets (proxima_sincronizacao_em) where situacao in ('aguardando', 'ativa', 'erro');
alter table public.fontes_google_sheets enable row level security;
revoke all on public.fontes_google_sheets from public, anon, authenticated;

-- Linhas já vistas por fonte (idempotência): chave estável, nunca só o número da linha.
create table public.fontes_google_sheets_linhas (
  fonte_id       uuid not null references public.fontes_google_sheets (fonte_id) on delete cascade,
  chave          text not null check (length(chave) between 1 and 200),
  resultado      text not null check (resultado in ('importada', 'contato_existente', 'ignorada_inicial', 'invalida', 'erro')),
  negociacao_id  uuid,
  linha          integer,
  tentativas     integer not null default 1,
  ultimo_erro    text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  primeira_vez_em timestamptz not null default now(),
  ultima_vez_em  timestamptz not null default now(),
  primary key (fonte_id, chave)
);
alter table public.fontes_google_sheets_linhas enable row level security;
revoke all on public.fontes_google_sheets_linhas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Regra explícita para quem já é cliente (integrações)
-- ---------------------------------------------------------------------------
-- * Planilha: contato já é cliente E tem negociação ABERTA no mesmo funil →
--   não cria outra; só registra a origem adicional (sem mudar funil/etapa).
--   Sem negociação aberta naquele funil → nova negociação no destino da fonte.
-- * WhatsApp: contato já é cliente → nenhuma negociação nova (a conversa só é
--   vinculada ao cliente). Contato novo → cliente + negociação no destino.
-- Registra o resultado em ingestao_eventos (sem dados pessoais).
create function public.ingerir_lead_integracao(
  p_fonte uuid, p_external_id text, p_nome text, p_telefone text, p_email text, p_empresa text, p_atribuicao jsonb)
returns table (resultado text, cliente_id uuid, negociacao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_f      public.fontes_leads;
  v_tel    text := public.normalizar_telefone(p_telefone);
  v_email  text := public.normalizar_email(p_email);
  v_cli    uuid;
  v_neg    uuid;
  v_res    text;
  v_origem public.origem_negociacao;
  v_r      record;
  v_neg_re uuid;
  v_cli_re uuid;
begin
  select * into v_f from public.fontes_leads f where f.id = p_fonte;
  if v_f.id is null or v_f.status <> 'ativa' or v_f.tipo not in ('google_sheets', 'whatsapp_cloud') then
    raise exception 'Integração inativa ou inexistente.' using errcode = '42501';
  end if;
  v_origem := case when v_f.tipo = 'whatsapp_cloud' then 'whatsapp' else 'formulario' end;

  if v_tel is not null or v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_f.tenant_id::text || ':contato:' || coalesce(v_tel, '') || '|' || coalesce(v_email, ''), 0));
    select c.id into v_cli from public.clientes c
     where c.tenant_id = v_f.tenant_id and c.deleted_at is null
       and ((v_tel is not null and (c.telefone = v_tel or c.whatsapp = v_tel)) or (v_email is not null and lower(c.email) = v_email))
     order by c.created_at limit 1;
  end if;

  -- Já existe a negociação desta mesma linha/mensagem (reenvio): devolve a mesma.
  -- (variáveis próprias: SELECT INTO sem linha zera o destino)
  select n.id, n.cliente_id into v_neg_re, v_cli_re
    from public.negociacoes n
   where n.tenant_id = v_f.tenant_id and n.origem = v_origem and n.external_id = v_f.id::text || ':' || p_external_id;
  if v_neg_re is not null then
    return query select 'reenvio'::text, v_cli_re, v_neg_re;
    return;
  end if;

  if v_cli is not null then
    if v_f.tipo = 'whatsapp_cloud' then
      v_res := 'contato_existente';
    else
      select n.id into v_neg
        from public.negociacoes n join public.etapas_funil e on e.id = n.etapa_id
       where n.tenant_id = v_f.tenant_id and n.cliente_id = v_cli and e.funil_id = v_f.funil_id and e.tipo = 'aberta'
         and n.excluida_em is null and n.arquivada_em is null
       order by n.created_at desc limit 1;
      if v_neg is not null then v_res := 'contato_existente'; end if;
    end if;
    if v_res = 'contato_existente' then
      if v_neg is not null then
        update public.negociacoes
           set atribuicao = jsonb_set(coalesce(atribuicao, '{}'::jsonb), '{origens_adicionais}',
                 coalesce(atribuicao -> 'origens_adicionais', '[]'::jsonb)
                 || jsonb_build_array(jsonb_build_object('fonte_id', v_f.id, 'fonte', v_f.tipo, 'em', now())))
         where id = v_neg;
      end if;
      insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, negociacao_id)
      values (v_f.tenant_id, v_f.id, left(p_external_id, 300), 'atualizado', v_neg);
      update public.fontes_leads set ultimo_lead_em = now() where id = v_f.id;
      return query select 'contato_existente'::text, v_cli, v_neg;
      return;
    end if;
  end if;

  select * into v_r from public.ingerir_lead_nucleo(
    v_f.tenant_id, v_origem, v_f.id::text || ':' || p_external_id,
    v_f.funil_id, v_f.etapa_id, v_f.responsavel_id, v_f.nicho_id, v_f.formulario_id,
    p_nome, p_telefone, p_email, p_empresa, null, null,
    coalesce(p_atribuicao, '{}'::jsonb) || jsonb_build_object('fonte', v_f.tipo, 'fonte_id', v_f.id));
  insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, negociacao_id)
  values (v_f.tenant_id, v_f.id, left(p_external_id, 300), case when v_r.criado then 'criado' else 'atualizado' end, v_r.negociacao_id);
  update public.fontes_leads set ultimo_lead_em = now() where id = v_f.id;
  return query select case when v_r.criado then 'importada' else 'contato_existente' end, v_r.cliente_id, v_r.negociacao_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3b. Planilhas: administração (Administrador) e fila (serviço)
-- ---------------------------------------------------------------------------
create function public.sheets_criar_fonte(
  p_conta uuid, p_planilha_id text, p_planilha_nome text, p_aba_id bigint, p_aba_nome text, p_linha_cabecalho integer,
  p_mapeamento jsonb, p_coluna_chave text, p_importar_existentes boolean,
  p_nome text, p_funil uuid, p_etapa uuid, p_responsavel uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_id     uuid := gen_random_uuid();
begin
  perform public.exigir_integracao_habilitada('google_sheets', v_tenant);
  if not exists (select 1 from public.integracoes_contas_google c where c.id = p_conta and c.tenant_id = v_tenant and c.revogada_em is null) then
    raise exception 'Conta Google não encontrada nesta empresa.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.fontes_google_sheets g join public.fontes_leads f on f.id = g.fonte_id
              where g.tenant_id = v_tenant and g.planilha_id = p_planilha_id and g.aba_id = p_aba_id and f.status <> 'revogada') then
    raise exception 'Esta aba já está conectada nesta empresa.' using errcode = '23505';
  end if;
  -- Destino (funil/etapa/responsável) validado por fontes_leads_regras e tenant_validar_usuarios.
  insert into public.fontes_leads (id, tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id, configuracao, criado_por)
  values (v_id, v_tenant, 'google_sheets', btrim(p_nome), 'ativa', p_funil, p_etapa, p_responsavel, '{}'::jsonb, (select auth.uid()));
  insert into public.fontes_google_sheets (fonte_id, tenant_id, conta_id, planilha_id, planilha_nome, aba_id, aba_nome,
                                           linha_cabecalho, mapeamento, coluna_chave, importar_existentes)
  values (v_id, v_tenant, p_conta, p_planilha_id, left(btrim(p_planilha_nome), 200), p_aba_id, left(btrim(p_aba_nome), 100),
          coalesce(p_linha_cabecalho, 1), p_mapeamento, nullif(btrim(coalesce(p_coluna_chave, '')), ''), coalesce(p_importar_existentes, false));
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'integracao_criada', v_tenant,
          jsonb_build_object('fonte', v_id, 'tipo', 'google_sheets', 'funil', p_funil, 'etapa', p_etapa, 'responsavel', p_responsavel));
  return v_id;
end;
$$;

-- Destino de qualquer integração (planilha ou WhatsApp): nunca move leads antigos.
create function public.integracao_alterar_destino(p_fonte uuid, p_funil uuid, p_etapa uuid, p_responsavel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_antes  public.fontes_leads;
begin
  select * into v_antes from public.fontes_leads where id = p_fonte and tenant_id = v_tenant and tipo in ('google_sheets', 'whatsapp_cloud') for update;
  if v_antes.id is null then
    raise exception 'Integração não encontrada nesta empresa.' using errcode = 'P0002';
  end if;
  -- A auditoria (antes/depois) fica no gatilho fontes_leads_auditar_destino: vale para qualquer caminho.
  update public.fontes_leads set funil_id = p_funil, etapa_id = p_etapa, responsavel_id = p_responsavel where id = p_fonte;
end;
$$;

-- Toda mudança de destino de uma conexão oficial é auditada, venha de onde vier.
create function public.fontes_leads_auditar_destino()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tipo in ('google_sheets', 'whatsapp_cloud')
     and (old.funil_id, old.etapa_id, old.responsavel_id) is distinct from (new.funil_id, new.etapa_id, new.responsavel_id) then
    insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
    values ((select auth.uid()), 'integracao_destino_alterado', new.tenant_id,
            jsonb_build_object('fonte', new.id, 'tipo', new.tipo,
              'antes', jsonb_build_object('funil', old.funil_id, 'etapa', old.etapa_id, 'responsavel', old.responsavel_id),
              'depois', jsonb_build_object('funil', new.funil_id, 'etapa', new.etapa_id, 'responsavel', new.responsavel_id)));
  end if;
  return null;
end;
$$;
revoke all on function public.fontes_leads_auditar_destino() from public, anon, authenticated;
create trigger zz_fontes_leads_auditar_destino after update on public.fontes_leads
  for each row execute function public.fontes_leads_auditar_destino();

create function public.sheets_acao(p_fonte uuid, p_acao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_g      public.fontes_google_sheets;
begin
  select * into v_g from public.fontes_google_sheets where fonte_id = p_fonte and tenant_id = v_tenant for update;
  if v_g.fonte_id is null then
    raise exception 'Planilha não encontrada nesta empresa.' using errcode = 'P0002';
  end if;
  if p_acao = 'pausar' then
    update public.fontes_leads set status = 'pausada' where id = p_fonte and status = 'ativa';
    update public.fontes_google_sheets set situacao = 'pausada', bloqueado_ate = null where fonte_id = p_fonte;
  elsif p_acao = 'retomar' then
    if v_g.situacao = 'desconectada' then
      raise exception 'A conta Google foi desconectada: conecte de novo antes de retomar.' using errcode = '23514';
    end if;
    update public.fontes_leads set status = 'ativa' where id = p_fonte and status = 'pausada';
    update public.fontes_google_sheets set situacao = 'ativa', falhas_seguidas = 0, proxima_sincronizacao_em = now() where fonte_id = p_fonte;
  elsif p_acao = 'sincronizar_agora' then
    if v_g.ultimo_pedido_manual_em > now() - interval '1 minute' then
      raise exception 'Aguarde um minuto entre sincronizações manuais.' using errcode = 'RX010';
    end if;
    update public.fontes_google_sheets set proxima_sincronizacao_em = now(), ultimo_pedido_manual_em = now() where fonte_id = p_fonte;
  elsif p_acao = 'reprocessar_erros' then
    delete from public.fontes_google_sheets_linhas where fonte_id = p_fonte and resultado = 'erro';
    update public.fontes_google_sheets set proxima_sincronizacao_em = now() where fonte_id = p_fonte;
  elsif p_acao = 'remover' then
    update public.fontes_leads set status = 'revogada', revogada_em = now() where id = p_fonte and status <> 'revogada';
    update public.fontes_google_sheets set situacao = 'desconectada', bloqueado_ate = null where fonte_id = p_fonte;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'integracao_' || p_acao, v_tenant, jsonb_build_object('fonte', p_fonte, 'tipo', 'google_sheets'));
end;
$$;

-- Serviço: reserva um lote da fila (concorrência segura: SKIP LOCKED + lease).
create function public.sheets_reservar(p_limite integer default 5, p_lease_segundos integer default 300, p_fonte uuid default null)
returns table (fonte_id uuid, tenant_id uuid, conta_id uuid, planilha_id text, aba_nome text, linha_cabecalho integer,
               mapeamento jsonb, coluna_chave text, importar_existentes boolean, primeira boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with lote as (
    select g.fonte_id
      from public.fontes_google_sheets g
      join public.fontes_leads f on f.id = g.fonte_id
      join public.integracoes_contas_google c on c.id = g.conta_id
      join public.tenants t on t.id = g.tenant_id
     where g.situacao in ('aguardando', 'ativa', 'erro')
       and f.status = 'ativa' and c.revogada_em is null and public.integracao_habilitada('google_sheets', g.tenant_id)
       and t.tipo <> 'arquivo' and t.status in ('ativo', 'teste')
       and g.proxima_sincronizacao_em <= now()
       and (g.bloqueado_ate is null or g.bloqueado_ate < now())
       and (p_fonte is null or g.fonte_id = p_fonte)
     order by g.proxima_sincronizacao_em
     limit least(greatest(coalesce(p_limite, 5), 1), 50)
     for update of g skip locked
  )
  update public.fontes_google_sheets g
     set bloqueado_ate = now() + make_interval(secs => least(greatest(coalesce(p_lease_segundos, 300), 30), 900))
    from lote
   where g.fonte_id = lote.fonte_id
  returning g.fonte_id, g.tenant_id, g.conta_id, g.planilha_id, g.aba_nome, g.linha_cabecalho, g.mapeamento,
            g.coluna_chave, g.importar_existentes, g.ultimo_sucesso_em is null;
end;
$$;

-- Serviço: processa as linhas lidas (já mapeadas pela Edge Function).
-- p_linhas: [{chave, linha, nome, telefone, email, empresa}]
create function public.sheets_processar_linhas(p_fonte uuid, p_linhas jsonb, p_primeira boolean)
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
  v_exist    integer := 0;
  v_ignor    integer := 0;
  v_invalid  integer := 0;
  v_erros    integer := 0;
  v_baseline boolean;
begin
  select * into v_g from public.fontes_google_sheets where fonte_id = p_fonte;
  if v_g.fonte_id is null then raise exception 'Planilha inexistente.' using errcode = 'P0002'; end if;
  v_baseline := coalesce(p_primeira, false) and not v_g.importar_existentes;

  for v_item in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_chave := left(btrim(coalesce(v_item ->> 'chave', '')), 200);
    continue when v_chave = '';
    select * into v_visto from public.fontes_google_sheets_linhas where fonte_id = p_fonte and chave = v_chave;
    -- Já vista: não reimporta nem sobrescreve (mesmo que a linha tenha mudado), salvo erro a repetir.
    continue when v_visto.fonte_id is not null and (v_visto.resultado <> 'erro' or v_visto.tentativas >= 5);

    if v_baseline then
      insert into public.fontes_google_sheets_linhas (fonte_id, chave, resultado, linha)
      values (p_fonte, v_chave, 'ignorada_inicial', (v_item ->> 'linha')::integer)
      on conflict (fonte_id, chave) do nothing;
      v_ignor := v_ignor + 1;
      continue;
    end if;

    begin
      select * into v_r from public.ingerir_lead_integracao(
        p_fonte, 'gs:' || v_chave, v_item ->> 'nome', v_item ->> 'telefone', v_item ->> 'email', v_item ->> 'empresa',
        jsonb_build_object('planilha', v_g.planilha_nome, 'aba', v_g.aba_nome));
      insert into public.fontes_google_sheets_linhas (fonte_id, chave, resultado, negociacao_id, linha)
      values (p_fonte, v_chave, case when v_r.resultado in ('importada') then 'importada' else 'contato_existente' end,
              v_r.negociacao_id, (v_item ->> 'linha')::integer)
      on conflict (fonte_id, chave) do update
        set resultado = excluded.resultado, negociacao_id = excluded.negociacao_id, ultimo_erro = null, ultima_vez_em = now();
      if v_r.resultado = 'importada' then v_import := v_import + 1; else v_exist := v_exist + 1; end if;
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
     set total_importados = total_importados + v_import, total_existentes = total_existentes + v_exist,
         total_erros = total_erros + v_erros + v_invalid
   where fonte_id = p_fonte;
  return jsonb_build_object('importadas', v_import, 'existentes', v_exist, 'ignoradas_inicio', v_ignor,
                            'invalidas', v_invalid, 'erros', v_erros);
end;
$$;

-- Serviço: fecha a rodada (sucesso → próximo intervalo; erro → recuo exponencial até 6 h).
create function public.sheets_concluir(p_fonte uuid, p_ok boolean, p_erro text, p_linhas_lidas integer, p_autorizacao boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.fontes_google_sheets;
begin
  select * into v_g from public.fontes_google_sheets where fonte_id = p_fonte for update;
  if v_g.fonte_id is null then return; end if;
  if p_ok then
    update public.fontes_google_sheets
       set situacao = case when situacao in ('aguardando', 'erro') then 'ativa' else situacao end,
           ultima_sincronizacao_em = now(), ultimo_sucesso_em = now(), falhas_seguidas = 0,
           linhas_lidas = coalesce(p_linhas_lidas, linhas_lidas), bloqueado_ate = null,
           proxima_sincronizacao_em = now() + make_interval(mins => intervalo_minutos)
     where fonte_id = p_fonte;
    update public.fontes_leads set ultimo_erro = null where id = p_fonte;
  else
    update public.fontes_google_sheets
       set situacao = case when p_autorizacao then 'erro_autorizacao' else 'erro' end,
           ultima_sincronizacao_em = now(), falhas_seguidas = falhas_seguidas + 1,
           ultimo_erro = left(p_erro, 300), ultimo_erro_em = now(), bloqueado_ate = null,
           proxima_sincronizacao_em = now() + least(interval '6 hours', make_interval(mins => intervalo_minutos * (2 ^ least(falhas_seguidas, 6))::integer))
     where fonte_id = p_fonte;
    update public.fontes_leads set ultimo_erro = left(p_erro, 300), ultimo_erro_em = now() where id = p_fonte;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. WhatsApp oficial (Cloud API) por empresa
-- ---------------------------------------------------------------------------
-- Regras comerciais da plataforma (Super Admin): mensagens pagas desligadas.
create table public.plataforma_regras_whatsapp (
  id                       smallint primary key default 1 check (id = 1),
  permitir_mensagens_pagas boolean not null default false,
  atualizado_em            timestamptz not null default now(),
  atualizado_por           uuid references auth.users (id) on delete set null
);
insert into public.plataforma_regras_whatsapp (id) values (1);
alter table public.plataforma_regras_whatsapp enable row level security;
revoke all on public.plataforma_regras_whatsapp from public, anon, authenticated;

create table public.whatsapp_numeros (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id) on delete restrict,
  fonte_id                uuid not null unique,
  phone_number_id         text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id                 text not null check (waba_id ~ '^[0-9]{5,30}$'),
  numero_exibicao         text check (numero_exibicao is null or length(numero_exibicao) <= 40),
  nome_verificado         text check (nome_verificado is null or length(nome_verificado) <= 200),
  vault_secret_id         uuid,
  situacao                text not null default 'conectado' check (situacao in ('conectado', 'pausado', 'desconectado')),
  politica_envio          text not null default 'somente_gratuitos' check (politica_envio in ('somente_gratuitos', 'permitir_pagos')),
  limite_envios_dia       integer not null default 200 check (limite_envios_dia between 0 and 10000),
  bloqueado_por_cobranca  boolean not null default false,
  pagos_autorizados_por   uuid references auth.users (id) on delete set null,
  pagos_autorizados_em    timestamptz,
  conectado_por           uuid references auth.users (id) on delete set null,
  conectado_em            timestamptz not null default now(),
  ultimo_evento_em        timestamptz,
  ultimo_erro             text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  ultimo_erro_em          timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, fonte_id) references public.fontes_leads (tenant_id, id)
);
alter table public.whatsapp_numeros enable row level security;
revoke all on public.whatsapp_numeros from public, anon, authenticated;

create table public.whatsapp_consumo (
  numero_id           uuid not null references public.whatsapp_numeros (id) on delete cascade,
  dia                 date not null,
  recebidas           integer not null default 0,
  enviadas_gratuitas  integer not null default 0,
  bloqueadas          integer not null default 0,
  cobrancas_meta      integer not null default 0,
  primary key (numero_id, dia)
);
alter table public.whatsapp_consumo enable row level security;
revoke all on public.whatsapp_consumo from public, anon, authenticated;

-- Conversas e mensagens: por NÚMERO (uma empresa pode ter vários). Histórico fica como está.
alter table public.conversas
  add column whatsapp_numero_id uuid,
  add column nome_contato text check (nome_contato is null or length(nome_contato) <= 200),
  add column ultima_entrada_em timestamptz,
  add column atendente_id uuid references public.profiles (id) on delete set null,
  add constraint conversas_numero_fk foreign key (tenant_id, whatsapp_numero_id) references public.whatsapp_numeros (tenant_id, id);
drop index public.conversas_telefone_unica_tenant;
create unique index conversas_telefone_unica_tenant on public.conversas (tenant_id, telefone) where whatsapp_numero_id is null;
create unique index conversas_telefone_unica_numero on public.conversas (whatsapp_numero_id, telefone) where whatsapp_numero_id is not null;

alter table public.mensagens
  add column whatsapp_numero_id uuid,
  add column cobravel boolean,
  add column categoria_cobranca text check (categoria_cobranca is null or length(categoria_cobranca) <= 40),
  add column status_detalhe text check (status_detalhe is null or length(status_detalhe) <= 300),
  add column status_atualizado_em timestamptz,
  add constraint mensagens_numero_fk foreign key (tenant_id, whatsapp_numero_id) references public.whatsapp_numeros (tenant_id, id);
create unique index mensagens_wa_id_por_numero on public.mensagens (whatsapp_numero_id, whatsapp_message_id)
  where whatsapp_numero_id is not null and whatsapp_message_id is not null;

-- Serviço (Embedded Signup concluído): número + destino + token no Vault.
create function public.whatsapp_salvar_numero(
  p_tenant uuid, p_usuario uuid, p_phone_number_id text, p_waba_id text, p_numero_exibicao text, p_nome_verificado text,
  p_token text, p_nome text, p_funil uuid, p_etapa uuid, p_responsavel uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existente public.whatsapp_numeros;
  v_fonte     uuid := gen_random_uuid();
  v_secret    uuid;
  v_id        uuid;
begin
  perform public.exigir_integracao_habilitada('whatsapp_oficial', p_tenant);
  if not public.usuario_administra_integracoes(p_usuario, p_tenant) then
    raise exception 'Usuário não administra as integrações desta empresa.' using errcode = '42501';
  end if;
  select * into v_existente from public.whatsapp_numeros where phone_number_id = p_phone_number_id for update;
  if v_existente.id is not null and v_existente.tenant_id <> p_tenant and v_existente.situacao <> 'desconectado' then
    raise exception 'Este número já está conectado a outra empresa.' using errcode = '23505';
  end if;
  if v_existente.id is not null and v_existente.tenant_id <> p_tenant then
    raise exception 'Este número pertenceu a outra empresa: fale com o suporte da plataforma para liberá-lo.' using errcode = '23505';
  end if;
  v_secret := vault.create_secret(p_token, null, 'whatsapp ' || p_tenant::text);

  if v_existente.id is null then
    insert into public.fontes_leads (id, tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id, configuracao,
                                     validada_em, criado_por)
    values (v_fonte, p_tenant, 'whatsapp_cloud', left(btrim(coalesce(p_nome, 'WhatsApp')), 80), 'ativa', p_funil, p_etapa, p_responsavel,
            jsonb_build_object('phone_number_id', p_phone_number_id), now(), p_usuario);
    insert into public.whatsapp_numeros (tenant_id, fonte_id, phone_number_id, waba_id, numero_exibicao, nome_verificado,
                                         vault_secret_id, conectado_por)
    values (p_tenant, v_fonte, p_phone_number_id, p_waba_id, left(p_numero_exibicao, 40), left(p_nome_verificado, 200), v_secret, p_usuario)
    returning id into v_id;
  else
    -- Reconexão do mesmo número na mesma empresa: troca o token, mantém o histórico.
    if v_existente.vault_secret_id is not null then delete from vault.secrets where id = v_existente.vault_secret_id; end if;
    update public.whatsapp_numeros
       set waba_id = p_waba_id, numero_exibicao = left(p_numero_exibicao, 40), nome_verificado = left(p_nome_verificado, 200),
           vault_secret_id = v_secret, situacao = 'conectado', conectado_por = p_usuario, conectado_em = now(),
           ultimo_erro = null, ultimo_erro_em = null
     where id = v_existente.id
    returning id, fonte_id into v_id, v_fonte;
    update public.fontes_leads set status = 'ativa', funil_id = p_funil, etapa_id = p_etapa, responsavel_id = p_responsavel,
                                   validada_em = now()
     where id = v_fonte and status <> 'revogada';
  end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (p_usuario, 'integracao_whatsapp_conectada', p_tenant,
          jsonb_build_object('numero', v_id, 'fonte', v_fonte, 'funil', p_funil, 'etapa', p_etapa, 'responsavel', p_responsavel));
  return v_id;
end;
$$;

create function public.whatsapp_obter_token(p_numero uuid)
returns table (token text, phone_number_id text, tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::text, n.phone_number_id, n.tenant_id
    from public.whatsapp_numeros n join vault.decrypted_secrets s on s.id = n.vault_secret_id
   where n.id = p_numero and n.situacao = 'conectado';
$$;

-- Serviço: mensagem recebida (webhook assinado). Idempotente pelo ID da Meta.
create function public.whatsapp_registrar_entrada(
  p_phone_number_id text, p_wa_message_id text, p_de text, p_nome text, p_tipo text, p_texto text, p_recebida_em timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n       public.whatsapp_numeros;
  v_f       public.fontes_leads;
  v_tel     text := public.normalizar_telefone(p_de);
  v_conv    uuid;
  v_cli     uuid;
  v_msg     uuid;
  v_lead    text := 'nenhum';
  v_r       record;
  v_conteudo text;
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null then
    return jsonb_build_object('ignorado', 'numero_desconhecido');
  end if;
  if v_n.situacao = 'desconectado' then
    return jsonb_build_object('ignorado', 'numero_desconectado');
  end if;
  if v_tel is null or p_wa_message_id is null then
    raise exception 'Mensagem sem remetente ou identificador.' using errcode = '22023';
  end if;
  update public.whatsapp_numeros set ultimo_evento_em = now() where id = v_n.id;

  perform pg_advisory_xact_lock(hashtextextended(v_n.id::text || ':' || v_tel, 0));
  select c.id, c.cliente_id into v_conv, v_cli from public.conversas c where c.whatsapp_numero_id = v_n.id and c.telefone = v_tel;
  if v_conv is null then
    insert into public.conversas (tenant_id, telefone, whatsapp_numero_id, nome_contato, ultima_mensagem_em, ultima_entrada_em, escopo)
    values (v_n.tenant_id, v_tel, v_n.id, left(p_nome, 200), coalesce(p_recebida_em, now()), coalesce(p_recebida_em, now()), 'rx7')
    returning id into v_conv;
  end if;

  v_conteudo := case when p_tipo = 'text' then coalesce(nullif(btrim(p_texto), ''), '[mensagem vazia]')
                     else '[' || coalesce(p_tipo, 'mídia') || ' recebido — visualização ainda não disponível no AVANTE]' end;
  insert into public.mensagens (tenant_id, conversa_id, direcao, tipo, conteudo, whatsapp_message_id, whatsapp_numero_id,
                                status, created_at)
  values (v_n.tenant_id, v_conv, 'entrada', 'texto', left(v_conteudo, 4096), p_wa_message_id, v_n.id, 'enviado',
          coalesce(p_recebida_em, now()))
  on conflict (whatsapp_numero_id, whatsapp_message_id) where whatsapp_numero_id is not null and whatsapp_message_id is not null
  do nothing
  returning id into v_msg;
  if v_msg is null then
    return jsonb_build_object('duplicada', true, 'conversa', v_conv);
  end if;

  update public.conversas
     set ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, '-infinity'), coalesce(p_recebida_em, now())),
         ultima_entrada_em = greatest(coalesce(ultima_entrada_em, '-infinity'), coalesce(p_recebida_em, now())),
         nome_contato = coalesce(nome_contato, left(p_nome, 200))
   where id = v_conv;
  insert into public.whatsapp_consumo (numero_id, dia, recebidas) values (v_n.id, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (numero_id, dia) do update set recebidas = public.whatsapp_consumo.recebidas + 1;

  -- Cliente: só da MESMA empresa. Novo contato vira lead no destino configurado.
  if v_cli is null then
    select * into v_f from public.fontes_leads where id = v_n.fonte_id;
    if v_f.status = 'ativa' and v_n.situacao = 'conectado' then
      begin
        select * into v_r from public.ingerir_lead_integracao(v_f.id, 'wa:' || v_tel, coalesce(p_nome, v_tel), v_tel, null, null,
                                                              jsonb_build_object('numero', v_n.numero_exibicao));
        v_cli := v_r.cliente_id;
        v_lead := v_r.resultado;
      exception when others then
        v_lead := 'erro';
        update public.whatsapp_numeros set ultimo_erro = left(sqlerrm, 300), ultimo_erro_em = now() where id = v_n.id;
      end;
    else
      select c.id into v_cli from public.clientes c
       where c.tenant_id = v_n.tenant_id and c.deleted_at is null and (c.telefone = v_tel or c.whatsapp = v_tel)
       order by c.created_at limit 1;
    end if;
    if v_cli is not null then
      update public.conversas set cliente_id = v_cli where id = v_conv and cliente_id is null;
    end if;
  end if;
  return jsonb_build_object('conversa', v_conv, 'mensagem', v_msg, 'lead', v_lead, 'cliente', v_cli);
end;
$$;

-- Serviço: status da Meta (sent/delivered/read/failed) e indicação de cobrança.
create function public.whatsapp_registrar_status(
  p_phone_number_id text, p_wa_message_id text, p_status text, p_cobravel boolean, p_categoria text, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n    public.whatsapp_numeros;
  v_msg  public.mensagens;
  v_novo public.status_mensagem;
  v_ordem constant text[] := array['pendente', 'enviando', 'enviado', 'entregue', 'lido'];
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null then return jsonb_build_object('ignorado', 'numero_desconhecido'); end if;
  select * into v_msg from public.mensagens where whatsapp_numero_id = v_n.id and whatsapp_message_id = p_wa_message_id for update;
  if v_msg.id is null then return jsonb_build_object('ignorado', 'mensagem_desconhecida'); end if;
  v_novo := case p_status when 'sent' then 'enviado' when 'delivered' then 'entregue' when 'read' then 'lido' when 'failed' then 'falhou' end;
  if v_novo is not null and (v_novo = 'falhou' or array_position(v_ordem, v_novo::text) > coalesce(array_position(v_ordem, v_msg.status::text), 0)) then
    update public.mensagens set status = v_novo, status_detalhe = left(p_erro, 300), status_atualizado_em = now(),
                                cobravel = coalesce(p_cobravel, cobravel), categoria_cobranca = coalesce(left(p_categoria, 40), categoria_cobranca)
     where id = v_msg.id;
  else
    update public.mensagens set cobravel = coalesce(p_cobravel, cobravel), categoria_cobranca = coalesce(left(p_categoria, 40), categoria_cobranca)
     where id = v_msg.id;
  end if;
  -- A Meta indicou cobrança: conta e, na política "somente gratuitos", bloqueia novos envios.
  if coalesce(p_cobravel, false) then
    insert into public.whatsapp_consumo (numero_id, dia, cobrancas_meta) values (v_n.id, (now() at time zone 'America/Sao_Paulo')::date, 1)
    on conflict (numero_id, dia) do update set cobrancas_meta = public.whatsapp_consumo.cobrancas_meta + 1;
    if v_n.politica_envio = 'somente_gratuitos' and not v_n.bloqueado_por_cobranca then
      update public.whatsapp_numeros set bloqueado_por_cobranca = true where id = v_n.id;
      insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
      values (null, 'whatsapp_cobranca_detectada', v_n.tenant_id, jsonb_build_object('numero', v_n.id, 'categoria', p_categoria));
    end if;
  end if;
  return jsonb_build_object('mensagem', v_msg.id, 'status', coalesce(v_novo::text, v_msg.status::text));
end;
$$;

-- Usuário (JWT + empresa): prepara um envio. Decide no BANCO se é gratuito.
-- Só texto livre dentro da janela de 24 h aberta pela última mensagem do
-- contato (atendimento, sem custo pela regra da Meta). Fora da janela exigiria
-- modelo (cobrável): bloqueado. Limite diário com trava por número.
-- Bloqueio (janela, limite, cobrança) volta como RESULTADO, não como erro: o
-- contador de bloqueios precisa ficar gravado (um erro desfaria a contagem).
create function public.whatsapp_preparar_envio(p_conversa uuid, p_texto text)
returns table (mensagem_id uuid, numero_id uuid, phone_number_id text, destino text, bloqueio text, mensagem text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.tenant_exigir();
  v_uid    uuid := (select auth.uid());
  v_c      public.conversas;
  v_n      public.whatsapp_numeros;
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_usados integer;
  v_msg    uuid;
  v_bloqueio text;
begin
  select * into v_c from public.conversas where id = p_conversa and tenant_id = v_tenant;
  if v_c.id is null then raise exception 'Conversa não encontrada.' using errcode = 'P0002'; end if;
  -- Mesma regra de leitura das conversas: Administrador ou dono da carteira do cliente.
  if not (public.is_gerente() or exists (select 1 from public.clientes cl where cl.id = v_c.cliente_id and cl.owner_id = v_uid)) then
    raise exception 'Você não atende esta conversa.' using errcode = '42501';
  end if;
  if not public.pode_escrever_no_tenant(v_tenant) then raise exception 'Empresa somente leitura.' using errcode = '42501'; end if;
  if p_texto is null or btrim(p_texto) = '' or length(p_texto) > 4096 then
    raise exception 'Escreva a mensagem (até 4.096 caracteres).' using errcode = '22023';
  end if;
  select * into v_n from public.whatsapp_numeros where id = v_c.whatsapp_numero_id and tenant_id = v_tenant for update;
  if v_n.id is null then raise exception 'Esta conversa não é de um número WhatsApp oficial conectado.' using errcode = 'P0002'; end if;
  if v_n.situacao <> 'conectado' then raise exception 'O número está pausado ou desconectado.' using errcode = 'RX020'; end if;
  select coalesce(sum(enviadas_gratuitas), 0) into v_usados from public.whatsapp_consumo where numero_id = v_n.id and dia = v_hoje;
  v_bloqueio := case
    when v_n.bloqueado_por_cobranca then 'bloqueado_por_cobranca'
    when v_c.ultima_entrada_em is null or v_c.ultima_entrada_em < now() - interval '24 hours' then 'fora_da_janela'
    when v_usados >= v_n.limite_envios_dia then 'limite_diario'
  end;
  if v_bloqueio is not null then
    insert into public.whatsapp_consumo (numero_id, dia, bloqueadas) values (v_n.id, v_hoje, 1)
    on conflict (numero_id, dia) do update set bloqueadas = public.whatsapp_consumo.bloqueadas + 1;
    return query select null::uuid, v_n.id, null::text, null::text, v_bloqueio,
      case v_bloqueio
        when 'bloqueado_por_cobranca' then 'Envios bloqueados: a Meta indicou cobrança neste número. O Administrador precisa revisar.'
        when 'fora_da_janela' then 'Fora da janela de 24 h de atendimento: a mensagem exigiria um modelo pago. Envio bloqueado pela política "Somente gratuitos".'
        else format('Limite diário de envios deste número atingido (%s).', v_n.limite_envios_dia)
      end;
    return;
  end if;
  insert into public.whatsapp_consumo (numero_id, dia, enviadas_gratuitas) values (v_n.id, v_hoje, 1)
  on conflict (numero_id, dia) do update set enviadas_gratuitas = public.whatsapp_consumo.enviadas_gratuitas + 1;
  -- Já nasce "enviando" (nunca "pendente"): nenhum serviço antigo pega esta mensagem.
  insert into public.mensagens (tenant_id, conversa_id, direcao, tipo, conteudo, whatsapp_numero_id, status, autor_id, cobravel)
  values (v_tenant, v_c.id, 'saida', 'texto', btrim(p_texto), v_n.id, 'enviando', v_uid, false)
  returning id into v_msg;
  update public.conversas set ultima_mensagem_em = now(), atendente_id = coalesce(atendente_id, v_uid) where id = v_c.id;
  return query select v_msg, v_n.id, v_n.phone_number_id, v_c.telefone, null::text, null::text;
end;
$$;

create function public.whatsapp_confirmar_envio(p_mensagem uuid, p_wa_message_id text, p_ok boolean, p_erro text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.mensagens
     set whatsapp_message_id = case when p_ok then p_wa_message_id else whatsapp_message_id end,
         status = case when p_ok then 'enviado'::public.status_mensagem else 'falhou'::public.status_mensagem end,
         status_detalhe = case when p_ok then null else left(p_erro, 300) end,
         status_atualizado_em = now()
   where id = p_mensagem and status = 'enviando';
$$;

-- Janela de atendimento (para o aviso na tela). Mesma regra do envio.
create function public.whatsapp_janela(p_conversa uuid)
returns table (aberta boolean, aberta_ate timestamptz, motivo text)
language sql
stable
security definer
set search_path = ''
as $$
  select (c.ultima_entrada_em > now() - interval '24 hours') and n.situacao = 'conectado' and not n.bloqueado_por_cobranca,
         c.ultima_entrada_em + interval '24 hours',
         case when n.id is null then 'sem_numero'
              when n.situacao <> 'conectado' then 'numero_inativo'
              when n.bloqueado_por_cobranca then 'bloqueado_por_cobranca'
              when c.ultima_entrada_em is null or c.ultima_entrada_em <= now() - interval '24 hours' then 'fora_da_janela'
              else 'ok' end
    from public.conversas c left join public.whatsapp_numeros n on n.id = c.whatsapp_numero_id
   where c.id = p_conversa and c.tenant_id = public.tenant_atual()
     and (public.is_gerente() or exists (select 1 from public.clientes cl where cl.id = c.cliente_id and cl.owner_id = (select auth.uid())));
$$;

create function public.whatsapp_acao(p_numero uuid, p_acao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_n      public.whatsapp_numeros;
begin
  select * into v_n from public.whatsapp_numeros where id = p_numero and tenant_id = v_tenant for update;
  if v_n.id is null then raise exception 'Número não encontrado nesta empresa.' using errcode = 'P0002'; end if;
  if p_acao = 'pausar' then
    update public.whatsapp_numeros set situacao = 'pausado' where id = p_numero and situacao = 'conectado';
    update public.fontes_leads set status = 'pausada' where id = v_n.fonte_id and status = 'ativa';
  elsif p_acao = 'retomar' then
    if v_n.situacao = 'desconectado' then raise exception 'Conecte o número de novo.' using errcode = '23514'; end if;
    update public.whatsapp_numeros set situacao = 'conectado' where id = p_numero;
    update public.fontes_leads set status = 'ativa' where id = v_n.fonte_id and status = 'pausada';
  elsif p_acao = 'desconectar' then
    if v_n.vault_secret_id is not null then delete from vault.secrets where id = v_n.vault_secret_id; end if;
    update public.whatsapp_numeros set situacao = 'desconectado', vault_secret_id = null where id = p_numero;
    update public.fontes_leads set status = 'pausada' where id = v_n.fonte_id and status = 'ativa';
  elsif p_acao = 'revisar_cobranca' then
    -- O Administrador confirma que revisou o aviso da Meta; continua "somente gratuitos".
    update public.whatsapp_numeros set bloqueado_por_cobranca = false where id = p_numero;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'whatsapp_' || p_acao, v_tenant, jsonb_build_object('numero', p_numero));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Leitura para as telas (sem segredo)
-- ---------------------------------------------------------------------------
create function public.integracoes_da_empresa()
returns table (
  fonte_id uuid, tipo text, nome text, status text, situacao text, funil_id uuid, funil_nome text, etapa_id uuid, etapa_nome text,
  responsavel_id uuid, responsavel_nome text, detalhe text, conta text, ultima_sincronizacao_em timestamptz, proxima_sincronizacao_em timestamptz,
  importados integer, existentes integer, erros integer, ultimo_erro text, ultimo_lead_em timestamptz, numero_id uuid,
  bloqueado_por_cobranca boolean, limite_envios_dia integer, conta_id uuid, planilha_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.tipo::text, f.nome, f.status::text,
         coalesce(g.situacao, n.situacao, f.status::text),
         f.funil_id, fu.nome, f.etapa_id, e.nome, f.responsavel_id, p.nome,
         coalesce(g.planilha_nome || ' › ' || g.aba_nome, n.numero_exibicao || coalesce(' · ' || n.nome_verificado, '')),
         c.conta_email, g.ultima_sincronizacao_em, g.proxima_sincronizacao_em,
         coalesce(g.total_importados, 0), coalesce(g.total_existentes, 0), coalesce(g.total_erros, 0),
         coalesce(g.ultimo_erro, n.ultimo_erro, f.ultimo_erro), f.ultimo_lead_em, n.id, n.bloqueado_por_cobranca, n.limite_envios_dia,
         g.conta_id, g.planilha_id
    from public.fontes_leads f
    left join public.fontes_google_sheets g on g.fonte_id = f.id
    left join public.integracoes_contas_google c on c.id = g.conta_id
    left join public.whatsapp_numeros n on n.fonte_id = f.id
    left join public.funis fu on fu.id = f.funil_id
    left join public.etapas_funil e on e.id = f.etapa_id
    left join public.profiles p on p.id = f.responsavel_id
   where f.tenant_id = public.exigir_administrador_integracoes()
     and f.tipo in ('google_sheets', 'whatsapp_cloud')
     and (g.fonte_id is not null or n.id is not null)
   order by f.created_at;
$$;

create function public.google_contas_da_empresa()
returns table (id uuid, conta_email text, conectado_em timestamptz, ativa boolean, ultimo_erro text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.conta_email, c.conectado_em, c.revogada_em is null, c.ultimo_erro
    from public.integracoes_contas_google c
   where c.tenant_id = public.exigir_administrador_integracoes()
   order by c.conectado_em desc;
$$;

create function public.whatsapp_consumo_empresa(p_dias integer default 30)
returns table (numero_id uuid, numero text, dia date, recebidas integer, enviadas_gratuitas integer, bloqueadas integer, cobrancas_meta integer)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.numero_exibicao, c.dia, c.recebidas, c.enviadas_gratuitas, c.bloqueadas, c.cobrancas_meta
    from public.whatsapp_consumo c join public.whatsapp_numeros n on n.id = c.numero_id
   where n.tenant_id = public.exigir_administrador_integracoes()
     and c.dia >= (now() at time zone 'America/Sao_Paulo')::date - least(greatest(coalesce(p_dias, 30), 1), 366)
   order by c.dia desc;
$$;

-- Caixa de entrada do WhatsApp oficial: mesma regra de leitura das conversas
-- (Administrador vê todas; os demais só as de clientes da própria carteira).
create function public.whatsapp_caixa_entrada(p_limite integer default 100)
returns table (conversa_id uuid, numero_id uuid, numero text, telefone text, nome_contato text, cliente_id uuid, cliente_nome text,
               ultima_mensagem_em timestamptz, ultima_entrada_em timestamptz, previa text, previa_direcao text, atendente_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select cv.id, n.id, n.numero_exibicao, cv.telefone, cv.nome_contato, c.id, c.nome, cv.ultima_mensagem_em, cv.ultima_entrada_em,
         left(m.conteudo, 140), m.direcao::text, cv.atendente_id
    from public.conversas cv
    join public.whatsapp_numeros n on n.id = cv.whatsapp_numero_id
    left join public.clientes c on c.id = cv.cliente_id
    left join lateral (select mm.conteudo, mm.direcao from public.mensagens mm
                        where mm.conversa_id = cv.id order by mm.created_at desc limit 1) m on true
   where cv.tenant_id = public.tenant_atual()
     and (public.is_gerente() or c.owner_id = (select auth.uid()))
   order by cv.ultima_mensagem_em desc nulls last
   limit least(greatest(coalesce(p_limite, 100), 1), 300);
$$;

-- Super Admin (painel global): situação das integrações de uma empresa, sem segredos.
create function public.admin_integracoes_empresa(p_tenant uuid)
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
   order by f.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Destino protegido: sem integração órfã
-- ---------------------------------------------------------------------------
create function public.integracoes_protege_destino()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
begin
  -- Um bloco por tabela: o PL/pgSQL avalia a condição inteira, e "new" de cada
  -- tabela tem colunas diferentes.
  if tg_table_name = 'funis' then
    if old.ativo and not new.ativo then
      select f.nome into v_nome from public.fontes_leads f where f.funil_id = old.id and f.status <> 'revogada' limit 1;
    end if;
  elsif tg_table_name = 'etapas_funil' then
    if old.ativo and (not new.ativo or new.tipo <> 'aberta' or new.funil_id <> old.funil_id) then
      select f.nome into v_nome from public.fontes_leads f where f.etapa_id = old.id and f.status <> 'revogada' limit 1;
    end if;
  elsif tg_table_name = 'tenant_memberships' then
    if old.ativo and not new.ativo then
      select f.nome into v_nome from public.fontes_leads f
       where f.tenant_id = old.tenant_id and f.responsavel_id = old.user_id and f.status <> 'revogada' limit 1;
    end if;
  end if;
  if v_nome is not null then
    raise exception 'Em uso pela integração "%": escolha outro destino nela antes de continuar.', v_nome using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.integracoes_protege_destino() from public, anon, authenticated;
create trigger integracoes_protege_destino before update on public.funis
  for each row execute function public.integracoes_protege_destino();
create trigger integracoes_protege_destino before update on public.etapas_funil
  for each row execute function public.integracoes_protege_destino();
create trigger integracoes_protege_destino before update on public.tenant_memberships
  for each row execute function public.integracoes_protege_destino();

-- Conversa do número oficial: mensagem de saída só pelo envio controlado
-- (whatsapp_preparar_envio: permissão, janela gratuita, limite e cobrança).
-- A RLS deixa o usuário inserir 'pendente' em conversa que vê; aqui isso é
-- recusado para o WhatsApp oficial, e o antigo serviço nunca enxerga essas linhas.
create function public.mensagens_cloud_envio_controlado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direcao = 'saida' and new.status = 'pendente'
     and exists (select 1 from public.conversas cv where cv.id = new.conversa_id and cv.whatsapp_numero_id is not null) then
    raise exception 'Mensagens do WhatsApp oficial saem só pelo envio controlado do AVANTE.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.mensagens_cloud_envio_controlado() from public, anon, authenticated;
create trigger mensagens_cloud_envio_controlado before insert on public.mensagens
  for each row execute function public.mensagens_cloud_envio_controlado();

-- ---------------------------------------------------------------------------
-- 8. Permissões das funções
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  -- Só a Edge Function (service_role) chama estas.
  foreach f in array array[
    'public.usuario_administra_integracoes(uuid, uuid)',
    'public.integracao_habilitada(text, uuid)',
    'public.exigir_integracao_habilitada(text, uuid)',
    'public.integracao_consumir_estado(text)',
    'public.google_salvar_conta(uuid, uuid, text, text, text[])',
    'public.google_obter_refresh_token(uuid)',
    'public.google_registrar_erro_conta(uuid, text)',
    'public.google_remover_conta(uuid, uuid)',
    'public.ingerir_lead_integracao(uuid, text, text, text, text, text, jsonb)',
    'public.sheets_reservar(integer, integer, uuid)',
    'public.sheets_processar_linhas(uuid, jsonb, boolean)',
    'public.sheets_concluir(uuid, boolean, text, integer, boolean)',
    'public.whatsapp_salvar_numero(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid)',
    'public.whatsapp_obter_token(uuid)',
    'public.whatsapp_registrar_entrada(text, text, text, text, text, text, timestamptz)',
    'public.whatsapp_registrar_status(text, text, text, boolean, text, text)',
    'public.whatsapp_confirmar_envio(uuid, text, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Usuário logado (o banco confere empresa, cargo e regras).
  foreach f in array array[
    'public.exigir_administrador_integracoes()',
    'public.integracoes_habilitadas()',
    'public.integracao_criar_estado(text, text)',
    'public.google_preparar_desconexao(uuid)',
    'public.sheets_criar_fonte(uuid, text, text, bigint, text, integer, jsonb, text, boolean, text, uuid, uuid, uuid)',
    'public.integracao_alterar_destino(uuid, uuid, uuid, uuid)',
    'public.sheets_acao(uuid, text)',
    'public.whatsapp_preparar_envio(uuid, text)',
    'public.whatsapp_janela(uuid)',
    'public.whatsapp_acao(uuid, text)',
    'public.integracoes_da_empresa()',
    'public.google_contas_da_empresa()',
    'public.whatsapp_consumo_empresa(integer)',
    'public.whatsapp_caixa_entrada(integer)',
    'public.admin_integracoes_empresa(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
