set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Google Sheets "quase em tempo real": monitoramento oficial do Google Drive
-- (files.watch) para cada planilha conectada.
--
-- Fluxo:
--  1. Depois da 1ª sincronização, a Edge Function `integracoes` registra um
--     canal de aviso (files.watch) na planilha, com o MESMO OAuth (drive.file).
--  2. O Google chama POST /integracoes/google/notificacao quando o arquivo muda.
--     A função confere o token do canal (HMAC) e este banco confere canal,
--     recurso, empresa, liberação e situação da fonte: só então a planilha é
--     marcada para leitura imediata (proxima_sincronizacao_em = agora).
--  3. A leitura usa a fila que já existe (sheets_reservar: lease + SKIP LOCKED),
--     então idempotência, trava de concorrência e destino continuam iguais.
--  4. Canais duram no máximo 1 dia: o agendador renova antes de vencer e
--     encerra os de planilhas pausadas/desconectadas/não liberadas.
--  5. O agendador periódico continua como contingência (aviso perdido, atraso
--     do Google, canal recusado): nada depende só do aviso.
--
-- Nada muda em leads já importados. Nenhum dado de empresa é lido fora da
-- própria fonte. Tudo é service_role, exceto a leitura do painel (Administrador).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Estado do monitoramento na fonte
-- ---------------------------------------------------------------------------
alter table public.fontes_google_sheets
  add column monitoramento            text not null default 'desligado'
                                       check (monitoramento in ('desligado', 'ativando', 'ativo', 'indisponivel', 'erro')),
  add column monitoramento_desde      timestamptz,
  add column monitoramento_erro       text check (monitoramento_erro is null or length(monitoramento_erro) <= 300),
  add column monitoramento_erro_em    timestamptz,
  add column ultima_notificacao_em    timestamptz,
  add column notificacao_pendente_em  timestamptz;

comment on column public.fontes_google_sheets.notificacao_pendente_em is
  'Aviso do Google ainda não lido (limpo ao reservar; se chegar outro durante a leitura, a próxima é imediata).';

-- ---------------------------------------------------------------------------
-- 2. Canais de aviso (um por renovação; dois podem coexistir por alguns minutos)
-- ---------------------------------------------------------------------------
create table public.fontes_google_sheets_canais (
  id                    uuid primary key default gen_random_uuid(),   -- id do canal enviado ao Google
  tenant_id             uuid not null,
  fonte_id              uuid not null,
  conta_id              uuid not null,
  resource_id           text check (resource_id is null or resource_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  situacao              text not null default 'criando'
                        check (situacao in ('criando', 'ativo', 'substituido', 'encerrado', 'falhou')),
  expira_em             timestamptz,
  criado_em             timestamptz not null default now(),
  ativado_em            timestamptz,
  encerrado_em          timestamptz,
  motivo                text check (motivo is null or length(motivo) <= 300),
  notificacoes          integer not null default 0,
  ultima_notificacao_em timestamptz,
  foreign key (tenant_id, fonte_id) references public.fontes_leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, conta_id) references public.integracoes_contas_google (tenant_id, id)
);
create index fontes_google_sheets_canais_fonte_idx on public.fontes_google_sheets_canais (fonte_id, situacao);
create index fontes_google_sheets_canais_vivos_idx on public.fontes_google_sheets_canais (expira_em)
  where situacao in ('criando', 'ativo', 'substituido');

alter table public.fontes_google_sheets_canais enable row level security;
revoke all on public.fontes_google_sheets_canais from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Regras
-- ---------------------------------------------------------------------------
-- Mesmas condições da fila (sheets_reservar), sem olhar horário nem lease:
-- empresa liberada, fonte ativa, conta Google válida, empresa em uso.
create function public.sheets_fonte_monitoravel(p_fonte uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.fontes_google_sheets g
      join public.fontes_leads f on f.id = g.fonte_id and f.tenant_id = g.tenant_id
      join public.integracoes_contas_google c on c.id = g.conta_id and c.tenant_id = g.tenant_id
      join public.tenants t on t.id = g.tenant_id
     where g.fonte_id = p_fonte
       and g.situacao in ('ativa', 'erro')
       and g.ultimo_sucesso_em is not null           -- só depois da 1ª leitura bem-sucedida
       and f.status = 'ativa' and c.revogada_em is null
       and t.tipo <> 'arquivo' and t.status in ('ativo', 'teste')
       and public.integracao_habilitada('google_sheets', g.tenant_id)
  );
$$;

-- Tarefas do agendador para os canais: criar, renovar (= criar outro) e encerrar.
create function public.sheets_canais_tarefas(p_limite integer default 20, p_renovar_minutos integer default 120)
returns table (acao text, canal_id uuid, fonte_id uuid, conta_id uuid, planilha_id text, resource_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 100);
  v_renovar interval := make_interval(mins => least(greatest(coalesce(p_renovar_minutos, 120), 10), 720));
begin
  -- Vencidos: o Google já encerrou sozinho; só registra.
  update public.fontes_google_sheets_canais k
     set situacao = 'encerrado', encerrado_em = now(), motivo = coalesce(k.motivo, 'vencido')
   where k.situacao in ('ativo', 'substituido') and k.expira_em is not null and k.expira_em <= now();
  -- Criação que não terminou (queda no meio): libera para tentar de novo.
  update public.fontes_google_sheets_canais k
     set situacao = 'falhou', encerrado_em = now(), motivo = 'criação interrompida'
   where k.situacao = 'criando' and k.criado_em < now() - interval '5 minutes';
  -- Fonte sem canal vivo: o estado do painel volta a "desligado" (ou fica em erro/indisponível).
  update public.fontes_google_sheets g
     set monitoramento = 'desligado', monitoramento_desde = null
   where g.monitoramento in ('ativo', 'ativando')
     and not exists (select 1 from public.fontes_google_sheets_canais k
                      where k.fonte_id = g.fonte_id and k.situacao in ('criando', 'ativo'));

  return query
  -- encerrar: substituídos (renovação concluída) e canais de fontes que não podem mais ser monitoradas
  (select 'encerrar'::text, k.id, k.fonte_id, k.conta_id, null::text, k.resource_id
     from public.fontes_google_sheets_canais k
    where k.situacao in ('ativo', 'substituido') and k.resource_id is not null
      and (k.situacao = 'substituido' or not public.sheets_fonte_monitoravel(k.fonte_id))
    order by k.criado_em
    limit v_limite)
  union all
  -- criar (ou renovar): fonte monitorável sem canal vivo que dure mais que a margem
  (select 'criar'::text, null::uuid, g.fonte_id, g.conta_id, g.planilha_id, null::text
     from public.fontes_google_sheets g
    where public.sheets_fonte_monitoravel(g.fonte_id)
      -- recusado pelo Google: tenta de novo só depois de 6 h; erro passageiro: 15 min
      and not (g.monitoramento = 'indisponivel' and g.monitoramento_erro_em > now() - interval '6 hours')
      and not (g.monitoramento = 'erro' and g.monitoramento_erro_em > now() - interval '15 minutes')
      and not exists (select 1 from public.fontes_google_sheets_canais k
                       where k.fonte_id = g.fonte_id
                         and (k.situacao = 'criando'
                              or (k.situacao = 'ativo' and k.expira_em > now() + v_renovar)))
    order by g.fonte_id
    limit v_limite);
end;
$$;

-- Reserva um id de canal para a fonte (um por vez; nada é criado no Google aqui).
create function public.sheets_canal_reservar(p_fonte uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g  public.fontes_google_sheets;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('sheets_canal:' || p_fonte::text, 0));
  select * into v_g from public.fontes_google_sheets where fonte_id = p_fonte;
  if v_g.fonte_id is null or not public.sheets_fonte_monitoravel(p_fonte) then
    return null;
  end if;
  if exists (select 1 from public.fontes_google_sheets_canais k where k.fonte_id = p_fonte and k.situacao = 'criando') then
    return null;
  end if;
  insert into public.fontes_google_sheets_canais (tenant_id, fonte_id, conta_id)
  values (v_g.tenant_id, v_g.fonte_id, v_g.conta_id)
  returning id into v_id;
  update public.fontes_google_sheets
     set monitoramento = case when monitoramento = 'ativo' then 'ativo' else 'ativando' end
   where fonte_id = p_fonte;
  return v_id;
end;
$$;

-- Google aceitou o canal: ativa e marca os anteriores para encerrar.
create function public.sheets_canal_ativar(p_canal uuid, p_resource text, p_expira timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.fontes_google_sheets_canais;
begin
  select * into v_k from public.fontes_google_sheets_canais where id = p_canal for update;
  if v_k.id is null or v_k.situacao <> 'criando' then
    raise exception 'Canal inexistente ou já tratado.' using errcode = 'P0002';
  end if;
  if p_resource is null or p_resource !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception 'Recurso do Google inválido.' using errcode = '22023';
  end if;
  update public.fontes_google_sheets_canais
     set situacao = 'ativo', resource_id = p_resource, ativado_em = now(),
         expira_em = least(coalesce(p_expira, now() + interval '1 day'), now() + interval '1 day')
   where id = p_canal;
  update public.fontes_google_sheets_canais
     set situacao = 'substituido', motivo = 'renovado'
   where fonte_id = v_k.fonte_id and id <> p_canal and situacao = 'ativo';
  update public.fontes_google_sheets
     set monitoramento = 'ativo', monitoramento_desde = coalesce(case when monitoramento = 'ativo' then monitoramento_desde end, now()),
         monitoramento_erro = null, monitoramento_erro_em = null
   where fonte_id = v_k.fonte_id;
end;
$$;

-- Google recusou o canal. p_indisponivel: recusa "definitiva" (endereço, permissão
-- do recurso) — o agendador espera 6 h para tentar de novo; senão, 15 min.
create function public.sheets_canal_falhou(p_canal uuid, p_erro text, p_indisponivel boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.fontes_google_sheets_canais;
begin
  select * into v_k from public.fontes_google_sheets_canais where id = p_canal for update;
  if v_k.id is null then return; end if;
  update public.fontes_google_sheets_canais
     set situacao = 'falhou', encerrado_em = now(), motivo = left(coalesce(p_erro, 'falha'), 300)
   where id = p_canal and situacao = 'criando';
  -- Só rebaixa o painel se não houver outro canal ainda valendo (renovação que falhou).
  if not exists (select 1 from public.fontes_google_sheets_canais k
                  where k.fonte_id = v_k.fonte_id and k.situacao = 'ativo' and k.expira_em > now()) then
    update public.fontes_google_sheets
       set monitoramento = case when coalesce(p_indisponivel, false) then 'indisponivel' else 'erro' end,
           monitoramento_desde = null,
           monitoramento_erro = left(coalesce(p_erro, 'O Google não aceitou o monitoramento.'), 300),
           monitoramento_erro_em = now()
     where fonte_id = v_k.fonte_id;
  else
    update public.fontes_google_sheets
       set monitoramento_erro = left(coalesce(p_erro, 'Renovação recusada.'), 300), monitoramento_erro_em = now()
     where fonte_id = v_k.fonte_id;
  end if;
end;
$$;

-- Canal encerrado no Google (ou que não precisa mais ser encerrado).
create function public.sheets_canal_encerrado(p_canal uuid, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fontes_google_sheets_canais
     set situacao = 'encerrado', encerrado_em = now(), motivo = left(coalesce(p_motivo, motivo, 'encerrado'), 300)
   where id = p_canal and situacao in ('criando', 'ativo', 'substituido');
$$;

-- Canais vivos de uma conta (encerrar ANTES de revogar o acesso do Google:
-- depois da revogação o Google não aceita mais o pedido de parada).
create function public.sheets_canais_da_conta(p_conta uuid)
returns table (canal_id uuid, resource_id text)
language sql
security definer
set search_path = ''
as $$
  select k.id, k.resource_id
    from public.fontes_google_sheets_canais k
   where k.conta_id = p_conta and k.situacao in ('ativo', 'substituido') and k.resource_id is not null;
$$;

-- Aviso do Google. A Edge Function já conferiu o token (HMAC do canal + fonte);
-- aqui o banco confere canal, fonte, recurso e se a fonte ainda pode ser lida.
-- Resultado: sincronizar | ignorar | encerrar | desconhecido
create function public.sheets_canal_notificar(p_canal uuid, p_fonte uuid, p_resource text, p_estado text)
returns table (acao text, conta_id uuid, resource_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_k public.fontes_google_sheets_canais;
begin
  select * into v_k from public.fontes_google_sheets_canais k where k.id = p_canal for update;
  if v_k.id is null or v_k.fonte_id is distinct from p_fonte
     or (v_k.resource_id is not null and v_k.resource_id is distinct from p_resource) then
    return query select 'desconhecido'::text, null::uuid, null::text;
    return;
  end if;

  update public.fontes_google_sheets_canais
     set notificacoes = notificacoes + 1, ultima_notificacao_em = now()
   where id = p_canal;

  -- "sync" chega logo ao criar (às vezes antes da resposta do watch): só confirma o canal.
  if p_estado = 'sync' then
    return query select 'ignorar'::text, null::uuid, null::text;
    return;
  end if;

  if v_k.situacao in ('encerrado', 'falhou') or (v_k.expira_em is not null and v_k.expira_em <= now()) then
    return query select 'ignorar'::text, null::uuid, null::text;
    return;
  end if;

  if not public.sheets_fonte_monitoravel(p_fonte) then
    -- Pausada, desconectada, conta revogada ou empresa sem liberação: nada é lido; o canal sai.
    update public.fontes_google_sheets_canais set situacao = 'substituido', motivo = 'fonte não monitorável'
     where id = p_canal and situacao = 'ativo';
    return query select 'encerrar'::text, v_k.conta_id, coalesce(v_k.resource_id, p_resource);
    return;
  end if;

  if p_estado in ('update', 'add', 'untrash') then
    update public.fontes_google_sheets
       set notificacao_pendente_em = now(), ultima_notificacao_em = now(),
           proxima_sincronizacao_em = least(proxima_sincronizacao_em, now())
     where fonte_id = p_fonte;
    return query select 'sincronizar'::text, null::uuid, null::text;
    return;
  end if;

  if p_estado in ('trash', 'remove') then
    update public.fontes_google_sheets
       set ultima_notificacao_em = now(),
           monitoramento_erro = 'O Google avisou que a planilha foi para a lixeira ou perdeu o acesso.',
           monitoramento_erro_em = now()
     where fonte_id = p_fonte;
  end if;
  return query select 'ignorar'::text, null::uuid, null::text;
end;
$$;

-- Ainda há aviso não lido? (chegou outro durante a leitura)
create function public.sheets_tem_pendencia(p_fonte uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select g.notificacao_pendente_em is not null from public.fontes_google_sheets g where g.fonte_id = p_fonte), false);
$$;

-- Painel: estado do monitoramento das planilhas da empresa (Administrador).
create function public.sheets_monitoramento_da_empresa()
returns table (fonte_id uuid, monitoramento text, monitoramento_desde timestamptz, ultima_notificacao_em timestamptz,
               canal_expira_em timestamptz, monitoramento_erro text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
begin
  return query
  select g.fonte_id, g.monitoramento, g.monitoramento_desde, g.ultima_notificacao_em,
         (select max(k.expira_em) from public.fontes_google_sheets_canais k
           where k.fonte_id = g.fonte_id and k.situacao = 'ativo'),
         g.monitoramento_erro
    from public.fontes_google_sheets g
   where g.tenant_id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fila: o aviso entra no mesmo caminho (mesmas assinaturas)
-- ---------------------------------------------------------------------------
-- Reservar limpa o aviso pendente (a leitura vai cobrir a alteração avisada).
create or replace function public.sheets_reservar(p_limite integer default 5, p_lease_segundos integer default 300, p_fonte uuid default null)
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
     set bloqueado_ate = now() + make_interval(secs => least(greatest(coalesce(p_lease_segundos, 300), 30), 900)),
         notificacao_pendente_em = null
    from lote
   where g.fonte_id = lote.fonte_id
  returning g.fonte_id, g.tenant_id, g.conta_id, g.planilha_id, g.aba_nome, g.linha_cabecalho, g.mapeamento,
            g.coluna_chave, g.importar_existentes, g.ultimo_sucesso_em is null;
end;
$$;

-- Concluir: se chegou aviso DURANTE a leitura, a próxima fica para já.
-- O próximo horário periódico é arredondado para baixo (30 s de folga), para
-- o agendador de 5 em 5 min não pular uma rodada por segundos.
create or replace function public.sheets_concluir(p_fonte uuid, p_ok boolean, p_erro text, p_linhas_lidas integer, p_autorizacao boolean default false)
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
           proxima_sincronizacao_em = case when notificacao_pendente_em is not null then now()
                                           else now() + make_interval(mins => intervalo_minutos) - interval '30 seconds' end
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
-- 5. Permissões: tudo só para service_role, exceto a leitura do painel.
-- ---------------------------------------------------------------------------
revoke all on function public.sheets_fonte_monitoravel(uuid) from public, anon, authenticated;
revoke all on function public.sheets_canais_tarefas(integer, integer) from public, anon, authenticated;
revoke all on function public.sheets_canal_reservar(uuid) from public, anon, authenticated;
revoke all on function public.sheets_canal_ativar(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sheets_canal_falhou(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.sheets_canal_encerrado(uuid, text) from public, anon, authenticated;
revoke all on function public.sheets_canais_da_conta(uuid) from public, anon, authenticated;
revoke all on function public.sheets_canal_notificar(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.sheets_tem_pendencia(uuid) from public, anon, authenticated;
revoke all on function public.sheets_monitoramento_da_empresa() from public, anon;
revoke all on function public.sheets_reservar(integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.sheets_concluir(uuid, boolean, text, integer, boolean) from public, anon, authenticated;

grant execute on function public.sheets_fonte_monitoravel(uuid) to service_role;
grant execute on function public.sheets_canais_tarefas(integer, integer) to service_role;
grant execute on function public.sheets_canal_reservar(uuid) to service_role;
grant execute on function public.sheets_canal_ativar(uuid, text, timestamptz) to service_role;
grant execute on function public.sheets_canal_falhou(uuid, text, boolean) to service_role;
grant execute on function public.sheets_canal_encerrado(uuid, text) to service_role;
grant execute on function public.sheets_canais_da_conta(uuid) to service_role;
grant execute on function public.sheets_canal_notificar(uuid, uuid, text, text) to service_role;
grant execute on function public.sheets_tem_pendencia(uuid) to service_role;
grant execute on function public.sheets_monitoramento_da_empresa() to authenticated, service_role;
grant execute on function public.sheets_reservar(integer, integer, uuid) to service_role;
grant execute on function public.sheets_concluir(uuid, boolean, text, integer, boolean) to service_role;
grant select, insert, update, delete on public.fontes_google_sheets_canais to service_role;
