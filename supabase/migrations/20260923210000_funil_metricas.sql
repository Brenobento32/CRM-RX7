-- ===========================================================================
-- Fase 9A — Métricas do funil, por etapa.
--
-- Uma linha por etapa ativa, na ordem das colunas. SECURITY INVOKER: a RLS
-- de negociacoes, fechamentos e historico_etapas vale para quem chama — o
-- closer recebe só os próprios números, o gerente os da equipe.
--
-- Colunas:
--   quantidade / valor
--       Etapas abertas: situação atual. Ganha/perdida: encerradas no período
--       (mesma regra de dashboard_etapas, para os números baterem).
--   alcancaram
--       Das negociações CRIADAS no período (coorte), quantas passaram por esta
--       etapa ou por alguma depois dela. Uma negociação que nasceu direto em
--       "Proposta enviada" conta como tendo passado pelas etapas anteriores.
--       A conversão para a próxima etapa é alcancaram(próxima) / alcancaram(esta),
--       calculada na aplicação (lib/dal/funil-metricas.ts).
--   tempo_medio_segundos / permanencias
--       Média das permanências CONCLUÍDAS na etapa (entrada → saída, pelo
--       histórico) cuja saída caiu no período.
--   parados_medio_segundos
--       Etapas abertas: há quanto tempo, em média, os cards atuais estão nela.
--   parados_7_dias
--       Etapas abertas: cards atuais que entraram nela há mais de 7 dias.
-- ===========================================================================

create or replace function public.funil_metricas(
  p_inicio  date,
  p_fim     date
)
returns table (
  etapa_id                uuid,
  nome                    text,
  cor                     public.cor_etapa,
  tipo                    public.tipo_etapa,
  ordem                   numeric,
  quantidade              bigint,
  valor                   numeric,
  alcancaram              bigint,
  tempo_medio_segundos    numeric,
  permanencias            bigint,
  parados_medio_segundos  numeric,
  parados_7_dias          bigint
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
  -- Negociações de clientes não excluídos (as únicas que o CRM mostra).
  validas as (
    select n.*
    from public.negociacoes n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
  ),
  atuais as (
    select
      n.etapa_id,
      count(*) as qtd,
      sum(coalesce(f.valor_vendido, n.valor_estimado)) as valor,
      avg(extract(epoch from now() - n.data_entrada_etapa))
        filter (where e.tipo = 'aberta') as parados,
      count(*) filter (
        where e.tipo = 'aberta'
          and n.data_entrada_etapa < now() - interval '7 days'
      ) as parados_7
    from validas n
    join public.etapas_funil e on e.id = n.etapa_id
    left join public.fechamentos f on f.negociacao_id = n.id and e.tipo = 'ganha'
    cross join periodo
    where e.tipo = 'aberta'
       or (e.tipo = 'perdida'
           and n.data_entrada_etapa >= periodo.inicio
           and n.data_entrada_etapa <  periodo.fim)
       or (e.tipo = 'ganha' and f.data_fechamento between p_inicio and p_fim)
    group by n.etapa_id
  ),
  coorte as (
    select n.id, n.etapa_id
    from validas n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),
  -- Até onde cada negociação da coorte chegou: a maior etapa aberta por que
  -- passou, e se chegou a ganhar ou perder.
  alcance as (
    select
      co.id,
      max(e.ordem) filter (where e.tipo = 'aberta') as max_ordem,
      bool_or(e.tipo = 'ganha')   as ganhou,
      bool_or(e.tipo = 'perdida') as perdeu
    from coorte co
    join (
      select h.negociacao_id, h.etapa_nova_id as etapa_id from public.historico_etapas h
      union all
      select co2.id, co2.etapa_id from coorte co2
    ) passagem on passagem.negociacao_id = co.id
    join public.etapas_funil e on e.id = passagem.etapa_id
    group by co.id
  ),
  estadias as (
    select
      h.etapa_nova_id as etapa_id,
      h.created_at as entrada,
      lead(h.created_at) over (
        partition by h.negociacao_id
        order by h.created_at, h.id
      ) as saida
    from public.historico_etapas h
    join validas n on n.id = h.negociacao_id
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
    coalesce(a.qtd, 0),
    coalesce(a.valor, 0),
    case e.tipo
      when 'aberta'  then (select count(*) from alcance al where al.ganhou or al.max_ordem >= e.ordem)
      when 'ganha'   then (select count(*) from alcance al where al.ganhou)
      else                (select count(*) from alcance al where al.perdeu)
    end,
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0)
  from public.etapas_funil e
  left join atuais a on a.etapa_id = e.id
  left join tempos t on t.etapa_id = e.id
  where e.ativo
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa (quantidade, valor, alcance da coorte, tempo na etapa). SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;
