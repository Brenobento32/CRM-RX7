set client_encoding = 'UTF8';
-- ===========================================================================
-- PROPOSTA, NÃO APLICADA: evento de entrada só para lead novo de verdade,
-- oposição do titular à medição e identificação da modalidade do valor.
-- Depende de 20261115090000 (valor por empresa). Não mexe na trava, na
-- situação das conexões, no hash, no mapeamento nem em outra integração.
--
--  1. EVENTO DE ENTRADA ("Lead Novo" ou o nome que a empresa der à etapa em que
--     a negociação NASCE), nas empresas com a regra ligada
--     (meta_conversoes_entrada_empresa; sem linha, nada muda): só sai quando o lead
--     foi cadastrado na Meta (created_time do formulário) no máximo 24 h antes de
--     entrar no CRM. Lead antigo importado ou sincronizado agora, ou sem a data do
--     cadastro, fica "descartado" com o motivo. Decidido no envio (capi_reservar),
--     porque as respostas do formulário (onde a planilha grava o created_time)
--     chegam depois da criação da negociação. A recuperação controlada nunca
--     recupera evento de entrada (20261115090200), em nenhuma empresa.
--  2. OPOSIÇÃO À MEDIÇÃO (LGPD, art. 18, § 2º): o Administrador registra, na ficha
--     do cliente, que o titular se opôs. A partir daí nenhum evento das negociações
--     desse cliente sai: os pendentes viram "descartado" na hora, os novos já nascem
--     "descartado", a fila nunca os reserva e a recuperação não os cria. Auditado.
--  3. MODALIDADE DO VALOR: a reserva devolve a modalidade (tcv, mrr, venda) junto
--     com o valor, e o evento guarda o valor e a modalidade informados.
--  4. CORTE POR DATA DE ATIVAÇÃO, nas empresas com o corte armado
--     (meta_conversoes_corte_empresa; sem linha, nada muda): a PRIMEIRA vez que a
--     conexão passa a "ativa" depois de armado, a data vira o início da
--     transmissão. Nada com ocorrência anterior sai, nunca: evento já enfileirado,
--     retido, tentativa pendente, reprocessamento, recuperação ou forçado por fora
--     vira "descartado" com o motivo. Armado e ainda não ativado: nada sai. A data
--     de ocorrência (event_time) nunca é alterada.
--
-- Efeito ao aplicar: nenhum envio muda enquanto a empresa estiver travada/pausada.
-- Demais empresas (hoje nenhuma tem CAPI): as regras 1 e 4 só valem com a linha da
-- empresa; a oposição só age quando o Administrador a registra; a modalidade só
-- acompanha valor já aprovado. Sem isso, o envio continua igual.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Situação nova "descartado" (não enviado, com o motivo em ultimo_erro)
-- ---------------------------------------------------------------------------
alter table public.meta_conversoes_eventos drop constraint meta_conversoes_eventos_situacao_check;
alter table public.meta_conversoes_eventos add constraint meta_conversoes_eventos_situacao_check
  check (situacao in ('pendente', 'enviando', 'enviado', 'rejeitado', 'sem_correspondencia', 'expirado', 'valor_pendente', 'descartado'));

alter table public.meta_conversoes_eventos
  add column evento_entrada   boolean not null default false,
  add column valor_informado  numeric(14, 2),
  add column modalidade_valor public.tipo_venda;
comment on column public.meta_conversoes_eventos.evento_entrada is
  'A negociação nasceu nesta etapa (evento de entrada): só sai para lead cadastrado na Meta até 24 h antes; nunca é recuperado.';
comment on column public.meta_conversoes_eventos.valor_informado is
  'Valor calculado na reserva (fechamentos.valor_vendido, BRL), exatamente como foi para a Meta. Nulo = sem valor.';
comment on column public.meta_conversoes_eventos.modalidade_valor is
  'O que o valor informado representa: tcv = total do contrato; mrr = uma mensalidade; venda = venda única.';

-- ---------------------------------------------------------------------------
-- 2. Data do cadastro do lead na Meta (formulário)
--    Planilha nativa: resposta "created_time" (texto, com fuso). Lead Ads direto:
--    atribuicao.created_time. Inválida ou ausente = nulo (nunca erro).
-- ---------------------------------------------------------------------------
create function public.capi_momento_meta(p_texto text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_texto is null or btrim(p_texto) !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return btrim(p_texto)::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public.capi_momento_meta(text) from public, anon, authenticated;

create function public.capi_lead_criado_em(p_negociacao uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.capi_momento_meta(r.resposta)
       from public.negociacao_respostas r
      where r.negociacao_id = p_negociacao and r.pergunta = 'created_time'
      order by r.recebida_em desc limit 1),
    (select public.capi_momento_meta(n.atribuicao ->> 'created_time') from public.negociacoes n where n.id = p_negociacao))
$$;
revoke all on function public.capi_lead_criado_em(uuid) from public, anon, authenticated;

-- A regra do evento de entrada vale POR EMPRESA (uma linha = regra ligada). Sem linha,
-- o envio da empresa continua exatamente como hoje. Só service_role grava; auditado.
create table public.meta_conversoes_entrada_empresa (
  tenant_id    uuid primary key references public.tenants (id) on delete cascade,
  motivo       text not null check (length(btrim(motivo)) between 10 and 300),
  aprovado_em  timestamptz not null default now()
);
alter table public.meta_conversoes_entrada_empresa enable row level security;
revoke all on public.meta_conversoes_entrada_empresa from public, anon, authenticated;
comment on table public.meta_conversoes_entrada_empresa is
  'Empresas em que o evento de entrada só sai para lead cadastrado na Meta até 24 h antes de entrar no CRM. Só service_role grava; auditado.';

create function public.meta_conversoes_entrada_empresa_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_regra_entrada_alterada', coalesce(new.tenant_id, old.tenant_id),
          jsonb_build_object('operacao', tg_op,
                             'antes', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'depois', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return null;
end;
$$;
revoke all on function public.meta_conversoes_entrada_empresa_auditar() from public, anon, authenticated;
create trigger meta_conversoes_entrada_empresa_auditoria after insert or update or delete on public.meta_conversoes_entrada_empresa
  for each row execute function public.meta_conversoes_entrada_empresa_auditar();

-- ---------------------------------------------------------------------------
-- 3. Oposição do titular à medição
-- ---------------------------------------------------------------------------
create table public.meta_conversoes_oposicoes (
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  cliente_id      uuid not null references public.clientes (id) on delete cascade,
  canal           text not null check (canal in ('email', 'whatsapp', 'telefone', 'presencial', 'outro')),
  observacao      text check (observacao is null or length(observacao) <= 300),
  registrada_por  uuid,
  registrada_em   timestamptz not null default now(),
  primary key (tenant_id, cliente_id)
);
alter table public.meta_conversoes_oposicoes enable row level security;
revoke all on public.meta_conversoes_oposicoes from public, anon, authenticated;
comment on table public.meta_conversoes_oposicoes is
  'Titulares que se opuseram à medição de anúncios (Conversões do CRM). Nenhum evento das negociações do cliente sai para a Meta. Escrita só por capi_registrar_oposicao (Administrador), auditada.';

create function public.capi_oposicao_da_negociacao(p_negociacao uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.negociacoes n
                   join public.meta_conversoes_oposicoes o on o.tenant_id = n.tenant_id and o.cliente_id = n.cliente_id
                  where n.id = p_negociacao)
$$;
revoke all on function public.capi_oposicao_da_negociacao(uuid) from public, anon, authenticated;

-- Administrador da empresa (ou Super Admin pelo "Acessar CRM"): registra a oposição
-- e descarta na hora o que ainda não saiu. Não desfaz o que a Meta já recebeu.
create function public.capi_registrar_oposicao(p_cliente uuid, p_canal text, p_observacao text default null)
returns table (registrada_em timestamptz, eventos_descartados integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_em     timestamptz;
  v_desc   integer;
begin
  v_tenant := public.exigir_administrador_integracoes();
  if p_cliente is null or not exists (select 1 from public.clientes c where c.id = p_cliente and c.tenant_id = v_tenant) then
    raise exception 'Cliente não encontrado nesta empresa.' using errcode = 'P0002';
  end if;
  if p_canal is null or p_canal not in ('email', 'whatsapp', 'telefone', 'presencial', 'outro') then
    raise exception 'Informe por qual canal o titular pediu (e-mail, WhatsApp, telefone, presencial ou outro).' using errcode = '22023';
  end if;
  if p_observacao is not null and length(btrim(p_observacao)) > 300 then
    raise exception 'A observação tem no máximo 300 caracteres (não registre dados pessoais nela).' using errcode = '22023';
  end if;

  insert into public.meta_conversoes_oposicoes (tenant_id, cliente_id, canal, observacao, registrada_por)
  values (v_tenant, p_cliente, p_canal, nullif(btrim(coalesce(p_observacao, '')), ''), (select auth.uid()))
  on conflict (tenant_id, cliente_id) do nothing;
  select o.registrada_em into v_em from public.meta_conversoes_oposicoes o where o.tenant_id = v_tenant and o.cliente_id = p_cliente;

  update public.meta_conversoes_eventos e
     set situacao = 'descartado', ultimo_erro = 'Titular se opôs à medição: não é enviado à Meta.', bloqueado_ate = null
   where e.tenant_id = v_tenant
     and e.situacao in ('pendente', 'valor_pendente', 'rejeitado')
     and e.negociacao_id in (select n.id from public.negociacoes n where n.tenant_id = v_tenant and n.cliente_id = p_cliente);
  get diagnostics v_desc = row_count;

  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_oposicao_registrada', v_tenant,
          jsonb_build_object('cliente_id', p_cliente, 'canal', p_canal, 'eventos_descartados', v_desc));

  return query select v_em, v_desc;
end;
$$;
revoke all on function public.capi_registrar_oposicao(uuid, text, text) from public, anon;
grant execute on function public.capi_registrar_oposicao(uuid, text, text) to authenticated;

-- Ficha do cliente: a seção aparece só para o Administrador e só se a empresa tem conexão de conversões.
create function public.capi_oposicao_do_cliente(p_cliente uuid)
returns table (aplicavel boolean, registrada_em timestamptz, canal text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := public.exigir_administrador_integracoes();
  if p_cliente is null or not exists (select 1 from public.clientes c where c.id = p_cliente and c.tenant_id = v_tenant) then
    return;
  end if;
  return query
  select exists (select 1 from public.meta_conversoes_conexoes c where c.tenant_id = v_tenant), o.registrada_em, o.canal
    from (select 1) x
    left join public.meta_conversoes_oposicoes o on o.tenant_id = v_tenant and o.cliente_id = p_cliente;
end;
$$;
revoke all on function public.capi_oposicao_do_cliente(uuid) from public, anon;
grant execute on function public.capi_oposicao_do_cliente(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Todo evento novo (gatilho da fila ou recuperação) passa por aqui:
--    marca o evento de entrada e já nasce "descartado" se houver oposição.
--    Não toca no gatilho meta_conversoes_enfileirar (onde fica a trava).
-- ---------------------------------------------------------------------------
create function public.meta_conversoes_eventos_preparar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.evento_entrada := exists (select 1 from public.historico_etapas h
                                 where h.negociacao_id = new.negociacao_id and h.etapa_nova_id = new.etapa_id
                                   and h.etapa_anterior_id is null);
  if new.situacao in ('pendente', 'valor_pendente') and public.capi_oposicao_da_negociacao(new.negociacao_id) then
    new.situacao := 'descartado';
    new.ultimo_erro := 'Titular se opôs à medição: não é enviado à Meta.';
  end if;
  return new;
end;
$$;
revoke all on function public.meta_conversoes_eventos_preparar() from public, anon, authenticated;
create trigger meta_conversoes_eventos_preparar before insert on public.meta_conversoes_eventos
  for each row execute function public.meta_conversoes_eventos_preparar();

-- ---------------------------------------------------------------------------
-- 5. Corte por data de ativação (por empresa). Uma linha = corte armado.
--    transmitir_desde nulo = armado, ainda não ativado (nada sai); preenchido
--    automaticamente na primeira passagem da conexão para "ativa"; depois disso
--    não muda sozinho (pausar e retomar não move o corte). Só service_role grava;
--    auditado.
-- ---------------------------------------------------------------------------
create table public.meta_conversoes_corte_empresa (
  tenant_id         uuid primary key references public.tenants (id) on delete cascade,
  transmitir_desde  timestamptz,
  motivo            text not null check (length(btrim(motivo)) between 10 and 300),
  armado_em         timestamptz not null default now()
);
alter table public.meta_conversoes_corte_empresa enable row level security;
revoke all on public.meta_conversoes_corte_empresa from public, anon, authenticated;
comment on table public.meta_conversoes_corte_empresa is
  'Corte por data de ativação: nenhum evento com ocorrência anterior a transmitir_desde vai para a Meta. Preenchido na primeira ativação depois de armado. Só service_role grava; auditado.';

create function public.meta_conversoes_corte_empresa_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_corte_alterado', coalesce(new.tenant_id, old.tenant_id),
          jsonb_build_object('operacao', tg_op,
                             'antes', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'depois', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return null;
end;
$$;
revoke all on function public.meta_conversoes_corte_empresa_auditar() from public, anon, authenticated;
create trigger meta_conversoes_corte_empresa_auditoria after insert or update or delete on public.meta_conversoes_corte_empresa
  for each row execute function public.meta_conversoes_corte_empresa_auditar();

-- Sem corte: -infinity (nada muda). Armado e não ativado: infinity (nada sai). Ativado: a data.
create function public.capi_corte_da_empresa(p_tenant uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.tenant_id is null then '-infinity'::timestamptz
              else coalesce(c.transmitir_desde, 'infinity'::timestamptz) end
    from (select 1) x
    left join public.meta_conversoes_corte_empresa c on c.tenant_id = p_tenant
$$;
revoke all on function public.capi_corte_da_empresa(uuid) from public, anon, authenticated;

-- A primeira passagem da conexão para "ativa" (Ativar ou Retomar) fixa o início da transmissão.
create function public.meta_conversoes_conexoes_corte()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.situacao = 'ativa' and (tg_op = 'INSERT' or old.situacao is distinct from 'ativa') then
    update public.meta_conversoes_corte_empresa set transmitir_desde = now()
     where tenant_id = new.tenant_id and transmitir_desde is null;
  end if;
  return null;
end;
$$;
revoke all on function public.meta_conversoes_conexoes_corte() from public, anon, authenticated;
create trigger meta_conversoes_conexoes_corte after insert or update of situacao on public.meta_conversoes_conexoes
  for each row execute function public.meta_conversoes_conexoes_corte();

-- Todo evento que nasce ou volta para a fila ("pendente"/"retido") com ocorrência
-- anterior ao corte vira "descartado" na hora (enfileirado antes, nova tentativa,
-- reprocessamento, correção do valor, recuperação, alteração por fora).
create function public.meta_conversoes_eventos_corte()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.situacao in ('pendente', 'valor_pendente')
     and (tg_op = 'INSERT' or old.situacao is distinct from new.situacao)
     and new.event_time < public.capi_corte_da_empresa(new.tenant_id) then
    new.situacao := 'descartado';
    new.ultimo_erro := 'Anterior ao início da transmissão (corte da ativação): não é enviado.';
  end if;
  return new;
end;
$$;
revoke all on function public.meta_conversoes_eventos_corte() from public, anon, authenticated;
create trigger meta_conversoes_eventos_corte before insert or update of situacao on public.meta_conversoes_eventos
  for each row execute function public.meta_conversoes_eventos_corte();

-- Reenviar (Administrador): recusa evento anterior ao início da transmissão, com a mensagem certa.
create or replace function public.capi_reprocessar(p_evento bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.capi_exigir();
begin
  if exists (select 1 from public.meta_conversoes_eventos
              where id = p_evento and tenant_id = v_tenant and event_time < public.capi_corte_da_empresa(v_tenant)) then
    raise exception 'Este evento é anterior ao início da transmissão e não é enviado à Meta.' using errcode = '23514';
  end if;
  update public.meta_conversoes_eventos
     set situacao = 'pendente', tentativas = 0, proxima_tentativa_em = now(), ultimo_erro = null, bloqueado_ate = null
   where id = p_evento and tenant_id = v_tenant and situacao = 'rejeitado' and lead_id is not null
     and event_time > now() - interval '7 days';
  if not found then
    raise exception 'Só eventos rejeitados, com ID de lead e com menos de 7 dias podem ser reenviados.' using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. capi_reservar: corpo de 20261115090000 + oposição + entrada + modalidade + corte.
--    A linha da trava (meta_conversoes_travas) continua igual.
--    O retorno ganha a coluna "modalidade": a Edge Function antiga a ignora.
-- ---------------------------------------------------------------------------
drop function public.capi_reservar(integer);
create function public.capi_reservar(p_limite integer default 50)
returns table (evento_id bigint, tenant_id uuid, conexao_id uuid, dataset_id text, codigo_teste text, evento text, event_id text,
               event_time_unix bigint, lead_id text, valor numeric, moeda text, modalidade text, email text, telefone text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.meta_conversoes_eventos e set situacao = 'expirado', ultimo_erro = 'Mais de 7 dias: a Meta não aceita mais este evento.'
   where e.situacao in ('pendente', 'valor_pendente') and e.event_time < now() - interval '7 days';
  -- Corte da ativação: o que já estava na fila com ocorrência anterior nunca sai.
  update public.meta_conversoes_eventos e
     set situacao = 'descartado', ultimo_erro = 'Anterior ao início da transmissão (corte da ativação): não é enviado.'
   where e.situacao in ('pendente', 'valor_pendente') and e.event_time < public.capi_corte_da_empresa(e.tenant_id);
  -- Titular que se opôs à medição: nada sai.
  update public.meta_conversoes_eventos e
     set situacao = 'descartado', ultimo_erro = 'Titular se opôs à medição: não é enviado à Meta.'
   where e.situacao in ('pendente', 'valor_pendente') and public.capi_oposicao_da_negociacao(e.negociacao_id);
  -- Evento de entrada: só lead cadastrado na Meta até 24 h antes de entrar no CRM.
  -- Sem a data do cadastro, espera 1 h (as respostas chegam logo depois) e então descarta.
  update public.meta_conversoes_eventos e
     set situacao = 'descartado',
         ultimo_erro = case
           when x.criado is null then 'Sem a data do cadastro na Meta: o evento de entrada não é enviado.'
           when x.criado > e.event_time + interval '1 hour' then 'Data do cadastro na Meta posterior à entrada no CRM: o evento de entrada não é enviado.'
           else 'Lead cadastrado na Meta mais de 24 h antes de entrar no CRM (importado ou sincronizado depois): o evento de entrada não é enviado.' end
    from (select e2.id, public.capi_lead_criado_em(e2.negociacao_id) as criado
            from public.meta_conversoes_eventos e2
           where e2.situacao = 'pendente' and e2.evento_entrada
             and exists (select 1 from public.meta_conversoes_entrada_empresa r where r.tenant_id = e2.tenant_id)) x
   where e.id = x.id
     and ((x.criado is null and e.created_at < now() - interval '1 hour')
          or x.criado > e.event_time + interval '1 hour'
          or e.event_time - x.criado > interval '24 hours');
  -- Etapa de fechamento sem venda válida (anulada antes do envio ou sem registro): nunca vai para a Meta.
  update public.meta_conversoes_eventos e
     set situacao = 'rejeitado', ultimo_erro = 'Venda anulada ou sem fechamento válido: não é informada à Meta.'
   where e.situacao in ('pendente', 'valor_pendente')
     and exists (select 1 from public.etapas_funil x where x.id = e.etapa_id and x.tipo = 'ganha')
     and not exists (select 1 from public.fechamentos f where f.negociacao_id = e.negociacao_id and f.anulado_em is null);
  -- Empresa que exige o valor real: venda sem valor válido não sai; fica pendente de correção.
  update public.meta_conversoes_eventos e
     set situacao = 'valor_pendente',
         ultimo_erro = 'Fechamento sem valor válido para a Meta (modalidade TCV, MRR ou venda ausente ou não aprovada). Corrija o fechamento para enviar.'
   where e.situacao = 'pendente' and e.enviar_valor
     and exists (select 1 from public.etapas_funil x where x.id = e.etapa_id and x.tipo = 'ganha')
     and exists (select 1 from public.meta_conversoes_valor_empresa v where v.tenant_id = e.tenant_id and v.exige_valor)
     and public.capi_valor_da_venda(e.negociacao_id) is null;
  -- Corrigido dentro do prazo: volta para a fila.
  update public.meta_conversoes_eventos e
     set situacao = 'pendente', ultimo_erro = null, proxima_tentativa_em = now()
   where e.situacao = 'valor_pendente' and public.capi_valor_da_venda(e.negociacao_id) is not null;
  return query
  with lote as (
    select e.id
      from public.meta_conversoes_eventos e
      join public.meta_conversoes_conexoes c on c.id = e.conexao_id
     where e.situacao = 'pendente' and e.proxima_tentativa_em <= now() and e.lead_id is not null
       and (e.bloqueado_ate is null or e.bloqueado_ate < now())
       and c.situacao = 'ativa' and c.vault_secret_id is not null and public.meta_conversoes_elegivel(e.tenant_id)
       and public.integracao_habilitada('meta_conversoes', e.tenant_id)
       -- Empresa travada: nada é reservado, nem com a conexão "ativa".
       and not exists (select 1 from public.meta_conversoes_travas tv where tv.tenant_id = e.tenant_id)
       -- Defesa extra: corte da ativação, oposição e entrada fora da regra nunca entram no lote.
       and e.event_time >= public.capi_corte_da_empresa(e.tenant_id)
       and not public.capi_oposicao_da_negociacao(e.negociacao_id)
       and (not e.evento_entrada
            or not exists (select 1 from public.meta_conversoes_entrada_empresa r where r.tenant_id = e.tenant_id)
            or coalesce(e.event_time - public.capi_lead_criado_em(e.negociacao_id) between interval '-1 hour' and interval '24 hours', false))
     order by e.proxima_tentativa_em
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
     for update of e skip locked
  ), marcados as (
    update public.meta_conversoes_eventos e
       set situacao = 'enviando', tentativas = e.tentativas + 1, bloqueado_ate = now() + interval '5 minutes',
           valor_informado = v.valor,
           modalidade_valor = case when v.valor is not null then
                                (select f.tipo_venda from public.fechamentos f where f.negociacao_id = e.negociacao_id and f.anulado_em is null) end
      from lote
      cross join lateral (select case when e2.enviar_valor then public.capi_valor_da_venda(e2.negociacao_id) end as valor
                            from public.meta_conversoes_eventos e2 where e2.id = lote.id) v
     where e.id = lote.id
    returning e.*
  )
  select m.id, m.tenant_id, m.conexao_id, c.dataset_id, c.codigo_teste, m.evento, m.event_id,
         extract(epoch from m.event_time)::bigint, m.lead_id,
         m.valor_informado,
         case when m.valor_informado is not null then 'BRL' end,
         m.modalidade_valor::text,
         case when c.enviar_contato_hash then cl.email end,
         case when c.enviar_contato_hash then cl.telefone end
    from marcados m
    join public.meta_conversoes_conexoes c on c.id = m.conexao_id
    left join public.negociacoes n on n.id = m.negociacao_id
    left join public.clientes cl on cl.id = n.cliente_id;
end;
$$;
revoke all on function public.capi_reservar(integer) from public, anon, authenticated;
grant execute on function public.capi_reservar(integer) to service_role;
