-- ===========================================================================
-- Métricas e dashboard não devem tratar a zona de recuperação (migration
-- 20260930100000) como parte do funil comercial normal.
--
-- Três problemas concretos que esta migration corrige:
--
--   1. `funil_metricas()` usava `max(ordem) filter (where tipo='aberta')`
--      como régua de progresso da coorte (CTE `alcance`). Uma negociação que
--      passasse pela zona de recuperação (ordem bem maior que qualquer etapa
--      normal) inflava essa régua — e isso contaminava o "alcançou" de
--      QUALQUER etapa normal anterior, mesmo uma que ela nunca visitou de
--      verdade (ex.: "Reunião agendada" -> "Perdido" direto -> "Recuperação"
--      passaria a contar, errado, como tendo alcançado "Negociação").
--
--   2. `dashboard_por_usuario()` e `dashboard_etapas()` contavam "perdido no
--      período" pela etapa ATUAL da negociação. Assim que ela vai para a
--      recuperação, `etapa_id` deixa de apontar para uma etapa perdida, e ela
--      some das métricas de perda do período em que foi perdida de verdade —
--      apagando um fato histórico dos relatórios (o dado em si, em
--      historico_etapas, continua intacto; só a leitura agregada estava
--      errada).
--
--   3. `dashboard_por_usuario()` também contava qualquer `tipo='aberta'` como
--      pipeline ativo — a zona de recuperação inflava "abertas"/"pipeline
--      valor" como se fosse negócio novo em andamento.
--
-- Correções:
--   - `funil_metricas`: `alcance.max_ordem` exclui `pos_fechamento`; a etapa
--     de recuperação ganha sua própria contagem de "alcançaram" via
--     historico_etapas, fora da régua monotônica do funil normal.
--   - `dashboard_por_usuario`: "perdidos" via historico_etapas (quando ENTROU
--     em perdida, não onde está agora); "abertas"/"pipeline_valor" excluem
--     `pos_fechamento`; duas colunas novas, `em_recuperacao_qtd` e
--     `em_recuperacao_valor`, dão à recuperação uma visão própria em vez de
--     simplesmente desaparecer dos números por pessoa.
--   - `dashboard_etapas`: a linha de "Perdido" passa a contar via
--     historico_etapas, mesma lógica. A linha de "Recuperação" continua
--     aparecendo normalmente (quantidade/valor atuais), como qualquer outra
--     etapa — é a "distribuição por etapa" que já dá a ela uma linha própria.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. `funil_metricas` — só as CTEs `alcance` e o `case` final do `select`
-- mudam. Resto (periodo, validas, atuais, coorte, estadias, tempos, from,
-- where, order) idêntico à versão de 20260929120000_funis.sql.
-- ---------------------------------------------------------------------------
create or replace function public.funil_metricas(
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
  validas as (
    select n.*
    from public.negociacoes n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.funil_id = p_funil_id
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
  -- Régua de progresso: só a zona normal (`not pos_fechamento`) conta pro
  -- "quão longe no funil comercial" — a zona de recuperação não é "mais
  -- fundo no funil", é outro fluxo.
  alcance as (
    select
      co.id,
      max(e.ordem) filter (where e.tipo = 'aberta' and not e.pos_fechamento) as max_ordem,
      bool_or(e.tipo = 'ganha')   as ganhou,
      bool_or(e.tipo = 'perdida') as perdeu
    from coorte co
    join (
      select h.negociacao_id, h.etapa_nova_id as etapa_id from public.historico_etapas h
      union all
      select co2.id, co2.etapa_id from coorte co2
    ) passagem on passagem.negociacao_id = co.id
    join public.etapas_funil e on e.id = passagem.etapa_id
    where e.funil_id = p_funil_id
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
    case
      when e.tipo = 'aberta' and not e.pos_fechamento
        then (select count(*) from alcance al where al.ganhou or al.max_ordem >= e.ordem)
      when e.tipo = 'aberta' and e.pos_fechamento
        then (
          select count(distinct h.negociacao_id)
            from public.historico_etapas h
            join coorte co2 on co2.id = h.negociacao_id
           where h.etapa_nova_id = e.id
        )
      when e.tipo = 'ganha' then (select count(*) from alcance al where al.ganhou)
      else                       (select count(*) from alcance al where al.perdeu)
    end,
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0)
  from public.etapas_funil e
  left join atuais a on a.etapa_id = e.id
  left join tempos t on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa de UM funil (quantidade, valor, alcance da coorte, tempo na etapa). '
  'Etapas de recuperação (pos_fechamento) ficam fora da régua de progresso da zona normal. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 2. `dashboard_por_usuario` — ganha `em_recuperacao_qtd`/`em_recuperacao_valor`.
-- Muda a lista de colunas de retorno: precisa DROP + CREATE (create or
-- replace não permite mudar `returns table`).
-- ---------------------------------------------------------------------------
drop function if exists public.dashboard_por_usuario(date, date);

create function public.dashboard_por_usuario(
  p_inicio  date,
  p_fim     date
)
returns table (
  usuario_id            uuid,
  nome                  text,
  role                  public.user_role,
  pipeline_valor        numeric,
  abertas               bigint,
  vendido_valor         numeric,
  ganhos                bigint,
  perdidos              bigint,
  em_recuperacao_qtd    bigint,
  em_recuperacao_valor  numeric,
  reunioes_proximas     bigint,
  reunioes_realizadas   bigint,
  atividades            bigint
)
language sql
stable
set search_path = ''
as $$
  with
  principal as (
    select id from public.funis where padrao
  ),
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  ),
  -- Zona normal só: a de recuperação não é pipeline comercial ativo.
  abertas as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta' and not e.pos_fechamento
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    cross join principal
    where n.funil_id = principal.id
    group by n.owner_id
  ),
  -- Visão separada da zona de recuperação — não some dos números por pessoa.
  em_recuperacao as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta' and e.pos_fechamento
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    cross join principal
    where n.funil_id = principal.id
    group by n.owner_id
  ),
  ganhos as (
    select n.owner_id, sum(f.valor_vendido) as valor, count(*) as qtd
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join principal
    where n.funil_id = principal.id
      and f.data_fechamento between p_inicio and p_fim
    group by n.owner_id
  ),
  -- "Perdido no período" = ENTROU em perdida no período (historico_etapas),
  -- não "está em perdida agora" — sobrevive a Perdido -> Recuperação.
  perdidos as (
    select n.owner_id, count(distinct n.id) as qtd
    from public.negociacoes n
    join public.historico_etapas h on h.negociacao_id = n.id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.tipo = 'perdida'
    cross join principal
    cross join periodo
    where n.funil_id = principal.id
      and h.created_at >= periodo.inicio
      and h.created_at <  periodo.fim
    group by n.owner_id
  ),
  reunioes as (
    select
      e.usuario_id,
      count(*) filter (
        where e.status = 'agendado'
          and e.inicio >= now()
          and e.inicio < now() + interval '7 days'
      ) as proximas,
      count(*) filter (
        where e.status = 'realizado'
          and e.inicio >= periodo.inicio
          and e.inicio <  periodo.fim
      ) as realizadas
    from public.eventos e, periodo
    where e.tipo in ('reuniao', 'apresentacao')
    group by e.usuario_id
  ),
  atividades as (
    select a.usuario_id, count(*) as qtd
    from public.atividades a, periodo
    where a.data >= periodo.inicio
      and a.data <  periodo.fim
    group by a.usuario_id
  )
  select
    p.id,
    p.nome,
    p.role,
    coalesce(ab.valor, 0),
    coalesce(ab.qtd, 0),
    coalesce(g.valor, 0),
    coalesce(g.qtd, 0),
    coalesce(pe.qtd, 0),
    coalesce(er.qtd, 0),
    coalesce(er.valor, 0),
    coalesce(r.proximas, 0),
    coalesce(r.realizadas, 0),
    coalesce(at.qtd, 0)
  from public.profiles p
  left join abertas       ab on ab.owner_id  = p.id
  left join ganhos        g  on g.owner_id   = p.id
  left join perdidos      pe on pe.owner_id  = p.id
  left join em_recuperacao er on er.owner_id = p.id
  left join reunioes      r  on r.usuario_id = p.id
  left join atividades    at on at.usuario_id = p.id
  where (p.ativo and p.role = 'closer')
     or p.id = (select auth.uid())
     or ab.qtd > 0 or g.qtd > 0 or pe.qtd > 0 or er.qtd > 0
  order by coalesce(g.valor, 0) desc, p.nome;
$$;

revoke all on function public.dashboard_por_usuario from public, anon;
grant execute on function public.dashboard_por_usuario to authenticated;

-- ---------------------------------------------------------------------------
-- 3. `dashboard_etapas` — linha de "Perdido" via historico_etapas, mesma
-- lógica. As demais linhas (aberta, inclusive recuperação, e ganha) ficam
-- como estavam — a linha de recuperação já é sua própria linha, com
-- quantidade/valor atuais, exatamente como qualquer outra aberta.
-- Assinatura/retorno inalterados: create or replace basta.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_etapas(
  p_inicio  date,
  p_fim     date
)
returns table (
  etapa_id    uuid,
  nome        text,
  cor         public.cor_etapa,
  tipo        public.tipo_etapa,
  ordem       numeric,
  quantidade  bigint,
  valor       numeric
)
language sql
stable
set search_path = ''
as $$
  with
  principal as (
    select id from public.funis where padrao
  ),
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  )
  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    case
      when e.tipo = 'perdida' then (
        select count(distinct h.negociacao_id)
          from public.historico_etapas h
          join public.negociacoes n2 on n2.id = h.negociacao_id
          join public.clientes c2 on c2.id = n2.cliente_id and c2.deleted_at is null
         where h.etapa_nova_id = e.id
           and h.created_at >= periodo.inicio
           and h.created_at <  periodo.fim
      )
      else count(n.id)
    end,
    case
      when e.tipo = 'perdida' then (
        select coalesce(sum(n2.valor_estimado), 0)
          from public.historico_etapas h
          join public.negociacoes n2 on n2.id = h.negociacao_id
          join public.clientes c2 on c2.id = n2.cliente_id and c2.deleted_at is null
         where h.etapa_nova_id = e.id
           and h.created_at >= periodo.inicio
           and h.created_at <  periodo.fim
      )
      else coalesce(sum(coalesce(f.valor_vendido, n.valor_estimado)), 0)
    end
  from public.etapas_funil e
  cross join periodo
  left join public.negociacoes n
    on n.etapa_id = e.id
   and exists (
     select 1 from public.clientes c
     where c.id = n.cliente_id and c.deleted_at is null
   )
   and (
     e.tipo = 'aberta'
     or (e.tipo = 'ganha'
         and exists (
           select 1 from public.fechamentos ff
           where ff.negociacao_id = n.id
             and ff.data_fechamento between p_inicio and p_fim
         ))
   )
  left join public.fechamentos f
    on f.negociacao_id = n.id and e.tipo = 'ganha'
  where e.ativo
    and e.funil_id = (select id from principal)
  group by e.id, e.nome, e.cor, e.tipo, e.ordem, periodo.inicio, periodo.fim
  order by e.ordem;
$$;

comment on function public.dashboard_por_usuario is
  'Números do dashboard por pessoa no período, restrito ao Funil Principal. '
  'em_recuperacao_* é uma visão separada, fora de abertas/pipeline_valor. SECURITY INVOKER.';
comment on function public.dashboard_etapas is
  'Quantidade e valor por etapa ativa do Funil Principal. Abertas: atual (recuperação inclusa, própria linha); '
  'ganha: fechamentos no período; perdida: entradas em perdida no período (historico_etapas).';
