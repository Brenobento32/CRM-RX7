-- ===========================================================================
-- Atribuição/campanha (preparação para Meta Ads) — um campo estruturado por
-- negociação, genérico o bastante pra qualquer fonte futura (Meta, Google,
-- outra), em vez de uma coluna por plataforma.
--
-- POR QUE JSONB E NÃO TABELA PRÓPRIA: é 1:1 com a negociação (nunca um
-- histórico de múltiplas atribuições por lead nesta fase), o conjunto de
-- campos é fixo e pequeno (os 12 que o pedido lista), e não precisa de
-- índice/busca por campo individual ainda — uma tabela própria só
-- adicionaria um JOIN sem ganho nenhum hoje. Se um dia precisar buscar por
-- campaign_id em massa, um índice GIN em `atribuicao` resolve sem migrar de
-- estrutura.
--
-- POR QUE NÃO INVESTIGUEI HEADERS REAIS DA PLANILHA: o formulário real do
-- Google Sheets não está conectado a este repositório (confirmado nas fases
-- anteriores — nenhuma integração existe no código) e eu não tenho acesso à
-- planilha em si. As chaves abaixo (`source`, `campaign_id`, `campaign_name`,
-- `adset_id`, `adset_name`, `ad_id`, `ad_name`, `utm_source`, `utm_medium`,
-- `utm_campaign`, `utm_content`, `utm_term`) são exatamente as que o pedido
-- original listou — nomenclatura padrão de Meta Ads/UTM, não inventada.
-- Igual às perguntas de qualificação (casadas por texto, não por uma chave
-- fixa), o Apps Script (quando a planilha for conectada, FORA desta fase)
-- será responsável por traduzir os headers reais da planilha pra estas
-- chaves canônicas — o JSONB nunca precisa saber o nome exato da coluna do
-- Google Sheets.
--
-- Ordem do arquivo:
--   1. negociacoes.atribuicao (jsonb, nullable).
--   2. funil_cards ganha funil_nome + atribuicao no fim.
--   3. ingerir_lead_formulario ganha p_atribuicao (10º parâmetro) — COM o
--      DROP da assinatura de 9 parâmetros antes do CREATE OR REPLACE (lição
--      da migration anterior: sem o DROP, parâmetro novo = função
--      sobrecarregada duplicada, não uma substituição).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. negociacoes.atribuicao
-- ---------------------------------------------------------------------------
alter table public.negociacoes
  add column atribuicao jsonb;

alter table public.negociacoes
  add constraint negociacoes_atribuicao_formato
    check (atribuicao is null or jsonb_typeof(atribuicao) = 'object');

comment on column public.negociacoes.atribuicao is
  'Atribuição de campanha (Meta Ads/UTM), estrutura livre mas documentada: '
  'source, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, '
  'utm_source, utm_medium, utm_campaign, utm_content, utm_term — todas '
  'opcionais, preenchidas pelo que a fonte mandar. Null quando não há dado '
  'de campanha (lead manual, a maioria do WhatsApp).';

-- ---------------------------------------------------------------------------
-- 2. funil_cards: funil_nome (join novo) + atribuicao no fim. Nenhuma coluna
-- existente muda de lugar ou de significado.
-- ---------------------------------------------------------------------------
create or replace view public.funil_cards
with (security_invoker = true)
as
select
  n.id,
  n.etapa_id,
  e.nome            as etapa_nome,
  e.cor             as etapa_cor,
  e.tipo            as etapa_tipo,
  n.posicao,
  n.valor_estimado,
  n.temperatura,
  n.data_entrada_etapa,
  n.owner_id,
  p.nome            as responsavel_nome,
  c.id              as cliente_id,
  c.nome            as cliente_nome,
  c.empresa         as cliente_empresa,
  pa.titulo         as proxima_acao_titulo,
  pa.data           as proxima_acao_data,
  ua.tipo           as ultima_atividade_tipo,
  ua.data           as ultima_atividade_data,
  ua.descricao      as ultima_atividade_descricao,
  n.funil_id,
  f.valor_vendido,
  coalesce(
    (select array_agg(ns.servico_id order by ns.servico_id)
       from public.negociacao_servicos ns
      where ns.negociacao_id = n.id),
    '{}'
  ) as servico_ids,
  n.nicho_id,
  nc.nome           as nicho_nome,
  nc.cor            as nicho_cor,
  n.origem,
  n.formulario_id,
  fo.nome           as formulario_nome,
  c.telefone        as cliente_telefone,
  fu.nome           as funil_nome,
  n.atribuicao
from public.negociacoes n
join public.etapas_funil e
  on e.id = n.etapa_id
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
join public.funis fu
  on fu.id = n.funil_id
left join public.profiles p
  on p.id = n.owner_id
left join public.fechamentos f
  on f.negociacao_id = n.id
left join public.nichos nc
  on nc.id = n.nicho_id
left join public.formularios fo
  on fo.id = n.formulario_id
left join lateral (
  select x.titulo, x.data
  from (
    select a.titulo, a.data
    from public.proximas_acoes a
    where a.concluida_em is null
      and (
        a.negociacao_id = n.id
        or (a.negociacao_id is null and a.cliente_id = n.cliente_id)
      )
    union all
    select ev.titulo, (ev.inicio at time zone 'America/Sao_Paulo')::date
    from public.eventos ev
    where ev.status = 'agendado'
      and ev.inicio >= now()
      and (
        ev.negociacao_id = n.id
        or (ev.negociacao_id is null and ev.cliente_id = n.cliente_id)
      )
  ) x
  order by x.data
  limit 1
) pa on true
left join lateral (
  select a.tipo, a.data, a.descricao
  from public.atividades a
  where a.cliente_id = n.cliente_id
  order by a.data desc
  limit 1
) ua on true
where n.arquivada_em is null;

comment on view public.funil_cards is
  'Um card do Kanban por negociação ativa (nunca arquivada/excluída). '
  'nicho/origem/formulário/funil_nome/atribuicao no fim, servico_ids sempre '
  'array. security_invoker: respeita a RLS.';

revoke all on public.funil_cards from anon;
grant select on public.funil_cards to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ingerir_lead_formulario ganha p_atribuicao (10º parâmetro).
--
-- DROP da assinatura de 9 parâmetros ANTES do CREATE OR REPLACE — sem isso,
-- `create or replace function` com uma lista de tipos diferente cria uma
-- SEGUNDA função sobrecarregada em vez de substituir (mesmo bug corrigido
-- em 20261008100000_leads_multinicho.sql para criar_cliente/criar_negociacao).
-- Sem CASCADE: nada depende desta assinatura exata além desta própria
-- definição.
-- ---------------------------------------------------------------------------
drop function if exists public.ingerir_lead_formulario(
  text, text, text, text, text, text, text, text, jsonb
);

create or replace function public.ingerir_lead_formulario(
  p_external_id      text,
  p_formulario_slug  text,
  p_nicho_slug       text,
  p_nome             text,
  p_telefone         text default null,
  p_email            text default null,
  p_empresa          text default null,
  p_instagram        text default null,
  p_respostas        jsonb default '[]'::jsonb,
  p_atribuicao       jsonb default null
)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_formulario_id   uuid;
  v_nicho_id        uuid;
  v_funil_id        uuid;
  v_responsavel_id  uuid;
  v_etapa_id        uuid;
  v_cliente_id      uuid;
  v_negociacao_id   uuid;
  v_criado          boolean := false;
  v_item            jsonb;
  v_pergunta_id     uuid;
  v_resposta        text;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id é obrigatório.' using errcode = '22023';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Nome é obrigatório.' using errcode = '22023';
  end if;
  if p_telefone is null and p_email is null then
    raise exception 'Informe ao menos telefone ou e-mail.' using errcode = '22023';
  end if;
  if p_atribuicao is not null and jsonb_typeof(p_atribuicao) <> 'object' then
    raise exception 'atribuicao precisa ser um objeto JSON.' using errcode = '22023';
  end if;

  select f.id into v_formulario_id from public.formularios f
   where f.slug = p_formulario_slug and f.ativo;
  if v_formulario_id is null then
    raise exception 'Formulário "%" não encontrado ou desativado.', p_formulario_slug
      using errcode = 'P0002';
  end if;

  select n.id into v_nicho_id from public.nichos n
   where n.slug = p_nicho_slug and n.ativo;
  if v_nicho_id is null then
    raise exception 'Nicho "%" não encontrado ou desativado.', p_nicho_slug using errcode = 'P0002';
  end if;

  -- Idempotência primária: `for update` serializa reenvios concorrentes do
  -- mesmo external_id, mesmo padrão (sem advisory lock) de criar_cliente_whatsapp.
  select n.cliente_id, n.id into v_cliente_id, v_negociacao_id
    from public.negociacoes n
   where n.origem = 'formulario' and n.external_id = p_external_id
   for update;

  if v_negociacao_id is not null then
    -- Reenvio/correção da mesma linha: atualiza os dados cadastrais, a
    -- atribuição e as respostas, mas NUNCA cria uma segunda negociação nem
    -- reabre uma que já foi arquivada/excluída manualmente.
    update public.clientes
       set nome      = p_nome,
           empresa   = coalesce(p_empresa, empresa),
           telefone  = coalesce(p_telefone, telefone),
           email     = coalesce(p_email, email),
           instagram = coalesce(p_instagram, instagram)
     where id = v_cliente_id and deleted_at is null;

    update public.negociacoes
       set atribuicao = coalesce(p_atribuicao, atribuicao)
     where id = v_negociacao_id;
  else
    -- Dedup secundária: telefone/e-mail já pertence a um cliente ativo?
    -- Reaproveita o cliente (nunca duplica) — a negociação nova entra na
    -- carteira de quem já é o dono dele, nunca no responsável padrão.
    select c.id into v_cliente_id
      from public.clientes c
     where c.deleted_at is null
       and (
         (p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
         or (p_email is not null and lower(c.email) = lower(p_email))
       )
     order by c.created_at
     limit 1
     for update;

    if v_cliente_id is null then
      -- Responsável/funil padrão de leads automáticos — mesma config já
      -- usada pelo WhatsApp (ver cabeçalho de 20261008100000).
      select c.funil_id, c.responsavel_padrao_id
        into v_funil_id, v_responsavel_id
        from public.whatsapp_conexoes c
       where c.id = '00000000-0000-0000-0000-000000000001';

      if v_funil_id is null or v_responsavel_id is null then
        raise exception 'Configuração de responsável/funil padrão para leads automáticos não encontrada.'
          using errcode = 'P0002';
      end if;

      insert into public.clientes (tipo_cliente, nome, empresa, telefone, email, instagram, owner_id)
      values ('pessoa_fisica', p_nome, p_empresa, p_telefone, p_email, p_instagram, v_responsavel_id)
      returning id into v_cliente_id;
    else
      select n.funil_id into v_funil_id
        from public.negociacoes n
       where n.cliente_id = v_cliente_id
       order by n.created_at
       limit 1;

      if v_funil_id is null then
        select c.funil_id into v_funil_id
          from public.whatsapp_conexoes c
         where c.id = '00000000-0000-0000-0000-000000000001';
      end if;
    end if;

    -- Lead de formulário SEMPRE entra em "Lead Novo" — nunca "a primeira
    -- etapa aberta" genérica. Sem fallback.
    select e.id into v_etapa_id
      from public.etapas_funil e
     where e.funil_id = v_funil_id
       and lower(btrim(e.nome)) = 'lead novo'
       and e.tipo = 'aberta'
       and e.ativo
     limit 1;

    if v_etapa_id is null then
      raise exception 'Etapa "Lead Novo" não encontrada (ou desativada) no funil %.', v_funil_id
        using errcode = 'P0002';
    end if;

    insert into public.negociacoes (
      cliente_id, owner_id, etapa_id, origem, nicho_id, formulario_id, external_id, atribuicao
    )
    values (
      v_cliente_id, (select auth.uid()), v_etapa_id, 'formulario', v_nicho_id, v_formulario_id,
      p_external_id, p_atribuicao
    )
    returning id into v_negociacao_id;

    v_criado := true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb))
  loop
    select p.id into v_pergunta_id
      from public.perguntas p
     where p.formulario_id = v_formulario_id
       and p.ativo
       and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');

    continue when v_pergunta_id is null;

    v_resposta := v_item ->> 'resposta';
    continue when v_resposta is null or btrim(v_resposta) = '';

    insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
    select
      v_negociacao_id,
      v_pergunta_id,
      case when p.tipo = 'texto_livre' then v_resposta end,
      case when p.tipo <> 'texto_livre' then v_resposta end
    from public.perguntas p
    where p.id = v_pergunta_id
    on conflict (negociacao_id, pergunta_id) do update
      set resposta_texto = excluded.resposta_texto,
          resposta_opcao = excluded.resposta_opcao;
  end loop;

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;

comment on function public.ingerir_lead_formulario is
  'Upsert atômico de lead vindo de formulário externo: cliente (dedup '
  'telefone/e-mail), negociação (dedup origem=formulario + external_id, '
  'entra em "Lead Novo", grava atribuição de campanha) e respostas (upsert '
  'por pergunta, casada pelo texto exato). SECURITY DEFINER — só service_role chama.';

revoke all on function public.ingerir_lead_formulario(
  text, text, text, text, text, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ingerir_lead_formulario(
  text, text, text, text, text, text, text, text, jsonb, jsonb
) to service_role;
