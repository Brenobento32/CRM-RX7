-- ===========================================================================
-- `funil_cards` nunca teve acesso a `fechamentos.valor_vendido` — o card do
-- Kanban só enxergava `negociacoes.valor_estimado`. Um negócio fechado
-- rapidamente pode nunca ter tido um valor estimado preenchido na
-- qualificação, e o card mostrava "Sem valor estimado" mesmo com a venda já
-- registrada.
--
-- Só acrescenta `valor_vendido` e `servico_ids` no fim da view (nenhuma
-- coluna existente muda de lugar ou de significado, `create or replace
-- view` aceita isso sem precisar recriar a view):
--   * `valor_vendido` — LEFT JOIN com fechamentos, 1:1 por negociacao_id.
--     Quem decide qual valor mostrar (estimado/vendido) é a aplicação
--     (`lib/dal/funil.ts` + `card-negociacao.tsx`), não esta migration.
--   * `servico_ids` — os serviços já vinculados à negociação (via
--     `negociacao_servicos`), pra o modal de fechamento pré-marcar o que já
--     estava selecionado em vez de abrir em branco. `coalesce(..., '{}')`
--     garante array vazio (nunca `null`) quando não há nenhum vínculo —
--     simplifica o lado da aplicação, que nunca precisa tratar `null`.
-- ===========================================================================
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
  ) as servico_ids
from public.negociacoes n
join public.etapas_funil e
  on e.id = n.etapa_id
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
left join public.fechamentos f
  on f.negociacao_id = n.id
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
) ua on true;

comment on view public.funil_cards is
  'Um card do Kanban por negociação, com o funil a que pertence. '
  'valor_vendido vem de fechamentos (nulo fora da etapa ganha). '
  'servico_ids vem de negociacao_servicos, sempre um array (nunca null). '
  'security_invoker: respeita a RLS.';
