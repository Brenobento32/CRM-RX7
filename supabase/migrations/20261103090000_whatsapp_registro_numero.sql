set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- WhatsApp oficial: o número só fica "conectado" (operacional) depois das
-- etapas obrigatórias da Meta.
--
--  - Embedded Signup comum (número novo na Cloud API): depois de trocar o
--    código e assinar o webhook, a Meta exige REGISTRAR o número
--    (POST /<PHONE_NUMBER_ID>/register com PIN de 6 dígitos). Até isso dar
--    certo o número fica em 'pendente_registro': não recebe leads, não envia.
--  - Coexistência (número que já usa o app WhatsApp Business): a Meta não
--    pede registro; o número fica 'conectado' direto, marcado como coexistência.
--
-- O PIN nunca é gravado (nem em texto, nem no Vault): só passa da tela para a
-- Meta. Cada pedido de registro enviado à Meta é contado por número:
--  - a Meta aceita 10 pedidos por número numa janela móvel de 72 h (conta os
--    que falham) e, no excesso, devolve 133016 e bloqueia o número por 72 h;
--  - o AVANTE para antes: 5 pedidos por hora e 8 em 72 h (margem de 2);
--  - recebido 133016, nenhuma tentativa nova por 72 h.
-- Nada muda para números já existentes (não há nenhum em produção).
-- ===========================================================================

alter table public.whatsapp_numeros drop constraint whatsapp_numeros_situacao_check;
alter table public.whatsapp_numeros
  add constraint whatsapp_numeros_situacao_check
  check (situacao in ('pendente_registro', 'conectado', 'pausado', 'desconectado'));

alter table public.whatsapp_numeros
  add column modo_conexao        text not null default 'cloud_api' check (modo_conexao in ('cloud_api', 'coexistencia')),
  add column registrado_em       timestamptz,
  add column registro_tentativas integer not null default 0 check (registro_tentativas >= 0),
  add column registro_erro       text check (registro_erro is null or length(registro_erro) <= 300),
  add column registro_erro_em    timestamptz,
  add column registro_pedidos    timestamptz[] not null default '{}',
  add column registro_bloqueado_ate timestamptz;

comment on column public.whatsapp_numeros.registrado_em is
  'Quando a Meta confirmou o registro do número na Cloud API (ou a conexão por coexistência).';
comment on column public.whatsapp_numeros.registro_pedidos is
  'Horários dos pedidos de registro enviados à Meta nas últimas 72 h (limite da Meta: 10 por número; o AVANTE para em 8).';
comment on column public.whatsapp_numeros.registro_bloqueado_ate is
  'A Meta devolveu 133016 (limite de registro): nenhuma tentativa nova até este horário.';

-- ---------------------------------------------------------------------------
-- Limite de pedidos de registro (interno). Devolve o motivo do bloqueio ou null.
-- ---------------------------------------------------------------------------
create function public.whatsapp_registro_bloqueio(p_pedidos timestamptz[], p_bloqueado_ate timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ultimas_72h timestamptz[] := array(select x from unnest(coalesce(p_pedidos, '{}')) x where x > now() - interval '72 hours' order by x desc);
  v_libera      timestamptz;
  fmt constant  text := 'DD/MM "às" HH24:MI';
begin
  if p_bloqueado_ate > now() then
    return format('A Meta bloqueou novos pedidos de registro deste número (limite de tentativas). Nova tentativa a partir de %s.',
                  to_char(p_bloqueado_ate at time zone 'America/Sao_Paulo', fmt));
  end if;
  if coalesce(array_length(v_ultimas_72h, 1), 0) >= 8 then
    v_libera := v_ultimas_72h[8] + interval '72 hours';
    return format('Este número já teve 8 pedidos de registro em 72 horas. Para não chegar ao bloqueio da Meta (10 pedidos), '
                  'a próxima tentativa fica liberada a partir de %s.', to_char(v_libera at time zone 'America/Sao_Paulo', fmt));
  end if;
  if (select count(*) from unnest(v_ultimas_72h) x where x > now() - interval '1 hour') >= 5 then
    return 'Muitas tentativas de registro deste número. Aguarde 1 hora e confira o PIN.';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Salvar o número depois do Embedded Signup (mesmas regras de antes + modo).
-- Número novo: 'pendente_registro' (cloud_api) ou 'conectado' (coexistência).
-- Reconexão na mesma empresa: continua operacional só se já estava registrado.
-- ---------------------------------------------------------------------------
drop function public.whatsapp_salvar_numero(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid);

create function public.whatsapp_salvar_numero(
  p_tenant uuid, p_usuario uuid, p_phone_number_id text, p_waba_id text, p_numero_exibicao text, p_nome_verificado text,
  p_token text, p_nome text, p_funil uuid, p_etapa uuid, p_responsavel uuid, p_modo text default 'cloud_api')
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
  v_modo      text := coalesce(p_modo, 'cloud_api');
  v_situacao  text;
begin
  perform public.exigir_integracao_habilitada('whatsapp_oficial', p_tenant);
  if not public.usuario_administra_integracoes(p_usuario, p_tenant) then
    raise exception 'Usuário não administra as integrações desta empresa.' using errcode = '42501';
  end if;
  if v_modo not in ('cloud_api', 'coexistencia') then
    raise exception 'Modo de conexão inválido.' using errcode = '22023';
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
    v_situacao := case when v_modo = 'coexistencia' then 'conectado' else 'pendente_registro' end;
    insert into public.fontes_leads (id, tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id, configuracao,
                                     validada_em, criado_por)
    values (v_fonte, p_tenant, 'whatsapp_cloud', left(btrim(coalesce(p_nome, 'WhatsApp')), 80), 'ativa', p_funil, p_etapa, p_responsavel,
            jsonb_build_object('phone_number_id', p_phone_number_id), now(), p_usuario);
    insert into public.whatsapp_numeros (tenant_id, fonte_id, phone_number_id, waba_id, numero_exibicao, nome_verificado,
                                         vault_secret_id, conectado_por, situacao, modo_conexao, registrado_em)
    values (p_tenant, v_fonte, p_phone_number_id, p_waba_id, left(p_numero_exibicao, 40), left(p_nome_verificado, 200), v_secret, p_usuario,
            v_situacao, v_modo, case when v_modo = 'coexistencia' then now() end)
    returning id into v_id;
  else
    -- Reconexão do mesmo número na mesma empresa: troca o token, mantém o histórico.
    v_situacao := case when v_modo = 'coexistencia' or v_existente.registrado_em is not null then 'conectado' else 'pendente_registro' end;
    if v_existente.vault_secret_id is not null then delete from vault.secrets where id = v_existente.vault_secret_id; end if;
    update public.whatsapp_numeros
       set waba_id = p_waba_id, numero_exibicao = left(p_numero_exibicao, 40), nome_verificado = left(p_nome_verificado, 200),
           vault_secret_id = v_secret, situacao = v_situacao, conectado_por = p_usuario, conectado_em = now(),
           modo_conexao = v_modo, registrado_em = case when v_modo = 'coexistencia' then coalesce(registrado_em, now()) else registrado_em end,
           ultimo_erro = null, ultimo_erro_em = null
     where id = v_existente.id
    returning id, fonte_id into v_id, v_fonte;
    update public.fontes_leads set status = 'ativa', funil_id = p_funil, etapa_id = p_etapa, responsavel_id = p_responsavel,
                                   validada_em = now()
     where id = v_fonte and status <> 'revogada';
  end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (p_usuario, 'integracao_whatsapp_conectada', p_tenant,
          jsonb_build_object('numero', v_id, 'fonte', v_fonte, 'funil', p_funil, 'etapa', p_etapa, 'responsavel', p_responsavel,
                             'modo', v_modo, 'situacao', v_situacao));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Antes de registrar de novo (tela): número desta empresa, pendente, dentro do limite.
-- Devolve o phone_number_id; o token sai do Vault só no servidor.
-- ---------------------------------------------------------------------------
create function public.whatsapp_preparar_registro(p_numero uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := public.exigir_administrador_integracoes();
  v_n        public.whatsapp_numeros;
  v_bloqueio text;
begin
  select * into v_n from public.whatsapp_numeros where id = p_numero and tenant_id = v_tenant;
  if v_n.id is null then raise exception 'Número não encontrado nesta empresa.' using errcode = 'P0002'; end if;
  perform public.exigir_integracao_habilitada('whatsapp_oficial', v_tenant);
  if v_n.situacao <> 'pendente_registro' then
    raise exception 'Este número não está aguardando registro.' using errcode = '23514';
  end if;
  if v_n.vault_secret_id is null then
    raise exception 'A autorização da Meta deste número não está mais disponível: conecte de novo.' using errcode = '23514';
  end if;
  v_bloqueio := public.whatsapp_registro_bloqueio(v_n.registro_pedidos, v_n.registro_bloqueado_ate);
  if v_bloqueio is not null then raise exception '%', v_bloqueio using errcode = 'RX010'; end if;
  return v_n.phone_number_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Servidor, IMEDIATAMENTE antes de chamar a Meta: confere de novo o limite e
-- conta o pedido (com a linha travada, dois pedidos simultâneos não passam juntos).
-- ---------------------------------------------------------------------------
create function public.whatsapp_registro_reservar(p_numero uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n        public.whatsapp_numeros;
  v_bloqueio text;
begin
  select * into v_n from public.whatsapp_numeros where id = p_numero for update;
  if v_n.id is null then raise exception 'Número não encontrado.' using errcode = 'P0002'; end if;
  perform public.exigir_integracao_habilitada('whatsapp_oficial', v_n.tenant_id);
  if v_n.situacao <> 'pendente_registro' or v_n.modo_conexao <> 'cloud_api' then
    raise exception 'Este número não está aguardando registro.' using errcode = '23514';
  end if;
  v_bloqueio := public.whatsapp_registro_bloqueio(v_n.registro_pedidos, v_n.registro_bloqueado_ate);
  if v_bloqueio is not null then raise exception '%', v_bloqueio using errcode = 'RX010'; end if;
  update public.whatsapp_numeros
     set registro_pedidos = array(select x from unnest(registro_pedidos) x where x > now() - interval '72 hours' order by x) || now()
   where id = p_numero;
  return v_n.phone_number_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Credencial SÓ para registrar um número pendente (servidor). O token de uso
-- geral (whatsapp_obter_token) continua restrito a números conectados.
-- ---------------------------------------------------------------------------
create function public.whatsapp_token_registro(p_numero uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::text
    from public.whatsapp_numeros n join vault.decrypted_secrets s on s.id = n.vault_secret_id
   where n.id = p_numero and n.situacao = 'pendente_registro' and n.modo_conexao = 'cloud_api'
     and public.integracao_habilitada('whatsapp_oficial', n.tenant_id);
$$;

-- ---------------------------------------------------------------------------
-- Resultado do registro na Meta (servidor). Sucesso → 'conectado'.
-- Falha → continua pendente, conta a falha (o PIN nunca chega aqui).
-- 133016 (limite da Meta) → nenhuma tentativa nova por 72 h.
-- ---------------------------------------------------------------------------
create function public.whatsapp_registro_resultado(p_numero uuid, p_ok boolean, p_erro text, p_codigo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n    public.whatsapp_numeros;
  v_erro text := left(coalesce(p_erro, 'A Meta recusou o registro.'), 300);
begin
  select * into v_n from public.whatsapp_numeros where id = p_numero for update;
  if v_n.id is null then raise exception 'Número não encontrado.' using errcode = 'P0002'; end if;
  if v_n.situacao <> 'pendente_registro' then return v_n.situacao; end if;
  if coalesce(p_ok, false) then
    update public.whatsapp_numeros
       set situacao = 'conectado', registrado_em = now(), registro_tentativas = 0, registro_erro = null, registro_erro_em = null,
           ultimo_erro = null, ultimo_erro_em = null
     where id = p_numero;
    update public.fontes_leads set ultimo_erro = null, ultimo_erro_em = null where id = v_n.fonte_id;
    insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
    values (v_n.conectado_por, 'integracao_whatsapp_registrada', v_n.tenant_id, jsonb_build_object('numero', p_numero));
    return 'conectado';
  end if;
  if p_codigo = '133016' then
    v_erro := public.whatsapp_registro_bloqueio(null, now() + interval '72 hours');
  end if;
  update public.whatsapp_numeros
     set registro_tentativas = registro_tentativas + 1,
         registro_bloqueado_ate = case when p_codigo = '133016' then now() + interval '72 hours' else registro_bloqueado_ate end,
         registro_erro = v_erro, registro_erro_em = now(), ultimo_erro = v_erro, ultimo_erro_em = now()
   where id = p_numero;
  update public.fontes_leads set ultimo_erro = v_erro, ultimo_erro_em = now() where id = v_n.fonte_id;
  return 'pendente_registro';
end;
$$;

-- ---------------------------------------------------------------------------
-- Repetição do retorno da Meta (mesma conexão chegando de novo em poucos
-- minutos): o servidor devolve o estado atual em vez de trocar o código de novo.
-- ---------------------------------------------------------------------------
create function public.whatsapp_conexao_recente(p_phone_number_id text)
returns table (numero_id uuid, situacao text, numero_exibicao text, nome_verificado text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
begin
  return query
  select n.id, n.situacao, n.numero_exibicao, n.nome_verificado
    from public.whatsapp_numeros n
   where n.tenant_id = v_tenant and n.phone_number_id = p_phone_number_id
     and n.situacao in ('pendente_registro', 'conectado') and n.conectado_em > now() - interval '10 minutes';
end;
$$;

-- ---------------------------------------------------------------------------
-- Ações do Administrador: "retomar" não pula o registro pendente.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_acao(p_numero uuid, p_acao text)
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
    if v_n.situacao = 'pendente_registro' then
      raise exception 'Conclua o registro do número na Meta antes de usá-lo.' using errcode = '23514';
    end if;
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
-- Franquia: número pendente ainda não opera, então não é conferido com a Meta
-- (evita um "sem credencial" enganoso no painel). Mesma função, só o filtro muda.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_numeros_para_reconciliar(p_limite integer default 10)
returns table (numero_id uuid, waba_id text, phone_number_id text, numero_exibicao text, fuso_conta text, mes date,
               inicio_unix bigint, fim_unix bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with lote as (
    select n.id from public.whatsapp_numeros n
     where n.situacao not in ('desconectado', 'pendente_registro') and n.vault_secret_id is not null
       and public.integracao_habilitada('whatsapp_oficial', n.tenant_id)
       and (n.franquia_reconciliar_em is null or n.franquia_reconciliar_em <= now())
     order by n.franquia_reconciliar_em nulls first
     limit least(greatest(coalesce(p_limite, 10), 1), 50)
     for update of n skip locked
  )
  update public.whatsapp_numeros n set franquia_reconciliar_em = now() + interval '6 hours'
    from lote where n.id = lote.id
  returning n.id, n.waba_id, n.phone_number_id, n.numero_exibicao, n.fuso_conta, public.whatsapp_mes_franquia(n.fuso_conta),
            extract(epoch from (public.whatsapp_mes_franquia(n.fuso_conta)::timestamp at time zone n.fuso_conta))::bigint,
            extract(epoch from now())::bigint;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.whatsapp_salvar_numero(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_registro_resultado(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_registro_reservar(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_registro_bloqueio(timestamptz[], timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_token_registro(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_preparar_registro(uuid) from public, anon;
revoke all on function public.whatsapp_conexao_recente(text) from public, anon;
revoke all on function public.whatsapp_acao(uuid, text) from public, anon;
grant execute on function public.whatsapp_salvar_numero(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid, text) to service_role;
grant execute on function public.whatsapp_registro_resultado(uuid, boolean, text, text) to service_role;
grant execute on function public.whatsapp_registro_reservar(uuid) to service_role;
grant execute on function public.whatsapp_token_registro(uuid) to service_role;
revoke all on function public.whatsapp_numeros_para_reconciliar(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_numeros_para_reconciliar(integer) to service_role;
grant execute on function public.whatsapp_preparar_registro(uuid) to authenticated, service_role;
grant execute on function public.whatsapp_conexao_recente(text) to authenticated, service_role;
grant execute on function public.whatsapp_acao(uuid, text) to authenticated, service_role;
