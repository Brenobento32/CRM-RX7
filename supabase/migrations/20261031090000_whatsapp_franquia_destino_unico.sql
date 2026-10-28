set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Complemento de 20261030100000 (ainda NÃO aplicada em produção):
--
--  1. WhatsApp: franquia mensal de mensagens de serviço gratuitas por número.
--     Regra da Meta desde 01/10/2026: cada número tem 1.000 mensagens de
--     serviço gratuitas por mês (fuso da conta); a partir da 1.001ª, mensagem
--     ENTREGUE é cobrada mesmo dentro da janela de 24 h. O status da Meta
--     informa `pricing.billable` e `pricing.type` (free_customer_service |
--     regular). O AVANTE:
--       - reserva capacidade ANTES de cada envio (com trava por número, vale
--         para envios simultâneos) e só libera a reserva se a mensagem falhar;
--       - conta pela entrega, reconcilia com o total que a própria Meta
--         informa (pricing analytics) e usa uma margem de segurança;
--       - BLOQUEIA o envio quando a franquia está no fim ou quando o consumo
--         do mês não foi confirmado com a Meta (ex.: número que já era usado
--         por outro sistema). Não impede cobranças geradas por outros sistemas
--         ligados à mesma conta — só deixa de somar a elas.
--  2. Destino único dos leads (Google Sheets e WhatsApp):
--       - sem cliente na empresa → cliente + oportunidade no funil configurado;
--       - cliente com negociação ABERTA no funil de destino → reaproveita
--         (etapa e responsável preservados; a nova origem fica registrada);
--       - cliente sem negociação aberta nesse funil → nova oportunidade nele,
--         para o MESMO cliente (o responsável da negociação é o do cliente,
--         regra do CRM: negociacoes_owner_do_cliente);
--       - nada é movido entre funis; reenvio/mensagem repetida não duplica.
--  3. Atribuição Meta preservada na entrada (sem inventar): ID do lead dos
--     Lead Ads vindo de uma coluna da planilha; dados de "referral" do
--     anúncio Click-to-WhatsApp vindos do webhook.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Franquia mensal
-- ---------------------------------------------------------------------------
alter table public.plataforma_regras_whatsapp
  add column franquia_servico_mensal integer not null default 1000 check (franquia_servico_mensal between 0 and 100000),
  add column margem_seguranca integer not null default 50 check (margem_seguranca between 0 and 1000),
  add column confirmacao_valida_horas integer not null default 36 check (confirmacao_valida_horas between 1 and 168);

alter table public.whatsapp_numeros
  add column fuso_conta text not null default 'America/Sao_Paulo' check (length(fuso_conta) <= 60),
  add column franquia_reconciliar_em timestamptz,
  add column franquia_ultimo_erro text check (franquia_ultimo_erro is null or length(franquia_ultimo_erro) <= 300);

create table public.whatsapp_franquia (
  numero_id              uuid not null references public.whatsapp_numeros (id) on delete cascade,
  mes                    date not null check (extract(day from mes) = 1),
  limite                 integer not null,
  margem                 integer not null,
  reservadas             integer not null default 0 check (reservadas >= 0),   -- enviadas/em envio, sem entrega confirmada
  consumidas             integer not null default 0 check (consumidas >= 0),   -- entregues (contam na franquia)
  liberadas              integer not null default 0,                           -- falharam: reserva devolvida
  gratuitas_confirmadas  integer not null default 0,                           -- Meta: free_customer_service
  cobradas               integer not null default 0,                           -- Meta: billable / regular
  utilizadas_meta        integer,                                              -- total do mês segundo a Meta (reconciliação)
  confirmacao            text not null default 'desconhecida' check (confirmacao in ('desconhecida', 'confirmada')),
  reconciliada_em        timestamptz,
  alerta_80_em           timestamptz,
  alerta_90_em           timestamptz,
  alerta_100_em          timestamptz,
  primary key (numero_id, mes)
);
alter table public.whatsapp_franquia enable row level security;
revoke all on public.whatsapp_franquia from public, anon, authenticated;

alter table public.mensagens
  add column franquia_mes date,
  add column franquia_estado text check (franquia_estado is null or franquia_estado in ('reservada', 'consumida', 'liberada')),
  add column preco_tipo text check (preco_tipo is null or length(preco_tipo) <= 40);

-- Mês da franquia no fuso da conta de mensagens (a Meta zera no dia 1, 0 h desse fuso).
create function public.whatsapp_mes_franquia(p_fuso text)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone coalesce(nullif(p_fuso, ''), 'America/Sao_Paulo'))::date;
$$;

create function public.whatsapp_franquia_garantir(p_numero uuid, p_mes date)
returns public.whatsapp_franquia
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.whatsapp_franquia;
  v_r public.plataforma_regras_whatsapp;
begin
  select * into v_f from public.whatsapp_franquia where numero_id = p_numero and mes = p_mes;
  if v_f.numero_id is null then
    select * into v_r from public.plataforma_regras_whatsapp limit 1;
    insert into public.whatsapp_franquia (numero_id, mes, limite, margem)
    values (p_numero, p_mes, coalesce(v_r.franquia_servico_mensal, 1000), coalesce(v_r.margem_seguranca, 50))
    on conflict (numero_id, mes) do nothing;
    select * into v_f from public.whatsapp_franquia where numero_id = p_numero and mes = p_mes;
  end if;
  return v_f;
end;
$$;

-- Uso conservador: o maior entre o que o AVANTE contou e o que a Meta informou,
-- mais tudo o que ainda está reservado (sem entrega confirmada).
create function public.whatsapp_franquia_usadas(f public.whatsapp_franquia)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(f.consumidas, coalesce(f.utilizadas_meta, 0)) + f.reservadas;
$$;

create function public.whatsapp_franquia_situacao(f public.whatsapp_franquia)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when f.numero_id is null then 'nao_confirmada'
    when public.whatsapp_franquia_usadas(f) >= greatest(f.limite - f.margem, 0) then 'esgotada'
    when f.confirmacao <> 'confirmada'
      or f.reconciliada_em is null
      or f.reconciliada_em < now() - make_interval(hours => coalesce((select r.confirmacao_valida_horas from public.plataforma_regras_whatsapp r limit 1), 36))
      then 'nao_confirmada'
    else 'liberada' end;
$$;

-- Alertas de 80 %, 90 % e 100 % do limite estimado (uma vez por mês, auditados).
create function public.whatsapp_franquia_alertas(p_numero uuid, p_mes date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f      public.whatsapp_franquia;
  v_tenant uuid;
  v_pct    numeric;
  v_nivel  integer;
begin
  select * into v_f from public.whatsapp_franquia where numero_id = p_numero and mes = p_mes for update;
  if v_f.numero_id is null or greatest(v_f.limite - v_f.margem, 0) = 0 then return; end if;
  v_pct := public.whatsapp_franquia_usadas(v_f) * 100.0 / greatest(v_f.limite - v_f.margem, 1);
  foreach v_nivel in array array[80, 90, 100] loop
    continue when v_pct < v_nivel;
    if v_nivel = 80 and v_f.alerta_80_em is null then
      update public.whatsapp_franquia set alerta_80_em = now() where numero_id = p_numero and mes = p_mes;
    elsif v_nivel = 90 and v_f.alerta_90_em is null then
      update public.whatsapp_franquia set alerta_90_em = now() where numero_id = p_numero and mes = p_mes;
    elsif v_nivel = 100 and v_f.alerta_100_em is null then
      update public.whatsapp_franquia set alerta_100_em = now() where numero_id = p_numero and mes = p_mes;
    else
      continue;
    end if;
    select tenant_id into v_tenant from public.whatsapp_numeros where id = p_numero;
    insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
    values (null, 'whatsapp_franquia_alerta', v_tenant,
            jsonb_build_object('numero', p_numero, 'mes', p_mes, 'nivel', v_nivel, 'usadas', public.whatsapp_franquia_usadas(v_f),
                               'limite_estimado', v_f.limite - v_f.margem));
  end loop;
end;
$$;

-- Usuário (JWT + empresa): prepara um envio. Decide no BANCO se pode sair.
-- Bloqueios voltam como RESULTADO (o contador de bloqueios precisa ficar gravado).
create or replace function public.whatsapp_preparar_envio(p_conversa uuid, p_texto text)
returns table (mensagem_id uuid, numero_id uuid, phone_number_id text, destino text, bloqueio text, mensagem text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant   uuid := public.tenant_exigir();
  v_uid      uuid := (select auth.uid());
  v_c        public.conversas;
  v_n        public.whatsapp_numeros;
  v_hoje     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_usados   integer;
  v_msg      uuid;
  v_bloqueio text;
  v_mes      date;
  v_fr       public.whatsapp_franquia;
begin
  select * into v_c from public.conversas where id = p_conversa and tenant_id = v_tenant;
  if v_c.id is null then raise exception 'Conversa não encontrada.' using errcode = 'P0002'; end if;
  if not (public.is_gerente() or exists (select 1 from public.clientes cl where cl.id = v_c.cliente_id and cl.owner_id = v_uid)) then
    raise exception 'Você não atende esta conversa.' using errcode = '42501';
  end if;
  if not public.pode_escrever_no_tenant(v_tenant) then raise exception 'Empresa somente leitura.' using errcode = '42501'; end if;
  if p_texto is null or btrim(p_texto) = '' or length(p_texto) > 4096 then
    raise exception 'Escreva a mensagem (até 4.096 caracteres).' using errcode = '22023';
  end if;
  -- Trava do número: envios simultâneos do mesmo número passam um por vez (reserva sem corrida).
  select * into v_n from public.whatsapp_numeros where id = v_c.whatsapp_numero_id and tenant_id = v_tenant for update;
  if v_n.id is null then raise exception 'Esta conversa não é de um número WhatsApp oficial conectado.' using errcode = 'P0002'; end if;
  if v_n.situacao <> 'conectado' then raise exception 'O número está pausado ou desconectado.' using errcode = 'RX020'; end if;

  v_mes := public.whatsapp_mes_franquia(v_n.fuso_conta);
  v_fr := public.whatsapp_franquia_garantir(v_n.id, v_mes);
  select coalesce(sum(enviadas_gratuitas), 0) into v_usados from public.whatsapp_consumo where numero_id = v_n.id and dia = v_hoje;
  v_bloqueio := case
    when not public.integracao_habilitada('whatsapp_oficial', v_tenant) then 'whatsapp_desativado'
    when v_n.bloqueado_por_cobranca then 'bloqueado_por_cobranca'
    when v_c.ultima_entrada_em is null or v_c.ultima_entrada_em < now() - interval '24 hours' then 'fora_da_janela'
    when public.whatsapp_franquia_situacao(v_fr) = 'esgotada' then 'franquia_esgotada'
    when public.whatsapp_franquia_situacao(v_fr) = 'nao_confirmada' then 'franquia_nao_confirmada'
    when v_usados >= v_n.limite_envios_dia then 'limite_diario'
  end;
  if v_bloqueio is not null then
    insert into public.whatsapp_consumo (numero_id, dia, bloqueadas) values (v_n.id, v_hoje, 1)
    on conflict (numero_id, dia) do update set bloqueadas = public.whatsapp_consumo.bloqueadas + 1;
    return query select null::uuid, v_n.id, null::text, null::text, v_bloqueio,
      case v_bloqueio
        when 'whatsapp_desativado' then 'O WhatsApp oficial ainda não foi liberado na plataforma: nenhuma mensagem sai.'
        when 'bloqueado_por_cobranca' then 'Envios bloqueados: a Meta indicou cobrança neste número. O Administrador precisa revisar.'
        when 'fora_da_janela' then 'Fora da janela de 24 h de atendimento: a mensagem exigiria um modelo pago. Envio bloqueado pela política "Somente gratuitos".'
        when 'franquia_esgotada' then format('Franquia mensal de mensagens gratuitas no limite estimado (%s de %s). Novas respostas podem ser cobradas pela Meta: envio bloqueado.',
                                             public.whatsapp_franquia_usadas(v_fr), v_fr.limite - v_fr.margem)
        when 'franquia_nao_confirmada' then 'Não foi possível confirmar com a Meta quantas mensagens gratuitas restam neste mês. Por segurança, o envio está bloqueado até a próxima confirmação.'
        else format('Limite diário de envios deste número atingido (%s).', v_n.limite_envios_dia)
      end;
    return;
  end if;

  insert into public.whatsapp_consumo (numero_id, dia, enviadas_gratuitas) values (v_n.id, v_hoje, 1)
  on conflict (numero_id, dia) do update set enviadas_gratuitas = public.whatsapp_consumo.enviadas_gratuitas + 1;
  update public.whatsapp_franquia set reservadas = reservadas + 1 where numero_id = v_n.id and mes = v_mes;
  -- Já nasce "enviando" (nunca "pendente"): nenhum serviço antigo pega esta mensagem.
  insert into public.mensagens (tenant_id, conversa_id, direcao, tipo, conteudo, whatsapp_numero_id, status, autor_id, cobravel,
                                franquia_mes, franquia_estado)
  values (v_tenant, v_c.id, 'saida', 'texto', btrim(p_texto), v_n.id, 'enviando', v_uid, false, v_mes, 'reservada')
  returning id into v_msg;
  update public.conversas set ultima_mensagem_em = now(), atendente_id = coalesce(atendente_id, v_uid) where id = v_c.id;
  perform public.whatsapp_franquia_alertas(v_n.id, v_mes);
  return query select v_msg, v_n.id, v_n.phone_number_id, v_c.telefone, null::text, null::text;
end;
$$;

-- Serviço: resultado da chamada à Meta. Falha devolve a reserva (não conta duas vezes).
create or replace function public.whatsapp_confirmar_envio(p_mensagem uuid, p_wa_message_id text, p_ok boolean, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.mensagens;
begin
  select * into v_m from public.mensagens where id = p_mensagem and status = 'enviando' for update;
  if v_m.id is null then return; end if;
  update public.mensagens
     set whatsapp_message_id = case when p_ok then p_wa_message_id else whatsapp_message_id end,
         status = case when p_ok then 'enviado'::public.status_mensagem else 'falhou'::public.status_mensagem end,
         status_detalhe = case when p_ok then null else left(p_erro, 300) end,
         franquia_estado = case when not p_ok and franquia_estado = 'reservada' then 'liberada' else franquia_estado end,
         status_atualizado_em = now()
   where id = v_m.id;
  if not p_ok and v_m.franquia_estado = 'reservada' then
    update public.whatsapp_franquia set reservadas = greatest(reservadas - 1, 0), liberadas = liberadas + 1
     where numero_id = v_m.whatsapp_numero_id and mes = v_m.franquia_mes;
  end if;
end;
$$;

-- Serviço: status da Meta. Entrega consome a franquia (uma vez por mensagem);
-- falha devolve a reserva; preço "regular"/billable conta como cobrado e bloqueia.
drop function public.whatsapp_registrar_status(text, text, text, boolean, text, text);
create function public.whatsapp_registrar_status(
  p_phone_number_id text, p_wa_message_id text, p_status text, p_cobravel boolean, p_categoria text, p_erro text,
  p_tipo_preco text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n     public.whatsapp_numeros;
  v_msg   public.mensagens;
  v_novo  public.status_mensagem;
  v_ordem constant text[] := array['pendente', 'enviando', 'enviado', 'entregue', 'lido'];
  v_mes   date;
  v_cobrada boolean := coalesce(p_cobravel, false) or p_tipo_preco = 'regular';
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null then return jsonb_build_object('ignorado', 'numero_desconhecido'); end if;
  select * into v_msg from public.mensagens where whatsapp_numero_id = v_n.id and whatsapp_message_id = p_wa_message_id for update;
  if v_msg.id is null then return jsonb_build_object('ignorado', 'mensagem_desconhecida'); end if;
  v_mes := coalesce(v_msg.franquia_mes, public.whatsapp_mes_franquia(v_n.fuso_conta));
  v_novo := case p_status when 'sent' then 'enviado' when 'delivered' then 'entregue' when 'read' then 'lido' when 'failed' then 'falhou' end;

  if v_novo is not null and (v_novo = 'falhou' or array_position(v_ordem, v_novo::text) > coalesce(array_position(v_ordem, v_msg.status::text), 0)) then
    update public.mensagens set status = v_novo, status_detalhe = left(p_erro, 300), status_atualizado_em = now()
     where id = v_msg.id;
  end if;

  -- Franquia: transição única por mensagem (reenvio do mesmo status não conta de novo).
  if v_msg.franquia_estado = 'reservada' and p_status in ('delivered', 'read') then
    update public.mensagens set franquia_estado = 'consumida' where id = v_msg.id;
    update public.whatsapp_franquia set reservadas = greatest(reservadas - 1, 0), consumidas = consumidas + 1
     where numero_id = v_n.id and mes = v_mes;
  elsif v_msg.franquia_estado = 'reservada' and p_status = 'failed' then
    update public.mensagens set franquia_estado = 'liberada' where id = v_msg.id;
    update public.whatsapp_franquia set reservadas = greatest(reservadas - 1, 0), liberadas = liberadas + 1
     where numero_id = v_n.id and mes = v_mes;
  end if;
  if p_tipo_preco is not null and v_msg.preco_tipo is null and v_msg.direcao = 'saida' then
    update public.mensagens set preco_tipo = left(p_tipo_preco, 40) where id = v_msg.id;
    perform public.whatsapp_franquia_garantir(v_n.id, v_mes);
    if v_cobrada then
      update public.whatsapp_franquia set cobradas = cobradas + 1 where numero_id = v_n.id and mes = v_mes;
    elsif p_tipo_preco = 'free_customer_service' then
      update public.whatsapp_franquia set gratuitas_confirmadas = gratuitas_confirmadas + 1 where numero_id = v_n.id and mes = v_mes;
    end if;
  end if;
  update public.mensagens set cobravel = coalesce(p_cobravel, cobravel) or v_cobrada,
                              categoria_cobranca = coalesce(left(p_categoria, 40), categoria_cobranca)
   where id = v_msg.id;

  -- A Meta indicou cobrança: conta e, na política "somente gratuitos", bloqueia novos envios.
  if v_cobrada then
    insert into public.whatsapp_consumo (numero_id, dia, cobrancas_meta) values (v_n.id, (now() at time zone 'America/Sao_Paulo')::date, 1)
    on conflict (numero_id, dia) do update set cobrancas_meta = public.whatsapp_consumo.cobrancas_meta + 1;
    if v_n.politica_envio = 'somente_gratuitos' and not v_n.bloqueado_por_cobranca then
      update public.whatsapp_numeros set bloqueado_por_cobranca = true where id = v_n.id;
      insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
      values (null, 'whatsapp_cobranca_detectada', v_n.tenant_id, jsonb_build_object('numero', v_n.id, 'categoria', p_categoria, 'tipo', p_tipo_preco));
    end if;
  end if;
  perform public.whatsapp_franquia_alertas(v_n.id, v_mes);
  return jsonb_build_object('mensagem', v_msg.id, 'status', coalesce(v_novo::text, v_msg.status::text));
end;
$$;

-- Serviço: números a reconciliar com a Meta (lease de 6 h por número).
create function public.whatsapp_numeros_para_reconciliar(p_limite integer default 10)
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
     where n.situacao <> 'desconectado' and n.vault_secret_id is not null and public.integracao_habilitada('whatsapp_oficial', n.tenant_id)
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

-- Serviço: total de mensagens de serviço do mês informado pela Meta.
create function public.whatsapp_reconciliar_franquia(p_numero uuid, p_mes date, p_utilizadas integer, p_fuso text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_utilizadas is null or p_utilizadas < 0 then
    raise exception 'Total inválido.' using errcode = '22023';
  end if;
  if p_fuso is not null and length(p_fuso) between 3 and 60 then
    update public.whatsapp_numeros set fuso_conta = p_fuso where id = p_numero;
  end if;
  perform public.whatsapp_franquia_garantir(p_numero, p_mes);
  update public.whatsapp_franquia
     -- No mesmo mês o total da Meta só cresce: valor menor é dado inconsistente, fica o maior já visto.
     set utilizadas_meta = greatest(coalesce(utilizadas_meta, 0), p_utilizadas), confirmacao = 'confirmada', reconciliada_em = now()
   where numero_id = p_numero and mes = p_mes;
  update public.whatsapp_numeros set franquia_ultimo_erro = null where id = p_numero;
  perform public.whatsapp_franquia_alertas(p_numero, p_mes);
end;
$$;

create function public.whatsapp_reconciliar_erro(p_numero uuid, p_erro text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_numeros set franquia_ultimo_erro = left(p_erro, 300), franquia_reconciliar_em = now() + interval '1 hour'
   where id = p_numero;
$$;

-- Administrador: painel "mensagens gratuitas utilizadas / limite estimado" do mês.
create function public.whatsapp_franquia_empresa()
returns table (numero_id uuid, numero text, mes date, limite integer, margem integer, limite_estimado integer, usadas integer,
               reservadas integer, consumidas integer, gratuitas_confirmadas integer, cobradas integer, utilizadas_meta integer,
               confirmacao text, reconciliada_em timestamptz, situacao text, alerta_80_em timestamptz, alerta_90_em timestamptz,
               alerta_100_em timestamptz, ultimo_erro text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_n      record;
begin
  for v_n in select n.id, n.fuso_conta from public.whatsapp_numeros n where n.tenant_id = v_tenant and n.situacao <> 'desconectado' loop
    perform public.whatsapp_franquia_garantir(v_n.id, public.whatsapp_mes_franquia(v_n.fuso_conta));
  end loop;
  return query
  select n.id, n.numero_exibicao, f.mes, f.limite, f.margem, greatest(f.limite - f.margem, 0), public.whatsapp_franquia_usadas(f),
         f.reservadas, f.consumidas, f.gratuitas_confirmadas, f.cobradas, f.utilizadas_meta, f.confirmacao, f.reconciliada_em,
         public.whatsapp_franquia_situacao(f), f.alerta_80_em, f.alerta_90_em, f.alerta_100_em, n.franquia_ultimo_erro
    from public.whatsapp_numeros n
    join public.whatsapp_franquia f on f.numero_id = n.id and f.mes = public.whatsapp_mes_franquia(n.fuso_conta)
   where n.tenant_id = v_tenant and n.situacao <> 'desconectado'
   order by n.conectado_em;
end;
$$;

-- Janela (aviso na tela): inclui a franquia, com a mesma regra do envio.
create or replace function public.whatsapp_janela(p_conversa uuid)
returns table (aberta boolean, aberta_ate timestamptz, motivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c  public.conversas;
  v_n  public.whatsapp_numeros;
  v_fr public.whatsapp_franquia;
  v_motivo text;
begin
  select * into v_c from public.conversas c
   where c.id = p_conversa and c.tenant_id = public.tenant_atual()
     and (public.is_gerente() or exists (select 1 from public.clientes cl where cl.id = c.cliente_id and cl.owner_id = (select auth.uid())));
  if v_c.id is null then return; end if;
  select * into v_n from public.whatsapp_numeros where id = v_c.whatsapp_numero_id;
  select * into v_fr from public.whatsapp_franquia where numero_id = v_n.id and mes = public.whatsapp_mes_franquia(v_n.fuso_conta);
  v_motivo := case
    when not public.integracao_habilitada('whatsapp_oficial', v_c.tenant_id) then 'numero_inativo'
    when v_n.id is null then 'sem_numero'
    when v_n.situacao <> 'conectado' then 'numero_inativo'
    when v_n.bloqueado_por_cobranca then 'bloqueado_por_cobranca'
    when v_c.ultima_entrada_em is null or v_c.ultima_entrada_em <= now() - interval '24 hours' then 'fora_da_janela'
    when public.whatsapp_franquia_situacao(v_fr) = 'esgotada' then 'franquia_esgotada'
    when public.whatsapp_franquia_situacao(v_fr) = 'nao_confirmada' then 'franquia_nao_confirmada'
    else 'ok' end;
  return query select v_motivo = 'ok', v_c.ultima_entrada_em + interval '24 hours', v_motivo;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Destino único (Google Sheets e WhatsApp)
-- ---------------------------------------------------------------------------
-- Resultado: importada (cliente e oportunidade novos) | nova_oportunidade
-- (cliente existente, oportunidade nova no funil) | contato_existente
-- (negociação aberta reaproveitada) | reenvio (mesmo evento de novo).
create or replace function public.ingerir_lead_integracao(
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
  v_origem public.origem_negociacao;
  v_r      record;
  v_neg_re uuid;
  v_cli_re uuid;
  v_ext    text;
  v_atrib  jsonb;
begin
  select * into v_f from public.fontes_leads f where f.id = p_fonte;
  if v_f.id is null or v_f.status <> 'ativa' or v_f.tipo not in ('google_sheets', 'whatsapp_cloud') then
    raise exception 'Integração inativa ou inexistente.' using errcode = '42501';
  end if;
  v_origem := case when v_f.tipo = 'whatsapp_cloud' then 'whatsapp' else 'formulario' end;
  v_ext := v_f.id::text || ':' || p_external_id;
  v_atrib := coalesce(p_atribuicao, '{}'::jsonb) || jsonb_build_object('fonte', v_f.tipo, 'fonte_id', v_f.id);

  -- Mesmo contato chegando ao mesmo tempo (planilha + WhatsApp, webhooks repetidos): um por vez.
  if v_tel is not null or v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_f.tenant_id::text || ':contato:' || coalesce(v_tel, '') || '|' || coalesce(v_email, ''), 0));
    select c.id into v_cli from public.clientes c
     where c.tenant_id = v_f.tenant_id and c.deleted_at is null
       and ((v_tel is not null and (c.telefone = v_tel or c.whatsapp = v_tel)) or (v_email is not null and lower(c.email) = v_email))
     order by c.created_at limit 1;
  end if;

  -- Mesmo evento de novo (linha já importada, mensagem reenviada pela Meta): devolve o mesmo.
  select n.id, n.cliente_id into v_neg_re, v_cli_re
    from public.negociacoes n
   where n.tenant_id = v_f.tenant_id and n.origem = v_origem and n.external_id = v_ext;
  if v_neg_re is not null then
    return query select 'reenvio'::text, v_cli_re, v_neg_re;
    return;
  end if;

  -- Cliente da empresa com negociação ABERTA no funil de destino: reaproveita (etapa e responsável intactos).
  if v_cli is not null then
    select n.id into v_neg
      from public.negociacoes n join public.etapas_funil e on e.id = n.etapa_id
     where n.tenant_id = v_f.tenant_id and n.cliente_id = v_cli and e.funil_id = v_f.funil_id and e.tipo = 'aberta'
       and n.excluida_em is null and n.arquivada_em is null
     order by n.created_at desc limit 1;
    if v_neg is not null then
      update public.negociacoes
         set atribuicao = jsonb_set(coalesce(atribuicao, '{}'::jsonb), '{origens_adicionais}',
               coalesce(atribuicao -> 'origens_adicionais', '[]'::jsonb)
               || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                    'fonte_id', v_f.id, 'fonte', v_f.tipo, 'em', now(),
                    'meta_lead_id', p_atribuicao ->> 'meta_lead_id', 'ctwa_clid', p_atribuicao ->> 'ctwa_clid',
                    'anuncio_id', p_atribuicao ->> 'anuncio_id'))))
       where id = v_neg;
      insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, negociacao_id)
      values (v_f.tenant_id, v_f.id, left(p_external_id, 300), 'atualizado', v_neg);
      update public.fontes_leads set ultimo_lead_em = now() where id = v_f.id;
      return query select 'contato_existente'::text, v_cli, v_neg;
      return;
    end if;
  end if;

  -- Sem negociação aberta nesse funil: oportunidade nova (cliente reaproveitado, se existir).
  select * into v_r from public.ingerir_lead_nucleo(
    v_f.tenant_id, v_origem, v_ext,
    v_f.funil_id, v_f.etapa_id, v_f.responsavel_id, v_f.nicho_id, v_f.formulario_id,
    p_nome, p_telefone, p_email, p_empresa, null, null, v_atrib);
  insert into public.ingestao_eventos (tenant_id, fonte_id, external_id, resultado, negociacao_id)
  values (v_f.tenant_id, v_f.id, left(p_external_id, 300), case when v_r.criado then 'criado' else 'atualizado' end, v_r.negociacao_id);
  update public.fontes_leads set ultimo_lead_em = now() where id = v_f.id;
  return query select case when not v_r.criado then 'contato_existente' when v_cli is not null then 'nova_oportunidade' else 'importada' end,
                      v_r.cliente_id, v_r.negociacao_id;
end;
$$;

-- Planilha: mesma regra; coluna opcional com o ID do lead dos Lead Ads da Meta.
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

-- WhatsApp: toda mensagem nova passa pela MESMA regra de destino (antes, cliente
-- existente só tinha a conversa vinculada). Idempotente pelo ID da mensagem.
drop function public.whatsapp_registrar_entrada(text, text, text, text, text, text, timestamptz);
create function public.whatsapp_registrar_entrada(
  p_phone_number_id text, p_wa_message_id text, p_de text, p_nome text, p_tipo text, p_texto text, p_recebida_em timestamptz,
  p_referral jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n        public.whatsapp_numeros;
  v_f        public.fontes_leads;
  v_tel      text := public.normalizar_telefone(p_de);
  v_conv     uuid;
  v_cli      uuid;
  v_msg      uuid;
  v_lead     text := 'nenhum';
  v_r        record;
  v_conteudo text;
  v_atrib    jsonb := jsonb_build_object('numero', null);
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null then
    return jsonb_build_object('ignorado', 'numero_desconhecido');
  end if;
  if v_n.situacao = 'desconectado' then
    return jsonb_build_object('ignorado', 'numero_desconectado');
  end if;
  if not public.integracao_habilitada('whatsapp_oficial', v_n.tenant_id) then
    return jsonb_build_object('ignorado', 'whatsapp_desativado');
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

  -- Anúncio Click-to-WhatsApp: guarda só o que a Meta mandou (nada é presumido).
  if p_referral is not null and jsonb_typeof(p_referral) = 'object' then
    v_atrib := jsonb_strip_nulls(jsonb_build_object(
      'ctwa_clid', left(p_referral ->> 'ctwa_clid', 500),
      'anuncio_id', case when (p_referral ->> 'source_type') = 'ad' then left(p_referral ->> 'source_id', 40) end,
      'referral_tipo', left(p_referral ->> 'source_type', 20),
      'referral_url', left(p_referral ->> 'source_url', 500)));
  end if;
  v_atrib := jsonb_strip_nulls(v_atrib || jsonb_build_object('numero', v_n.numero_exibicao));

  -- Entrada sempre funciona; o lead segue a regra de destino única (só da MESMA empresa).
  select * into v_f from public.fontes_leads where id = v_n.fonte_id;
  if v_f.status = 'ativa' and v_n.situacao = 'conectado' then
    begin
      select * into v_r from public.ingerir_lead_integracao(v_f.id, 'wa:' || p_wa_message_id, coalesce(p_nome, v_tel), v_tel, null, null, v_atrib);
      v_cli := coalesce(v_cli, v_r.cliente_id);
      v_lead := v_r.resultado;
    exception when others then
      v_lead := 'erro';
      update public.whatsapp_numeros set ultimo_erro = left(sqlerrm, 300), ultimo_erro_em = now() where id = v_n.id;
    end;
  elsif v_cli is null then
    select c.id into v_cli from public.clientes c
     where c.tenant_id = v_n.tenant_id and c.deleted_at is null and (c.telefone = v_tel or c.whatsapp = v_tel)
     order by c.created_at limit 1;
  end if;
  if v_cli is not null then
    update public.conversas set cliente_id = v_cli where id = v_conv and cliente_id is null;
  end if;
  return jsonb_build_object('conversa', v_conv, 'mensagem', v_msg, 'lead', v_lead, 'cliente', v_cli);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permissões
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.whatsapp_mes_franquia(text)',
    'public.whatsapp_franquia_usadas(public.whatsapp_franquia)',
    'public.whatsapp_franquia_garantir(uuid, date)',
    'public.whatsapp_franquia_alertas(uuid, date)',
    'public.whatsapp_franquia_situacao(public.whatsapp_franquia)',
    'public.whatsapp_registrar_status(text, text, text, boolean, text, text, text)',
    'public.whatsapp_registrar_entrada(text, text, text, text, text, text, timestamptz, jsonb)',
    'public.whatsapp_numeros_para_reconciliar(integer)',
    'public.whatsapp_reconciliar_franquia(uuid, date, integer, text)',
    'public.whatsapp_reconciliar_erro(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  revoke all on function public.whatsapp_franquia_empresa() from public, anon;
  grant execute on function public.whatsapp_franquia_empresa() to authenticated;
end $$;
