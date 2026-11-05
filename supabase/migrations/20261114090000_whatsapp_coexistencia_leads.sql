set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- WhatsApp — Coexistência oficial (app WhatsApp Business + Cloud API):
-- leads só de quem chega pela API, sem inflar a negociação, histórico só com
-- autorização e indicadores na caixa de conversas.
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- O que já existia e continua igual: conexão pelo Embedded Signup v4 (modo
-- coexistência, sem registro por PIN), ecos do app (smb_message_echoes),
-- histórico (history), contatos (smb_app_state_sync), avisos de conta
-- (account_update), mensagem sem duplicar pelo ID da Meta, empresa resolvida
-- pelo phone_number_id, destino único (cliente e negociação aberta
-- reaproveitados; negociação encerrada → nova oportunidade), janela de 24 h,
-- franquia e limites.
--
-- O que muda:
--  1. Conversa iniciada pelo app (a empresa mandou pelo celular, ou o contato
--     veio do histórico) nunca vira lead sozinha (conversas.lead_automatico).
--     Quando o contato responde, a mensagem entra na conversa; o Administrador
--     leva para o funil com um clique (whatsapp_conversa_levar_ao_funil).
--  2. Mensagens seguintes de quem já tem negociação ABERTA no funil do número
--     só entram na conversa. Antes, CADA mensagem acrescentava uma "origem"
--     na negociação e um registro de entrada. Continuam passando pela entrada
--     de leads: a primeira mensagem de cada conversa, a mensagem que vem de
--     anúncio Click-to-WhatsApp (guarda o anúncio) e a de quem não tem
--     negociação aberta (primeiro contato que falhou ou ficou com a fonte
--     pausada; negociação anterior encerrada → nova oportunidade, como antes).
--  3. Histórico do app não abre a janela de 24 h (a Meta: mensagens do app e
--     do histórico não abrem nem afetam a janela da Cloud API).
--  4. Histórico antigo só com AUTORIZAÇÃO SEPARADA do Administrador
--     (whatsapp_historico_autorizar): dentro das 24 h da conexão (regra da
--     Meta), uma vez por conexão, auditado. Histórico sem esse pedido é
--     ignorado. A conexão passa a pedir só os contatos (nomes das conversas).
--     Histórico nunca cria lead e marca o contato como preexistente.
--  5. Rótulos em português para mensagem sem texto, não suportada, editada ou
--     apagada no app; a caixa mostra "Enviada pelo app" e "Histórico do app".
--  6. INICIALIZAÇÃO do número do app (whatsapp_numeros.inicializacao_concluida_em):
--     ao conectar (ou reconectar) em coexistência, o AVANTE ainda não sabe quem
--     já era cliente do app. Até o Administrador concluir (depois dos contatos
--     chegarem e de decidir sobre o histórico), nenhuma mensagem vira lead
--     sozinha: a conversa aparece na caixa marcada "origem a revisar" e o
--     Administrador leva ao funil ou marca "não é lead novo". Concluída, a
--     agenda do app recebida na conexão fica guardada: contato da agenda que
--     escrever depois também vai para revisão (não é certeza de que é antigo).
--     Contato que não está na agenda, nem no histórico, nem no cadastro do
--     AVANTE é indistinguível de um novo: vira lead (limitação documentada).
--     Número novo (Cloud API) não tem inicialização.
-- Sem mudança de RLS. Nenhuma negociação existente é alterada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Conversa que pode gerar lead automático
-- ---------------------------------------------------------------------------
alter table public.conversas add column lead_automatico boolean not null default true;
comment on column public.conversas.lead_automatico is
  'false = conversa iniciada pelo app WhatsApp Business (eco ou histórico): contato preexistente, nunca vira lead sozinho.';
-- Conversas que já existem: as que começaram por mensagem do app (eco ou histórico) são contato preexistente.
update public.conversas c set lead_automatico = false
 where c.whatsapp_numero_id is not null
   and (select m.origem_app from public.mensagens m where m.conversa_id = c.id order by m.created_at, m.id limit 1) is not null;

alter table public.conversas add column revisar_origem boolean not null default false;
comment on column public.conversas.revisar_origem is
  'true = contato de origem incerta (escreveu durante a inicialização do número do app, ou está na agenda do app): sem lead automático até o Administrador revisar.';

-- Inicialização do número do app (coexistência). NULL = em inicialização (sem leads automáticos).
alter table public.whatsapp_numeros add column inicializacao_concluida_em timestamptz;
comment on column public.whatsapp_numeros.inicializacao_concluida_em is
  'Coexistência: quando o Administrador concluiu a inicialização (contatos recebidos, histórico decidido). NULL = em inicialização, nenhum lead automático. Número novo (Cloud API): preenchido na conexão.';
-- Números que já existem continuam operando como antes.
update public.whatsapp_numeros set inicializacao_concluida_em = coalesce(conectado_em, now()) where inicializacao_concluida_em is null;

-- Contatos da agenda do app recebidos durante a inicialização (marcados ao concluir).
alter table public.whatsapp_contatos_app add column agenda_inicial boolean not null default false;

-- Conectar ou reconectar em coexistência (conectado_em muda) recomeça a inicialização.
create function public.whatsapp_numeros_inicializacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.conectado_em is distinct from old.conectado_em or new.modo_conexao is distinct from old.modo_conexao then
    new.inicializacao_concluida_em := case when new.modo_conexao = 'coexistencia' then null else coalesce(new.conectado_em, now()) end;
  end if;
  return new;
end;
$$;
revoke all on function public.whatsapp_numeros_inicializacao() from public, anon, authenticated;
create trigger whatsapp_numeros_inicializacao before insert or update of conectado_em, modo_conexao on public.whatsapp_numeros
  for each row execute function public.whatsapp_numeros_inicializacao();

-- ---------------------------------------------------------------------------
-- 2. Rótulo de mensagem sem texto
-- ---------------------------------------------------------------------------
create function public.whatsapp_rotulo_mensagem(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_tipo, '')
    when 'image' then '[Imagem — visualização ainda não disponível no AVANTE]'
    when 'audio' then '[Áudio — visualização ainda não disponível no AVANTE]'
    when 'voice' then '[Áudio — visualização ainda não disponível no AVANTE]'
    when 'video' then '[Vídeo — visualização ainda não disponível no AVANTE]'
    when 'document' then '[Documento — visualização ainda não disponível no AVANTE]'
    when 'sticker' then '[Figurinha — visualização ainda não disponível no AVANTE]'
    when 'location' then '[Localização — veja no WhatsApp]'
    when 'contacts' then '[Contato compartilhado — veja no WhatsApp]'
    when 'reaction' then '[Reação a uma mensagem]'
    when 'interactive' then '[Resposta de botão ou lista]'
    when 'button' then '[Resposta de botão]'
    when 'order' then '[Pedido do catálogo — veja no WhatsApp]'
    when 'system' then '[Aviso do WhatsApp]'
    when 'edit' then '[Mensagem editada no app WhatsApp Business]'
    when 'revoke' then '[Mensagem apagada no app WhatsApp Business]'
    when 'media_placeholder' then '[Mídia do histórico — conteúdo não enviado pela Meta]'
    when 'unsupported' then '[Mensagem não suportada pela API do WhatsApp (por exemplo, enquete ou visualização única) — veja no app]'
    else '[' || coalesce(nullif(left(p_tipo, 40), ''), 'Mensagem') || ' — visualização ainda não disponível no AVANTE]'
  end
$$;
revoke all on function public.whatsapp_rotulo_mensagem(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Conversa criada pelo app (eco, histórico): contato preexistente
--    (mesmo corpo de 20261104090000 + lead_automatico = false)
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_conversa_do_contato(p_numero public.whatsapp_numeros, p_tel text, p_nome text, p_em timestamptz)
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
    insert into public.conversas (tenant_id, telefone, whatsapp_numero_id, nome_contato, cliente_id, ultima_mensagem_em, escopo, lead_automatico)
    values (p_numero.tenant_id, p_tel, p_numero.id,
            left(coalesce(p_nome, (select a.nome from public.whatsapp_contatos_app a where a.numero_id = p_numero.id and a.telefone = p_tel)), 200),
            v_cli, coalesce(p_em, now()), 'rx7', false)
    returning id into v_conv;
  end if;
  return v_conv;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Mensagem recebida pela Cloud API
--    (mesmo corpo de 20261031090000 + rótulo + quando passar pela entrada de leads)
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_registrar_entrada(
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
  v_nova     boolean := false;
  v_auto     boolean;
  v_revisar  boolean;
  v_init     boolean;
  v_anuncio  boolean := p_referral is not null and jsonb_typeof(p_referral) = 'object';
  v_cli_tel  uuid;
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
  -- Número do app em inicialização: ninguém vira lead sozinho até o Administrador concluir.
  v_init := v_n.modo_conexao = 'coexistencia' and v_n.inicializacao_concluida_em is null;
  select c.id into v_cli_tel from public.clientes c
   where c.tenant_id = v_n.tenant_id and c.deleted_at is null and (c.telefone = v_tel or c.whatsapp = v_tel)
   order by c.created_at limit 1;
  select c.id, c.cliente_id, c.lead_automatico, c.revisar_origem into v_conv, v_cli, v_auto, v_revisar
    from public.conversas c where c.whatsapp_numero_id = v_n.id and c.telefone = v_tel;
  if v_conv is null then
    -- Origem incerta: contato que o AVANTE não conhece, escrevendo durante a inicialização ou
    -- que estava na agenda do app recebida na conexão. Vai para revisão, sem lead automático.
    v_revisar := v_cli_tel is null and (v_init or exists (
      select 1 from public.whatsapp_contatos_app a
       where a.numero_id = v_n.id and a.telefone = v_tel and a.agenda_inicial and a.removido_em is null));
    insert into public.conversas (tenant_id, telefone, whatsapp_numero_id, nome_contato, ultima_mensagem_em, ultima_entrada_em, escopo,
                                  lead_automatico, revisar_origem)
    values (v_n.tenant_id, v_tel, v_n.id, left(p_nome, 200), coalesce(p_recebida_em, now()), coalesce(p_recebida_em, now()), 'rx7',
            not v_revisar, v_revisar)
    returning id, lead_automatico into v_conv, v_auto;
    v_nova := true;
  end if;

  v_conteudo := case when p_tipo = 'text' then coalesce(nullif(btrim(p_texto), ''), '[mensagem vazia]')
                     else public.whatsapp_rotulo_mensagem(p_tipo) end;
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
  if v_anuncio then
    v_atrib := jsonb_strip_nulls(jsonb_build_object(
      'ctwa_clid', left(p_referral ->> 'ctwa_clid', 500),
      'anuncio_id', case when (p_referral ->> 'source_type') = 'ad' then left(p_referral ->> 'source_id', 40) end,
      'referral_tipo', left(p_referral ->> 'source_type', 20),
      'referral_url', left(p_referral ->> 'source_url', 500)));
  end if;
  v_atrib := jsonb_strip_nulls(v_atrib || jsonb_build_object('numero', v_n.numero_exibicao));

  select * into v_f from public.fontes_leads where id = v_n.fonte_id;

  if v_init then
    -- Inicialização do número do app: só a conversa (o Administrador decide quem vai ao funil).
    v_lead := 'em_inicializacao';
  elsif not v_auto then
    -- Conversa iniciada pelo app (contato preexistente) ou de origem incerta (em revisão).
    v_lead := case when v_revisar then 'revisar_origem' else 'contato_do_app' end;
  elsif v_f.status = 'ativa' and v_n.situacao = 'conectado' then
    if v_nova or v_anuncio or not exists (
         select 1 from public.negociacoes ng join public.etapas_funil e on e.id = ng.etapa_id
          where ng.tenant_id = v_n.tenant_id and ng.cliente_id in (v_cli, v_cli_tel) and e.funil_id = v_f.funil_id and e.tipo = 'aberta'
            and ng.excluida_em is null and ng.arquivada_em is null) then
      -- Destino único: reaproveita cliente e negociação aberta; sem aberta no funil, nova oportunidade.
      begin
        select * into v_r from public.ingerir_lead_integracao(v_f.id, 'wa:' || p_wa_message_id, coalesce(p_nome, v_tel), v_tel, null, null, v_atrib);
        v_cli := coalesce(v_cli, v_r.cliente_id);
        v_lead := v_r.resultado;
      exception when others then
        v_lead := 'erro';
        update public.whatsapp_numeros set ultimo_erro = left(sqlerrm, 300), ultimo_erro_em = now() where id = v_n.id;
      end;
    else
      -- Conversa em andamento com negociação aberta: só a conversa (sem origem nova a cada mensagem).
      v_lead := 'contato_existente';
    end if;
  end if;
  v_cli := coalesce(v_cli, v_cli_tel);
  if v_cli is not null then
    update public.conversas set cliente_id = v_cli where id = v_conv and cliente_id is null;
  end if;
  return jsonb_build_object('conversa', v_conv, 'mensagem', v_msg, 'lead', v_lead, 'cliente', v_cli);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Ecos e histórico do app: rótulos; histórico só autorizado e sem abrir a janela
--    (mesmo corpo de 20261104090000 + rótulo + autorização + janela)
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_registrar_mensagens_app(p_phone_number_id text, p_origem text, p_itens jsonb)
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
  -- Histórico só entra se o Administrador autorizou o pedido nesta conexão (whatsapp_historico_autorizar).
  if p_origem = 'historico' and not public.whatsapp_historico_pedido_vigente(v_n.id) then
    return jsonb_build_object('ignorado', 'historico_nao_autorizado');
  end if;
  update public.whatsapp_numeros set ultimo_evento_em = now() where id = v_n.id;

  for v_item in select * from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) loop
    v_tel := public.normalizar_telefone(v_item ->> 'telefone');
    continue when v_tel is null or nullif(v_item ->> 'id', '') is null;
    v_em := coalesce(nullif(v_item ->> 'em', '')::timestamptz, now());
    v_tipo := coalesce(nullif(v_item ->> 'tipo', ''), 'text');
    v_saida := coalesce((v_item ->> 'da_empresa')::boolean, p_origem = 'eco_app');
    v_conteudo := case when v_tipo = 'text' then coalesce(nullif(btrim(v_item ->> 'texto'), ''), '[mensagem vazia]')
                       else public.whatsapp_rotulo_mensagem(v_tipo) end;
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
    -- Só a ordem da lista muda. A janela de 24 h é aberta SÓ pela mensagem recebida pela
    -- Cloud API (webhook `messages`): ecos e histórico do app não a abrem (regra da Meta).
    -- Histórico anterior à conversa no AVANTE: o contato já conversava com a empresa
    -- (confirmado: sai da revisão de origem e nunca vira lead sozinho).
    update public.conversas
       set ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, '-infinity'), v_em),
           lead_automatico = lead_automatico and not (p_origem = 'historico' and v_em < created_at),
           revisar_origem = revisar_origem and not (p_origem = 'historico' and v_em < created_at)
     where id = v_conv;
  end loop;

  if p_origem = 'historico' and v_novas > 0 then
    update public.whatsapp_sincronizacoes set mensagens = mensagens + v_novas, atualizada_em = now()
     where numero_id = v_n.id and tipo = 'historico';
  end if;
  return jsonb_build_object('novas', v_novas, 'duplicadas', v_dup);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Histórico antigo: só com autorização separada do Administrador
-- ---------------------------------------------------------------------------
-- A Meta aceita o pedido de histórico só nas 24 h depois da conexão e uma vez por conexão
-- (cada reconexão no app é uma conexão nova). Margem de 10 min para o pedido chegar à Meta.

-- Pedido de histórico vigente para a conexão ATUAL do número (pedido antes de reconectar não conta).
-- "Pedida" sem resposta da Meta há mais de 5 min (servidor caiu no meio) não segura um novo pedido.
create function public.whatsapp_historico_pedido_vigente(p_numero uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.whatsapp_sincronizacoes s join public.whatsapp_numeros n on n.id = s.numero_id
     where s.numero_id = p_numero and s.tipo = 'historico' and s.situacao <> 'erro'
       and s.pedida_em >= n.conectado_em
       and not (s.situacao = 'pedida' and s.request_id is null and s.atualizada_em < now() - interval '5 minutes'));
$$;

-- Autorização do Administrador: confere as regras, registra o pedido (antes de falar com a Meta,
-- para o histórico que chegar ser reconhecido como autorizado) e audita. Devolve o phone_number_id.
create function public.whatsapp_historico_autorizar(p_numero uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_n      public.whatsapp_numeros;
begin
  perform public.exigir_integracao_habilitada('whatsapp_oficial', v_tenant);
  select * into v_n from public.whatsapp_numeros where id = p_numero and tenant_id = v_tenant for update;
  if v_n.id is null then raise exception 'Número não encontrado nesta empresa.' using errcode = 'P0002'; end if;
  if v_n.modo_conexao <> 'coexistencia' then
    raise exception 'O histórico só existe para número do app WhatsApp Business (coexistência).' using errcode = '23514';
  end if;
  if v_n.situacao <> 'conectado' then raise exception 'O número precisa estar conectado.' using errcode = '23514'; end if;
  if v_n.inicializacao_concluida_em is not null then
    raise exception 'A inicialização deste número já foi concluída: o histórico só pode ser pedido antes de ligar os leads automáticos.' using errcode = '23514';
  end if;
  if now() > v_n.conectado_em + interval '23 hours 50 minutes' then
    raise exception 'O prazo da Meta para importar o histórico (24 horas depois da conexão) terminou.' using errcode = '23514';
  end if;
  if public.whatsapp_historico_pedido_vigente(v_n.id) then
    raise exception 'O histórico deste número já foi pedido nesta conexão. A Meta só permite uma vez.' using errcode = '23505';
  end if;
  insert into public.whatsapp_sincronizacoes (numero_id, tipo, situacao, request_id, fase, progresso, mensagens, erro, pedida_em, atualizada_em)
  values (v_n.id, 'historico', 'pedida', null, null, null, 0, null, now(), now())
  on conflict (numero_id, tipo) do update
    set situacao = 'pedida', request_id = null, fase = null, progresso = null, mensagens = 0, erro = null,
        pedida_em = now(), atualizada_em = now();
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'whatsapp_historico_autorizado', v_tenant,
          jsonb_build_object('numero', v_n.id, 'conectado_em', v_n.conectado_em, 'prazo', v_n.conectado_em + interval '24 hours'));
  return v_n.phone_number_id;
end;
$$;

-- Andamento do histórico (mesmo corpo de 20261106090000) só para pedido autorizado na conexão atual.
create or replace function public.whatsapp_historico_andamento(p_phone_number_id text, p_fase integer, p_progresso integer, p_recusado boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.whatsapp_numeros;
begin
  select * into v_n from public.whatsapp_numeros where phone_number_id = p_phone_number_id;
  if v_n.id is null or v_n.situacao = 'desconectado' then return; end if;
  if not public.whatsapp_historico_pedido_vigente(v_n.id) then return; end if;
  update public.whatsapp_sincronizacoes
     set situacao = case when p_recusado then 'recusada' when p_progresso >= 100 and p_fase >= 2 then 'concluida' else 'recebendo' end,
         fase = coalesce(p_fase, fase),
         progresso = coalesce(least(greatest(p_progresso, 0), 100), progresso),
         erro = case when p_recusado then 'A empresa não compartilhou o histórico no app WhatsApp Business.' end,
         atualizada_em = now()
   where numero_id = v_n.id and tipo = 'historico';
end;
$$;

-- O que ainda segura a inicialização: 'contatos' (pedidos há menos de 1 h e ainda não chegaram)
-- ou 'historico' (autorizado e ainda chegando, com novidade nas últimas 6 h). NULL = pode concluir.
-- Histórico não pedido não segura: concluir sem pedir é decidir não importar.
create function public.whatsapp_inicializacao_pendencia(p_numero uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when n.inicializacao_concluida_em is not null then null
    when c.situacao = 'pedida' and c.atualizada_em >= now() - interval '1 hour' then 'contatos'
    when h.numero_id is not null and h.pedida_em >= n.conectado_em and h.situacao in ('pedida', 'recebendo')
         and h.atualizada_em >= now() - interval '6 hours' then 'historico'
  end
    from public.whatsapp_numeros n
    left join public.whatsapp_sincronizacoes c on c.numero_id = n.id and c.tipo = 'contatos'
    left join public.whatsapp_sincronizacoes h on h.numero_id = n.id and h.tipo = 'historico'
   where n.id = p_numero;
$$;

-- Para a tela do Administrador: inicialização de cada número do app (contatos, histórico, revisão).
create function public.whatsapp_inicializacao_da_empresa()
returns table (numero_id uuid, em_inicializacao boolean, concluida_em timestamptz, prazo_historico timestamptz, pode_pedir_historico boolean,
               historico text, contatos text, pendencia text, a_revisar integer)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.inicializacao_concluida_em is null, n.inicializacao_concluida_em, n.conectado_em + interval '24 hours',
         n.inicializacao_concluida_em is null and n.situacao = 'conectado' and now() <= n.conectado_em + interval '23 hours 50 minutes'
           and not public.whatsapp_historico_pedido_vigente(n.id),
         case when h.numero_id is not null and h.pedida_em >= n.conectado_em then h.situacao
              when n.inicializacao_concluida_em is not null then 'nao_importado'
              when now() <= n.conectado_em + interval '23 hours 50 minutes' then 'nao_pedido'
              else 'prazo_encerrado' end,
         case when c.numero_id is null then 'nao_pedido'
              when c.situacao = 'pedida' and c.atualizada_em < now() - interval '1 hour' then 'sem_resposta'
              else c.situacao end,
         public.whatsapp_inicializacao_pendencia(n.id),
         (select count(*)::integer from public.conversas cv where cv.whatsapp_numero_id = n.id and cv.revisar_origem)
    from public.whatsapp_numeros n
    left join public.whatsapp_sincronizacoes h on h.numero_id = n.id and h.tipo = 'historico'
    left join public.whatsapp_sincronizacoes c on c.numero_id = n.id and c.tipo = 'contatos'
   where n.tenant_id = public.tenant_atual() and n.modo_conexao = 'coexistencia' and n.situacao <> 'desconectado'
     and public.tem_papel_no_tenant(n.tenant_id, array['admin_empresa', 'gerente']::public.tenant_papel[]);
$$;

-- O Administrador conclui a inicialização e liga os leads automáticos do número do app.
-- A agenda do app recebida até aqui fica guardada como "agenda inicial" (vai para revisão se escrever).
create function public.whatsapp_inicializacao_concluir(p_numero uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.exigir_administrador_integracoes();
  v_n      public.whatsapp_numeros;
  v_pend   text;
  v_agenda integer;
  v_rev    integer;
  v_hist   text;
begin
  perform public.exigir_integracao_habilitada('whatsapp_oficial', v_tenant);
  select * into v_n from public.whatsapp_numeros where id = p_numero and tenant_id = v_tenant for update;
  if v_n.id is null then raise exception 'Número não encontrado nesta empresa.' using errcode = 'P0002'; end if;
  if v_n.modo_conexao <> 'coexistencia' then raise exception 'Só o número do app WhatsApp Business tem inicialização.' using errcode = '23514'; end if;
  if v_n.situacao <> 'conectado' then raise exception 'O número precisa estar conectado.' using errcode = '23514'; end if;
  if v_n.inicializacao_concluida_em is not null then
    raise exception 'A inicialização deste número já foi concluída.' using errcode = '23505';
  end if;
  v_pend := public.whatsapp_inicializacao_pendencia(v_n.id);
  if v_pend = 'contatos' then
    raise exception 'Os contatos do app ainda não chegaram. Aguarde alguns minutos (até 1 hora após a conexão).' using errcode = '23514';
  elsif v_pend = 'historico' then
    raise exception 'O histórico autorizado ainda está chegando. Conclua quando terminar.' using errcode = '23514';
  end if;
  update public.whatsapp_numeros set inicializacao_concluida_em = now() where id = v_n.id;
  update public.whatsapp_contatos_app set agenda_inicial = true where numero_id = v_n.id and removido_em is null;
  get diagnostics v_agenda = row_count;
  select count(*) into v_rev from public.conversas where whatsapp_numero_id = v_n.id and revisar_origem;
  select s.situacao into v_hist from public.whatsapp_sincronizacoes s
   where s.numero_id = v_n.id and s.tipo = 'historico' and s.pedida_em >= v_n.conectado_em;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'whatsapp_inicializacao_concluida', v_tenant,
          jsonb_build_object('numero', v_n.id, 'contatos_agenda', v_agenda, 'conversas_a_revisar', v_rev, 'historico', coalesce(v_hist, 'nao_importado')));
  return jsonb_build_object('contatos_agenda', v_agenda, 'a_revisar', v_rev);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Caixa de conversas: origem da mensagem e conversa no funil
-- ---------------------------------------------------------------------------
-- Mesma view de 20261007160000; o "m.*" de agora inclui as colunas criadas depois
-- (origem_app, status_detalhe…), acrescentadas no fim. RLS de mensagens continua valendo.
create or replace view public.mensagens_visiveis
  with (security_invoker = true)
  as
  select m.*
  from public.mensagens m
  where not exists (
    select 1 from public.mensagem_exclusoes me
    where me.mensagem_id = m.id
      and me.usuario_id = (select auth.uid())
  );

-- Situação da conversa no funil do número, para o Administrador (quem vê as conversas sem cliente).
create function public.whatsapp_conversa_no_funil(p_conversa uuid)
returns table (contato_do_app boolean, cliente_id uuid, negociacao_id uuid, funil text, etapa text, fonte_ativa boolean, pode_levar boolean,
               revisar_origem boolean, em_inicializacao boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_atual();
  v_cv     public.conversas;
  v_n      public.whatsapp_numeros;
  v_f      public.fontes_leads;
  v_cli    uuid;
begin
  if v_tenant is null or not public.tem_papel_no_tenant(v_tenant, array['admin_empresa', 'gerente']::public.tenant_papel[]) then
    return;
  end if;
  select * into v_cv from public.conversas c where c.id = p_conversa and c.tenant_id = v_tenant;
  if v_cv.id is null or v_cv.whatsapp_numero_id is null then return; end if;
  select * into v_n from public.whatsapp_numeros where id = v_cv.whatsapp_numero_id;
  select * into v_f from public.fontes_leads where id = v_n.fonte_id;
  v_cli := coalesce(v_cv.cliente_id, (select c.id from public.clientes c
                                       where c.tenant_id = v_tenant and c.deleted_at is null and (c.telefone = v_cv.telefone or c.whatsapp = v_cv.telefone)
                                       order by c.created_at limit 1));
  return query
  select not v_cv.lead_automatico, v_cli, ng.id, fu.nome, e.nome, coalesce(v_f.status = 'ativa', false),
         ng.id is null and coalesce(v_f.status = 'ativa', false) and v_n.situacao <> 'desconectado',
         v_cv.revisar_origem and ng.id is null, v_n.modo_conexao = 'coexistencia' and v_n.inicializacao_concluida_em is null
    from (select 1) x
    left join lateral (
      select n2.id, n2.etapa_id from public.negociacoes n2 join public.etapas_funil e2 on e2.id = n2.etapa_id
       where n2.tenant_id = v_tenant and n2.cliente_id = v_cli and e2.funil_id = v_f.funil_id and e2.tipo = 'aberta'
         and n2.excluida_em is null and n2.arquivada_em is null
       order by n2.created_at desc limit 1) ng on true
    left join public.etapas_funil e on e.id = ng.etapa_id
    left join public.funis fu on fu.id = v_f.funil_id;
end;
$$;

-- "Levar para o funil": o Administrador cria a negociação de uma conversa (ex.: contato do app)
-- no funil e na etapa configurados para o número, pela mesma regra de destino único.
create function public.whatsapp_conversa_levar_ao_funil(p_conversa uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
  v_cv     public.conversas;
  v_n      public.whatsapp_numeros;
  v_f      public.fontes_leads;
  v_info   record;
  v_r      record;
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa', 'gerente']::public.tenant_papel[])
     or not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Somente o Administrador da empresa leva uma conversa para o funil.' using errcode = '42501';
  end if;
  perform public.exigir_integracao_habilitada('whatsapp_oficial', v_tenant);
  select * into v_cv from public.conversas c where c.id = p_conversa and c.tenant_id = v_tenant for update;
  if v_cv.id is null or v_cv.whatsapp_numero_id is null then raise exception 'Conversa não encontrada.' using errcode = 'P0002'; end if;
  select * into v_n from public.whatsapp_numeros where id = v_cv.whatsapp_numero_id;
  select * into v_f from public.fontes_leads where id = v_n.fonte_id;
  if v_f.id is null or v_f.status <> 'ativa' then
    raise exception 'A entrada de leads deste número está pausada em Integrações.' using errcode = '23514';
  end if;
  select * into v_info from public.whatsapp_conversa_no_funil(p_conversa);
  if v_info.negociacao_id is not null then
    raise exception 'Este contato já tem negociação aberta no funil do número.' using errcode = '23505';
  end if;
  select * into v_r from public.ingerir_lead_integracao(
    v_f.id, 'conversa:' || v_cv.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    coalesce(v_cv.nome_contato, v_cv.telefone), v_cv.telefone, null, null,
    jsonb_build_object('numero', v_n.numero_exibicao, 'entrada', 'conversa_levada_ao_funil'));
  update public.conversas set cliente_id = coalesce(cliente_id, v_r.cliente_id), revisar_origem = false where id = v_cv.id;
  return v_r.negociacao_id;
end;
$$;

-- Revisão de origem: o Administrador marca que o contato NÃO é lead novo (fica só a conversa).
create function public.whatsapp_conversa_revisada(p_conversa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa', 'gerente']::public.tenant_papel[])
     or not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Somente o Administrador da empresa revisa a origem das conversas.' using errcode = '42501';
  end if;
  update public.conversas set revisar_origem = false where id = p_conversa and tenant_id = v_tenant and revisar_origem;
  if not found then raise exception 'Esta conversa não está aguardando revisão.' using errcode = 'P0002'; end if;
end;
$$;

-- Conversas aguardando revisão de origem (para marcar na caixa do Administrador).
create function public.whatsapp_conversas_a_revisar()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cv.id from public.conversas cv
   where cv.tenant_id = public.tenant_atual() and cv.revisar_origem
     and public.tem_papel_no_tenant(cv.tenant_id, array['admin_empresa', 'gerente']::public.tenant_papel[]);
$$;

-- ---------------------------------------------------------------------------
-- 8. Permissões (create or replace mantém as anteriores; reafirmadas aqui)
-- ---------------------------------------------------------------------------
grant select on public.mensagens_visiveis to authenticated;
revoke all on function public.whatsapp_conversa_do_contato(public.whatsapp_numeros, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_registrar_entrada(text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_entrada(text, text, text, text, text, text, timestamptz, jsonb) to service_role;
revoke all on function public.whatsapp_registrar_mensagens_app(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_mensagens_app(text, text, jsonb) to service_role;
revoke all on function public.whatsapp_historico_pedido_vigente(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_historico_andamento(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_historico_andamento(text, integer, integer, boolean) to service_role;
revoke all on function public.whatsapp_historico_autorizar(uuid) from public, anon;
grant execute on function public.whatsapp_historico_autorizar(uuid) to authenticated;
revoke all on function public.whatsapp_inicializacao_pendencia(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_inicializacao_da_empresa() from public, anon;
grant execute on function public.whatsapp_inicializacao_da_empresa() to authenticated;
revoke all on function public.whatsapp_inicializacao_concluir(uuid) from public, anon;
grant execute on function public.whatsapp_inicializacao_concluir(uuid) to authenticated;
revoke all on function public.whatsapp_conversa_revisada(uuid) from public, anon;
grant execute on function public.whatsapp_conversa_revisada(uuid) to authenticated;
revoke all on function public.whatsapp_conversas_a_revisar() from public, anon;
grant execute on function public.whatsapp_conversas_a_revisar() to authenticated;
revoke all on function public.whatsapp_conversa_no_funil(uuid) from public, anon;
grant execute on function public.whatsapp_conversa_no_funil(uuid) to authenticated;
revoke all on function public.whatsapp_conversa_levar_ao_funil(uuid) from public, anon;
grant execute on function public.whatsapp_conversa_levar_ao_funil(uuid) to authenticated;
