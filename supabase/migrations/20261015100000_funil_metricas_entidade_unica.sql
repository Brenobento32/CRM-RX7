-- ===========================================================================
-- Funil de conversão — matemática definitiva (entidade única, coorte,
-- evolução até o momento). Reescreve `public.funil_metricas` do zero,
-- substituindo a frente de progresso monotônica ("alcançou esta etapa OU
-- ALGUMA depois dela") pela regra aprovada: uma negociação só "alcançou"
-- uma etapa se existe uma entrada REAL em `historico_etapas` para ela —
-- pular etapa nunca credita a etapa pulada.
--
-- Decisões (auditoria + 4 rodadas de revisão, registradas em
-- docs/SCORPION-REGRAS-NEGOCIO.md):
--
--   1. COORTE = negociações criadas no período (`negociacoes.created_at`),
--      filtradas por `funil_id`. Fixa para sempre — nunca reclassificada.
--   2. ALCANCE = EXISTS real em `historico_etapas`, SEM filtro de data —
--      "conversão da coorte, evolução até o momento da consulta", nunca
--      truncada pelo fim do período de entrada.
--   3. ENTIDADE ÚNICA: uma negociação conta no máximo 1 vez por etapa,
--      por "perdido", por "ganho" — nunca por número de eventos.
--   4. HISTÓRICO (coorte, alcance, ganhos, perdidos, tempo por etapa)
--      NUNCA exclui negociação arquivada/excluída nem cliente com
--      `deleted_at` — nenhum soft delete apaga participação estatística
--      passada (clientes.deleted_at é estruturalmente o mesmo soft delete
--      reversível que negociacoes.arquivada_em/excluida_em — confirmado em
--      20260930170000_clientes_exclusao.sql: "nunca DELETE físico, a RLS
--      não filtra, quem filtra é a DAL" — mesma categoria, mesmo
--      tratamento).
--   5. ATUAL ("quantidade"/"valor"/"parados" de etapas ABERTAS, estado
--      presente) é a ÚNICA parte que exclui arquivada/excluída/cliente-
--      excluído — porque isso de fato não é mais uma oportunidade aberta.
--   6. GANHOS no período = venda histórica real, por
--      `fechamentos.data_fechamento`, sobre a base histórica completa —
--      arquivar/excluir a negociação DEPOIS de vendida nunca apaga a
--      venda do histórico financeiro (ajuste pedido explicitamente: a
--      versão anterior usava a base "atual", que apagaria a venda).
--   7. PERDIDOS no período = entrada real em etapa tipo='perdida' (evento,
--      não coorte), DEDUPLICADA por negociação ANTES de agregar valor —
--      nunca `count(distinct ...)` ao lado de `sum()` sobre todas as
--      linhas (dobra o valor se a negociação entrou em perdida mais de
--      uma vez no período). O valor somado é `valor_estimado`, campo
--      ATUAL sem histórico de alterações — aproximado, nunca o valor real
--      no momento da perda. Não é um indicador financeiro confiável por si
--      só; a UI deve rotulá-lo como estimado/aproximado.
--   8. RECUPERAÇÃO (`pos_fechamento`) é zona separada: a coluna sai na
--      resposta para a camada TS poder excluí-la da sequência do pipeline
--      normal (nunca é "próxima etapa" de ninguém).
--   9. `total_entraram` = tamanho da coorte, repetido em toda linha —
--      mesma "uma chamada, uma agregação" de sempre, sem RPC extra.
-- ===========================================================================

drop function if exists public.funil_metricas(date, date, uuid);

create function public.funil_metricas(
  p_inicio    date,
  p_fim       date,
  p_funil_id  uuid
)
returns table (
  etapa_id                uuid,
  nome                    text,
  cor                     public.cor_etapa,
  tipo                    public.tipo_etapa,
  ordem                   numeric,
  pos_fechamento          boolean,
  quantidade              bigint,
  valor                   numeric,
  alcancaram              bigint,
  tempo_medio_segundos    numeric,
  permanencias            bigint,
  parados_medio_segundos  numeric,
  parados_7_dias          bigint,
  total_entraram          bigint
)
language sql
stable
set search_path = ''
as $$
  with
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  ),

  -- BASE HISTÓRICA: toda negociação do funil, sem nenhuma exclusão por
  -- estado de limpeza de cadastro. Usada por tudo que é histórico: coorte,
  -- alcance, ganhos, perdidos, tempo por etapa.
  historico_base as (
    select n.*
    from public.negociacoes n
    where n.funil_id = p_funil_id
  ),

  -- BASE ATUAL: só oportunidades vivas agora. Única CTE que exclui cliente
  -- excluído e negociação arquivada/excluída.
  atuais_base as (
    select n.*
    from historico_base n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.arquivada_em is null
      and n.excluida_em is null
  ),

  -- Só etapas abertas: ganha e perdida têm CTEs históricas próprias
  -- abaixo, que nunca somem por arquivamento/exclusão posterior.
  atuais as (
    select
      n.etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor,
      avg(extract(epoch from now() - n.data_entrada_etapa)) as parados,
      count(*) filter (where n.data_entrada_etapa < now() - interval '7 days') as parados_7
    from atuais_base n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta'
    group by n.etapa_id
  ),

  -- Coorte: toda negociação (histórica, sem exclusões) criada no período.
  -- Fixa para sempre — nunca reclassificada por avanço posterior.
  coorte as (
    select n.id
    from historico_base n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),

  total_entraram as (
    select count(*) as total from coorte
  ),

  -- Alcance = evolução da coorte ATÉ AGORA. EXISTS real em
  -- historico_etapas, sem filtro de data e sem inferência por ordem —
  -- pular etapa nunca credita a etapa pulada.
  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),

  -- Ganhos no período: venda histórica real (fechamentos.data_fechamento),
  -- sobre a base histórica completa — nunca apaga uma venda já realizada
  -- por causa de um arquivamento/exclusão posterior da negociação.
  -- fechamentos é 1:1 com negociacao_id: sem necessidade de deduplicar.
  ganhos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'ganha') as etapa_id,
      count(*) as qtd,
      sum(f.valor_vendido) as valor
    from public.fechamentos f
    join historico_base n on n.id = f.negociacao_id
    where f.data_fechamento between p_inicio and p_fim
  ),

  -- Perdidos no período: entrada real em etapa perdida (evento), sobre a
  -- base histórica completa. Deduplicado por negociação ANTES de agregar
  -- valor — count() e sum() sempre leem o mesmo conjunto, mesmo que a
  -- negociação tenha entrado em perdida mais de uma vez no período.
  --
  -- `valor` aqui é negociacoes.valor_estimado — campo ATUAL, sem
  -- histórico de alterações (o schema não guarda snapshot por data).
  -- É uma aproximação, nunca o valor real no momento da perda: a UI
  -- NUNCA deve apresentá-lo como indicador financeiro confiável sem
  -- rotulá-lo como estimado/aproximado.
  negociacoes_perdidas_periodo as (
    select distinct h.negociacao_id
    from public.historico_etapas h
    join public.etapas_funil e on e.id = h.etapa_nova_id
    cross join periodo
    where e.funil_id = p_funil_id
      and e.tipo = 'perdida'
      and h.created_at >= periodo.inicio
      and h.created_at <  periodo.fim
  ),
  perdidos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'perdida') as etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor
    from negociacoes_perdidas_periodo p
    join historico_base n on n.id = p.negociacao_id
  ),

  -- Tempo por etapa: permanência real sobre a base histórica completa.
  estadias as (
    select
      h.etapa_nova_id as etapa_id,
      h.created_at as entrada,
      lead(h.created_at) over (
        partition by h.negociacao_id order by h.created_at, h.id
      ) as saida
    from public.historico_etapas h
    join historico_base n on n.id = h.negociacao_id
  ),
  tempos as (
    select
      s.etapa_id,
      avg(extract(epoch from s.saida - s.entrada)) as media,
      count(*) as n
    from estadias s, periodo
    where s.saida is not null
      and s.saida >= periodo.inicio
      and s.saida <  periodo.fim
    group by s.etapa_id
  )

  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    e.pos_fechamento,
    case e.tipo
      when 'perdida' then coalesce(pp.qtd, 0)
      when 'ganha'   then coalesce(gp.qtd, 0)
      else                coalesce(a.qtd, 0)
    end,
    case e.tipo
      when 'perdida' then coalesce(pp.valor, 0)
      when 'ganha'   then coalesce(gp.valor, 0)
      else                coalesce(a.valor, 0)
    end,
    coalesce(al.qtd, 0),
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0),
    (select total from total_entraram)
  from public.etapas_funil e
  left join atuais           a  on a.etapa_id = e.id
  left join alcancaram       al on al.etapa_id = e.id
  left join ganhos_periodo   gp on gp.etapa_id = e.id
  left join perdidos_periodo pp on pp.etapa_id = e.id
  left join tempos           t  on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa de UM funil, entidade única. Coorte = criadas '
  'no período (toda negociação, sem exclusão de arquivada/excluída/'
  'cliente-excluído). Alcançaram = EXISTS real em historico_etapas, '
  'evolução até o momento da consulta (nunca truncado pelo período, nunca '
  'inferido por etapa pulada). Ganhos = venda real por '
  'fechamentos.data_fechamento, sobre o histórico completo. Perdidos = '
  'entrada real em etapa perdida no período, deduplicada por negociação '
  'antes de somar valor_estimado (aproximado, sem histórico de valor). '
  'Atual (quantidade/valor/parados de etapas abertas) é a ÚNICA parte que '
  'exclui arquivada/excluída/cliente-excluído. SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;
