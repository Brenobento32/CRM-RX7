set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Meta Conversions API (CRM): venda fechada — regra do valor por modalidade
-- e venda anulada nunca informada.
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- O que JÁ existia e continua igual (20261031100000 + trava 20261112090000):
--   - o evento nasce quando a negociação entra na etapa "ganha" mapeada de um
--     funil monitorado (historico_etapas), só com a conexão ativa e a empresa
--     sem trava; eventos de antes nunca são gerados (nada retroativo);
--   - event_id = negociação + etapa: a mesma venda nunca gera dois eventos;
--   - event_time = momento da mudança para a etapa de fechamento;
--   - user_data.lead_id = ID do lead da Meta gravado na entrada; sem ele, o
--     evento fica "sem correspondência" e nunca sai;
--   - cada empresa usa só o próprio dataset; e-mail/telefone só com a opção
--     de hash ligada pelo Administrador.
--
-- O que muda:
--  1. Valor da venda só com a REGRA COMERCIAL APROVADA pela plataforma, por
--     modalidade: plataforma_integracoes.meta_conversoes_valor_modalidades
--     (vazio = nenhuma; muda só por service_role/postgres, auditado pelo
--     gatilho já existente). Valor informado à Meta, quando aprovado:
--       tcv   -> valor total do contrato (valor_vendido);
--       mrr   -> UMA mensalidade (valor_vendido), nunca multiplicada: o AVANTE
--                não guarda a duração do contrato;
--       venda -> valor da venda única (valor_vendido);
--       sem modalidade (histórico "não classificado") -> nunca.
--     Ainda exige o "Enviar o valor da venda" da etapa (por empresa e funil).
--     Moeda: BRL, só quando há valor.
--  2. Evento da etapa de fechamento sem fechamento válido (venda anulada antes
--     do envio, ou sem registro de fechamento) é encerrado como rejeitado e
--     nunca vai para a Meta.
--  3. capi_valor_modalidades(): o Administrador vê quais modalidades estão
--     aprovadas (a tela explica por que o valor não sai).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Regra comercial do valor (desligada)
-- ---------------------------------------------------------------------------
alter table public.plataforma_integracoes
  add column meta_conversoes_valor_modalidades public.tipo_venda[] not null default '{}';

comment on column public.plataforma_integracoes.meta_conversoes_valor_modalidades is
  'Modalidades de venda (tcv, mrr, venda) cujo valor pode ir para a Meta na etapa de fechamento. Vazio = nenhuma (padrão). TCV = contrato total; MRR = uma mensalidade; venda = venda única.';

-- Valor da venda para a Meta: só de fechamento válido, de modalidade aprovada.
create function public.capi_valor_da_venda(p_negociacao uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select f.valor_vendido
    from public.fechamentos f
   where f.negociacao_id = p_negociacao
     and f.anulado_em is null
     and f.tipo_venda is not null
     and f.tipo_venda = any (coalesce((select p.meta_conversoes_valor_modalidades from public.plataforma_integracoes p), '{}'))
$$;

-- Para a tela do Administrador: modalidades com valor aprovado (sem segredo nenhum).
create function public.capi_valor_modalidades()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_administrador_integracoes();
  return coalesce((select array(select unnest(p.meta_conversoes_valor_modalidades)::text order by 1) from public.plataforma_integracoes p), '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. capi_reservar: corpo de 20261112090000 (com a trava) + venda válida + valor aprovado
-- ---------------------------------------------------------------------------
create or replace function public.capi_reservar(p_limite integer default 50)
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
  -- Etapa de fechamento sem venda válida (anulada antes do envio ou sem registro): nunca vai para a Meta.
  update public.meta_conversoes_eventos e
     set situacao = 'rejeitado', ultimo_erro = 'Venda anulada ou sem fechamento válido: não é informada à Meta.'
   where e.situacao = 'pendente'
     and exists (select 1 from public.etapas_funil x where x.id = e.etapa_id and x.tipo = 'ganha')
     and not exists (select 1 from public.fechamentos f where f.negociacao_id = e.negociacao_id and f.anulado_em is null);
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
         v.valor,
         case when v.valor is not null then 'BRL' end,
         case when c.enviar_contato_hash then cl.email end,
         case when c.enviar_contato_hash then cl.telefone end
    from marcados m
    join public.meta_conversoes_conexoes c on c.id = m.conexao_id
    left join public.negociacoes n on n.id = m.negociacao_id
    left join public.clientes cl on cl.id = n.cliente_id
    cross join lateral (select case when m.enviar_valor then public.capi_valor_da_venda(m.negociacao_id) end as valor) v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.capi_valor_da_venda(uuid) from public, anon, authenticated;
grant execute on function public.capi_valor_da_venda(uuid) to service_role;
revoke all on function public.capi_valor_modalidades() from public, anon;
grant execute on function public.capi_valor_modalidades() to authenticated;
revoke all on function public.capi_reservar(integer) from public, anon, authenticated;
grant execute on function public.capi_reservar(integer) to service_role;
