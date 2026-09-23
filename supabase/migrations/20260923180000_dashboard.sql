-- ===========================================================================
-- Fase 6 — Dashboard.
--
-- 1. `historico_etapas`: log append-only de cada mudança de etapa. Alimenta
--    "últimas movimentações" agora e os relatórios de conversão e ciclo de
--    venda na Fase 7.
-- 2. Funções de agregação do dashboard. Todas SECURITY INVOKER: a RLS de cada
--    tabela vale para quem chama, então o closer recebe só os próprios números
--    e o gerente os da equipe — sem nenhum filtro por dono na aplicação.
--
-- Período: datas (AAAA-MM-DD) no calendário de São Paulo, inclusivas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Histórico de etapas.
-- ---------------------------------------------------------------------------
create table public.historico_etapas (
  id              bigint generated always as identity primary key,
  negociacao_id   uuid not null references public.negociacoes (id) on delete cascade,
  etapa_anterior  public.etapa_funil,
  etapa_nova      public.etapa_funil not null,
  usuario_id      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.historico_etapas is
  'Append-only. Uma linha por mudança de etapa (e uma na criação, com '
  'etapa_anterior nula). Escrito só pelo trigger — não há policy de escrita.';
comment on column public.historico_etapas.usuario_id is
  'Quem moveu. Nulo quando a mudança não veio de um usuário (migração, job).';

create index historico_etapas_negociacao_idx
  on public.historico_etapas (negociacao_id, created_at desc);
create index historico_etapas_created_at_idx
  on public.historico_etapas (created_at desc);

-- SECURITY DEFINER porque a tabela não tem policy de INSERT: ninguém escreve
-- nela diretamente, só este trigger.
create or replace function public.negociacoes_registra_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    insert into public.historico_etapas (negociacao_id, etapa_anterior, etapa_nova, usuario_id)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.etapa end,
      new.etapa,
      (select auth.uid())
    );
  end if;

  return null;
end;
$$;

create trigger negociacoes_registra_etapa
  after insert or update of etapa on public.negociacoes
  for each row
  execute function public.negociacoes_registra_etapa();

-- Negociações existentes: registra a etapa atual como ponto de partida.
insert into public.historico_etapas (negociacao_id, etapa_anterior, etapa_nova, created_at)
select n.id, null, n.etapa, n.data_entrada_etapa
from public.negociacoes n;

alter table public.historico_etapas enable row level security;

create policy historico_etapas_select on public.historico_etapas
  for select
  to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

revoke all on table public.historico_etapas from anon;
grant select on table public.historico_etapas to authenticated;

-- ---------------------------------------------------------------------------
-- 2a. Números por pessoa.
--
-- Uma linha por usuário visível: para o closer, só ele (RLS de profiles);
-- para o gerente, cada closer ativo e qualquer outra pessoa com carteira.
-- Os KPIs do topo são a soma destas linhas — a mesma fonte da tabela de
-- performance, então os dois nunca discordam.
--
-- Atribuição: negociações e fechamentos contam para o dono da carteira;
-- reuniões e atividades para quem as fez.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_por_usuario(
  p_inicio  date,
  p_fim     date
)
returns table (
  usuario_id           uuid,
  nome                 text,
  role                 public.user_role,
  pipeline_valor       numeric,
  abertas              bigint,
  vendido_valor        numeric,
  ganhos               bigint,
  perdidos             bigint,
  reunioes_proximas    bigint,
  reunioes_realizadas  bigint,
  atividades           bigint
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
  abertas as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.etapa not in ('fechado', 'perdido')
    group by n.owner_id
  ),
  ganhos as (
    select n.owner_id, sum(f.valor_vendido) as valor, count(*) as qtd
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    where n.etapa = 'fechado'
      and f.data_fechamento between p_inicio and p_fim
    group by n.owner_id
  ),
  perdidos as (
    select n.owner_id, count(*) as qtd
    from public.negociacoes n, periodo
    where n.etapa = 'perdido'
      and n.data_entrada_etapa >= periodo.inicio
      and n.data_entrada_etapa <  periodo.fim
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
    coalesce(r.proximas, 0),
    coalesce(r.realizadas, 0),
    coalesce(at.qtd, 0)
  from public.profiles p
  left join abertas    ab on ab.owner_id  = p.id
  left join ganhos     g  on g.owner_id   = p.id
  left join perdidos   pe on pe.owner_id  = p.id
  left join reunioes   r  on r.usuario_id = p.id
  left join atividades at on at.usuario_id = p.id
  where (p.ativo and p.role = 'closer')
     or p.id = (select auth.uid())
     or ab.qtd > 0 or g.qtd > 0 or pe.qtd > 0
  order by coalesce(g.valor, 0) desc, p.nome;
$$;

comment on function public.dashboard_por_usuario is
  'Números do dashboard por pessoa no período. SECURITY INVOKER: respeita a RLS.';

-- ---------------------------------------------------------------------------
-- 2b. Negociações por etapa.
--
-- Etapas abertas: situação atual. Fechado e perdido: só as encerradas no
-- período — senão essas duas barras cresceriam para sempre.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_etapas(
  p_inicio  date,
  p_fim     date
)
returns table (
  etapa       public.etapa_funil,
  quantidade  bigint,
  valor       numeric
)
language sql
stable
set search_path = ''
as $$
  with periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  )
  select
    e.etapa,
    count(n.id),
    coalesce(sum(coalesce(f.valor_vendido, n.valor_estimado)), 0)
  from unnest(enum_range(null::public.etapa_funil)) as e (etapa)
  cross join periodo
  left join public.negociacoes n
    on n.etapa = e.etapa
   and exists (
     select 1 from public.clientes c
     where c.id = n.cliente_id and c.deleted_at is null
   )
   and (
     e.etapa not in ('fechado', 'perdido')
     or (e.etapa = 'perdido'
         and n.data_entrada_etapa >= periodo.inicio
         and n.data_entrada_etapa <  periodo.fim)
     or (e.etapa = 'fechado'
         and exists (
           select 1 from public.fechamentos ff
           where ff.negociacao_id = n.id
             and ff.data_fechamento between p_inicio and p_fim
         ))
   )
  left join public.fechamentos f
    on f.negociacao_id = n.id and e.etapa = 'fechado'
  group by e.etapa
  order by e.etapa;
$$;

comment on function public.dashboard_etapas is
  'Quantidade e valor por etapa. Abertas: atual; fechado/perdido: no período.';

-- ---------------------------------------------------------------------------
-- 2c. Vendas por mês (últimos p_meses, incluindo o atual), com meses zerados.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_vendas_mensais(p_meses integer default 12)
returns table (
  mes         date,
  valor       numeric,
  quantidade  bigint
)
language sql
stable
set search_path = ''
as $$
  with meses as (
    select generate_series(
      date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
        - make_interval(months => greatest(p_meses, 1) - 1),
      date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
      interval '1 month'
    )::date as mes
  )
  select
    m.mes,
    coalesce(sum(f.valor_vendido), 0),
    count(f.negociacao_id)
  from meses m
  left join (
    public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id and n.etapa = 'fechado'
  )
    on date_trunc('month', f.data_fechamento)::date = m.mes
  group by m.mes
  order by m.mes;
$$;

comment on function public.dashboard_vendas_mensais is
  'Valor vendido por mês de fechamento. SECURITY INVOKER: respeita a RLS.';

revoke all on function public.dashboard_por_usuario from public, anon;
revoke all on function public.dashboard_etapas from public, anon;
revoke all on function public.dashboard_vendas_mensais from public, anon;
grant execute on function public.dashboard_por_usuario to authenticated;
grant execute on function public.dashboard_etapas to authenticated;
grant execute on function public.dashboard_vendas_mensais to authenticated;
