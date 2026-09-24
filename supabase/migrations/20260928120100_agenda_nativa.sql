-- ===========================================================================
-- Agenda 2.0 — N1 (2/2): agenda nativa do CRM.
--
-- O CRM é a fonte principal da agenda; o Google é integração opcional (fases
-- G1/G2, em outra migration). Aqui:
--
--   1. Cor da agenda por usuário (profiles.cor_agenda) — só o gerente muda.
--   2. Regra do responsável: precisa ter acesso ao cliente (dono da carteira
--      ou gerente) e estar ativo.
--   3. Recorrência: `eventos_series` + ocorrências materializadas em
--      `eventos` (cada ocorrência tem status e timeline próprios). Término
--      obrigatório: até 12 meses ou 200 ocorrências.
--   4. Funções: criar série, alterar e cancelar com escopo
--      (este / seguintes / todos). Realizados, não compareceu e cancelados
--      nunca são reescritos por edição em lote.
--   5. Excluir só evento sem histórico (agendado ou confirmado).
--   6. Transferir carteira leva junto os compromissos futuros em aberto.
--   7. 'confirmado' passa a contar como compromisso em aberto no card do
--      funil (próxima ação) e no dashboard (reuniões próximas).
--   8. View `agenda_eventos` para as visões Dia / Semana / Quinzena / Mês.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Cor da agenda.
--
-- Reaproveita a paleta das etapas (cor_etapa): mesmas 10 cores, já mapeadas
-- para hex em lib/utils/etapas.ts. Nulo = cinza na tela.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column cor_agenda public.cor_etapa;

comment on column public.profiles.cor_agenda is
  'Cor do usuário na agenda (e, com o Google ligado, a cor do evento lá). Só o gerente altera.';

-- O closer pode editar o próprio perfil (policy de UPDATE); a cor, como papel
-- e acesso, é decisão do gerente.
create or replace function public.profiles_guard_privilegios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_gerente() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.ativo is distinct from old.ativo
     or new.cor_agenda is distinct from old.cor_agenda
  then
    raise exception
      'Apenas um gerente pode alterar papel, status de acesso ou cor da agenda de um usuário.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Colunas novas em eventos.
-- ---------------------------------------------------------------------------
create type public.origem_evento as enum ('crm', 'google');

create type public.frequencia_recorrencia as enum ('diaria', 'semanal', 'mensal');

create table public.eventos_series (
  id             uuid primary key default gen_random_uuid(),

  -- Modelo das ocorrências.
  titulo         text not null check (length(btrim(titulo)) > 0),
  tipo           public.tipo_evento not null default 'reuniao',
  cliente_id     uuid not null references public.clientes (id) on delete cascade,
  negociacao_id  uuid references public.negociacoes (id) on delete set null,
  usuario_id     uuid not null references public.profiles (id) on delete restrict,
  descricao      text,
  data_inicio    date not null,
  hora_inicio    time not null,
  duracao        interval not null
                   constraint eventos_series_duracao_valida
                   check (duracao > interval '0' and duracao <= interval '24 hours'),
  fuso           text not null default 'America/Sao_Paulo',

  -- Regra. "Diária/semanal/mensal" são intervalo 1; "personalizada" muda o
  -- intervalo, os dias da semana e o término.
  frequencia     public.frequencia_recorrencia not null,
  intervalo      smallint not null default 1
                   constraint eventos_series_intervalo_valido check (intervalo between 1 and 99),
  -- ISO: 1 = segunda … 7 = domingo.
  dias_semana    smallint[],
  dia_mes        smallint,

  -- Término obrigatório: uma data (até 12 meses) OU um número de ocorrências.
  termina_em     date,
  ocorrencias    smallint
                   constraint eventos_series_ocorrencias_validas check (ocorrencias between 1 and 200),

  criado_por     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint eventos_series_termino_obrigatorio
    check (num_nonnulls(termina_em, ocorrencias) = 1),
  constraint eventos_series_termino_ate_12_meses
    check (termina_em is null
           or (termina_em >= data_inicio and termina_em <= (data_inicio + interval '12 months')::date)),
  constraint eventos_series_semanal_exige_dias
    check (frequencia <> 'semanal'
           or (cardinality(dias_semana) >= 1
               and dias_semana <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  constraint eventos_series_mensal_exige_dia
    check (frequencia <> 'mensal' or dia_mes between 1 and 31)
);

comment on table public.eventos_series is
  'Regra de recorrência. As ocorrências são linhas reais em eventos (serie_id), '
  'geradas de uma vez na criação — por isso o término é obrigatório.';

create trigger eventos_series_set_updated_at
  before update on public.eventos_series
  for each row
  execute function public.set_updated_at();

create trigger eventos_series_negociacao_do_cliente
  before insert or update of cliente_id, negociacao_id on public.eventos_series
  for each row
  execute function public.valida_negociacao_do_cliente();

alter table public.eventos
  add column serie_id uuid references public.eventos_series (id) on delete set null,
  add column ocorrencia_original timestamptz,
  add column origem public.origem_evento not null default 'crm',
  add column google_etag text,
  add column criado_por uuid default auth.uid() references public.profiles (id) on delete set null;

comment on column public.eventos.ocorrencia_original is
  'Início previsto pela regra da série. Não muda quando a ocorrência é editada: '
  'é o que define "esta e as seguintes".';
comment on column public.eventos.origem is
  'crm = criado no CRM (fonte principal). google = importado (fase G2).';
comment on column public.eventos.criado_por is
  'Quem criou. Pode ser diferente do responsável (gerente agendando para um closer).';

create index eventos_serie_idx
  on public.eventos (serie_id, ocorrencia_original)
  where serie_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Responsável precisa ter acesso ao cliente.
--
-- Ativo, e gerente (vê todos os clientes) ou dono da carteira do cliente.
-- Complementa a RLS (que já impede o closer de criar para outra pessoa ou em
-- cliente alheio): impede o GERENTE de pôr como responsável um closer que não
-- enxerga o cliente. Vale para eventos e séries.
--
-- SECURITY DEFINER: lê o perfil do responsável, que a RLS esconde do closer.
-- ---------------------------------------------------------------------------
create or replace function public.agenda_valida_responsavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  public.user_role;
  v_ativo boolean;
begin
  select p.role, p.ativo into v_role, v_ativo
    from public.profiles p
   where p.id = new.usuario_id;

  if not found or not v_ativo then
    raise exception 'O responsável precisa ser um usuário ativo.'
      using errcode = '23514';
  end if;

  if v_role <> 'gerente'
     and public.cliente_owner(new.cliente_id) is distinct from new.usuario_id
  then
    raise exception 'O responsável precisa ter acesso ao cliente (dono da carteira ou gerente).'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger eventos_valida_responsavel
  before insert or update of usuario_id, cliente_id on public.eventos
  for each row
  execute function public.agenda_valida_responsavel();

create trigger eventos_series_valida_responsavel
  before insert or update of usuario_id, cliente_id on public.eventos_series
  for each row
  execute function public.agenda_valida_responsavel();

-- ---------------------------------------------------------------------------
-- 4. RLS.
-- ---------------------------------------------------------------------------

-- Excluir só evento sem histórico. Realizado / não compareceu já estão na
-- timeline; cancelado é histórico. Cancelar (status) continua sempre possível.
drop policy eventos_delete on public.eventos;

create policy eventos_delete on public.eventos
  for delete
  to authenticated
  using (
    (usuario_id = (select auth.uid()) or public.is_gerente())
    and status in ('agendado', 'confirmado')
  );

-- Séries: mesma regra de eventos.
alter table public.eventos_series enable row level security;

create policy eventos_series_select on public.eventos_series
  for select
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or public.is_gerente()
  );

create policy eventos_series_insert on public.eventos_series
  for insert
  to authenticated
  with check (
    (usuario_id = (select auth.uid()) or public.is_gerente())
    and (public.cliente_owner(cliente_id) = (select auth.uid()) or public.is_gerente())
    and (negociacao_id is null
         or public.negociacao_owner(negociacao_id) = (select auth.uid())
         or public.is_gerente())
  );

create policy eventos_series_update on public.eventos_series
  for update
  to authenticated
  using (
    usuario_id = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    (usuario_id = (select auth.uid()) or public.is_gerente())
    and (public.cliente_owner(cliente_id) = (select auth.uid()) or public.is_gerente())
    and (negociacao_id is null
         or public.negociacao_owner(negociacao_id) = (select auth.uid())
         or public.is_gerente())
  );

revoke all on table public.eventos_series from anon;
grant select, insert, update on table public.eventos_series to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Recorrência.
-- ---------------------------------------------------------------------------

-- Datas locais das ocorrências (sem hora). Teto duro: 12 meses e 200.
-- Mensal com dia 29–31 cai no último dia dos meses mais curtos.
create or replace function public.expandir_recorrencia(
  p_data_inicio  date,
  p_frequencia   public.frequencia_recorrencia,
  p_intervalo    integer,
  p_dias_semana  smallint[],
  p_dia_mes      smallint,
  p_termina_em   date,
  p_ocorrencias  integer
)
returns table (data date)
language sql
immutable
set search_path = ''
as $$
  with
  limite as (
    select least(
      coalesce(p_termina_em, (p_data_inicio + interval '12 months')::date),
      (p_data_inicio + interval '12 months')::date
    ) as ate
  ),
  candidatas as (
    select d::date as data
      from limite,
           generate_series(p_data_inicio::timestamp, limite.ate::timestamp,
                           make_interval(days => p_intervalo)) d
     where p_frequencia = 'diaria'

    union all

    -- Semanas a partir da segunda-feira da semana inicial.
    select (semana + (dia - 1) * interval '1 day')::date
      from limite,
           generate_series(
             (p_data_inicio - (extract(isodow from p_data_inicio)::int - 1))::timestamp,
             limite.ate::timestamp,
             make_interval(weeks => p_intervalo)
           ) semana,
           unnest(p_dias_semana) dia
     where p_frequencia = 'semanal'

    union all

    select (mes + (least(
              p_dia_mes::int,
              extract(day from mes + interval '1 month' - interval '1 day')::int
            ) - 1) * interval '1 day')::date
      from limite,
           generate_series(date_trunc('month', p_data_inicio::timestamp), limite.ate::timestamp,
                           make_interval(months => p_intervalo)) mes
     where p_frequencia = 'mensal'
  )
  select c.data
    from candidatas c, limite
   where c.data >= p_data_inicio
     and c.data <= limite.ate
   order by c.data
   limit least(coalesce(p_ocorrencias, 200), 200);
$$;

comment on function public.expandir_recorrencia is
  'Datas locais das ocorrências de uma regra. Teto: 12 meses e 200 ocorrências.';

-- Cria a série e todas as ocorrências numa transação. Devolve o id da
-- primeira ocorrência. SECURITY INVOKER: a RLS e os triggers (responsável,
-- negociação do cliente) valem para cada linha.
create or replace function public.criar_serie_eventos(
  p_titulo            text,
  p_tipo              public.tipo_evento,
  p_status            public.status_evento,
  p_cliente_id        uuid,
  p_negociacao_id     uuid,
  p_usuario_id        uuid,
  p_descricao         text,
  p_data_inicio       date,
  p_hora_inicio       time,
  p_duracao_minutos   integer,
  p_frequencia        public.frequencia_recorrencia,
  p_intervalo         integer,
  p_dias_semana       smallint[],
  p_dia_mes           smallint,
  p_termina_em        date,
  p_ocorrencias       integer
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_serie   public.eventos_series%rowtype;
  v_inicio  timestamptz;
  v_primeiro uuid;
  v_id      uuid;
begin
  if p_status not in ('agendado', 'confirmado') then
    raise exception 'Uma série nasce agendada ou confirmada.' using errcode = '23514';
  end if;

  insert into public.eventos_series (
    titulo, tipo, cliente_id, negociacao_id, usuario_id, descricao,
    data_inicio, hora_inicio, duracao, frequencia, intervalo,
    dias_semana, dia_mes, termina_em, ocorrencias
  )
  values (
    p_titulo, p_tipo, p_cliente_id, p_negociacao_id, p_usuario_id, nullif(btrim(p_descricao), ''),
    p_data_inicio, p_hora_inicio, make_interval(mins => p_duracao_minutos), p_frequencia, p_intervalo,
    case when p_frequencia = 'semanal' then p_dias_semana end,
    case when p_frequencia = 'mensal' then p_dia_mes end,
    p_termina_em, p_ocorrencias
  )
  returning * into v_serie;

  for v_inicio in
    select (r.data + v_serie.hora_inicio) at time zone v_serie.fuso
      from public.expandir_recorrencia(
        v_serie.data_inicio, v_serie.frequencia, v_serie.intervalo, v_serie.dias_semana,
        v_serie.dia_mes, v_serie.termina_em, v_serie.ocorrencias
      ) r
  loop
    insert into public.eventos (
      titulo, tipo, status, inicio, fim, cliente_id, negociacao_id, usuario_id,
      descricao, serie_id, ocorrencia_original
    )
    values (
      v_serie.titulo, v_serie.tipo, p_status, v_inicio, v_inicio + v_serie.duracao,
      v_serie.cliente_id, v_serie.negociacao_id, v_serie.usuario_id,
      v_serie.descricao, v_serie.id, v_inicio
    )
    returning id into v_id;

    v_primeiro := coalesce(v_primeiro, v_id);
  end loop;

  if v_primeiro is null then
    raise exception 'A recorrência não gera nenhuma ocorrência no período.' using errcode = '23514';
  end if;

  return v_primeiro;
end;
$$;

comment on function public.criar_serie_eventos is
  'Cria a série e todas as ocorrências em eventos numa transação. SECURITY INVOKER.';

-- Eventos atingidos por uma edição/cancelamento com escopo. Em lote
-- ('seguintes', 'todos') só entram os em aberto: realizado, não compareceu e
-- cancelado são histórico e nunca são reescritos.
create or replace function public.agenda_alvos(
  p_evento  public.eventos,
  p_escopo  text
)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select p_evento.id
   where p_escopo = 'este' or p_evento.serie_id is null
  union
  select e.id
    from public.eventos e
   where p_escopo in ('seguintes', 'todos')
     and p_evento.serie_id is not null
     and e.serie_id = p_evento.serie_id
     and e.status in ('agendado', 'confirmado')
     and (p_escopo = 'todos' or e.ocorrencia_original >= p_evento.ocorrencia_original);
$$;

-- Edita um evento ou parte da série.
--   este: todos os campos, inclusive data e horário.
--   seguintes / todos: cada ocorrência mantém a própria data e recebe o novo
--   horário e duração (p_data é ignorada). 'todos' também atualiza o modelo
--   da série. Mudar a regra de recorrência = cancelar e criar outra série.
-- Devolve quantos eventos mudaram.
create or replace function public.alterar_eventos(
  p_evento_id         uuid,
  p_escopo            text,
  p_titulo            text,
  p_tipo              public.tipo_evento,
  p_cliente_id        uuid,
  p_negociacao_id     uuid,
  p_usuario_id        uuid,
  p_descricao         text,
  p_data              date,
  p_hora_inicio       time,
  p_duracao_minutos   integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_evento   public.eventos%rowtype;
  v_duracao  interval := make_interval(mins => p_duracao_minutos);
  v_fuso     constant text := 'America/Sao_Paulo';
  v_total    integer;
begin
  if p_escopo not in ('este', 'seguintes', 'todos') then
    raise exception 'Escopo inválido.' using errcode = '22023';
  end if;
  if p_duracao_minutos is null or p_duracao_minutos <= 0 or p_duracao_minutos > 1440 then
    raise exception 'Duração inválida.' using errcode = '23514';
  end if;

  select * into v_evento from public.eventos where id = p_evento_id for update;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  update public.eventos e
     set titulo        = p_titulo,
         tipo          = p_tipo,
         cliente_id    = p_cliente_id,
         negociacao_id = p_negociacao_id,
         usuario_id    = p_usuario_id,
         descricao     = nullif(btrim(p_descricao), ''),
         inicio        = case
                           when p_escopo = 'este' or v_evento.serie_id is null
                             then (p_data + p_hora_inicio) at time zone v_fuso
                           else ((e.inicio at time zone v_fuso)::date + p_hora_inicio) at time zone v_fuso
                         end,
         fim           = case
                           when p_escopo = 'este' or v_evento.serie_id is null
                             then ((p_data + p_hora_inicio) at time zone v_fuso) + v_duracao
                           else (((e.inicio at time zone v_fuso)::date + p_hora_inicio) at time zone v_fuso) + v_duracao
                         end
   where e.id in (select public.agenda_alvos(v_evento, p_escopo));

  get diagnostics v_total = row_count;

  if p_escopo = 'todos' and v_evento.serie_id is not null then
    update public.eventos_series
       set titulo        = p_titulo,
           tipo          = p_tipo,
           cliente_id    = p_cliente_id,
           negociacao_id = p_negociacao_id,
           usuario_id    = p_usuario_id,
           descricao     = nullif(btrim(p_descricao), ''),
           hora_inicio   = p_hora_inicio,
           duracao       = v_duracao
     where id = v_evento.serie_id;
  end if;

  return v_total;
end;
$$;

comment on function public.alterar_eventos is
  'Edita um evento ou a série (este / seguintes / todos). Histórico não é reescrito. SECURITY INVOKER.';

-- Cancela (status) com escopo. Só eventos em aberto mudam; devolve quantos.
create or replace function public.cancelar_eventos(
  p_evento_id  uuid,
  p_escopo     text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_evento  public.eventos%rowtype;
  v_total   integer;
begin
  if p_escopo not in ('este', 'seguintes', 'todos') then
    raise exception 'Escopo inválido.' using errcode = '22023';
  end if;

  select * into v_evento from public.eventos where id = p_evento_id for update;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  update public.eventos
     set status = 'cancelado'
   where id in (select public.agenda_alvos(v_evento, p_escopo))
     and status in ('agendado', 'confirmado');

  get diagnostics v_total = row_count;

  if v_total = 0 and (p_escopo = 'este' or v_evento.serie_id is null) then
    raise exception 'Só compromissos agendados ou confirmados podem ser cancelados.'
      using errcode = '23514';
  end if;

  return v_total;
end;
$$;

comment on function public.cancelar_eventos is
  'Cancela um evento ou parte da série (este / seguintes / todos). SECURITY INVOKER.';

revoke all on function public.expandir_recorrencia(date, public.frequencia_recorrencia, integer, smallint[], smallint, date, integer) from public, anon;
revoke all on function public.criar_serie_eventos from public, anon;
revoke all on function public.agenda_alvos(public.eventos, text) from public, anon;
revoke all on function public.alterar_eventos from public, anon;
revoke all on function public.cancelar_eventos(uuid, text) from public, anon;
revoke all on function public.agenda_valida_responsavel() from public, anon, authenticated;

grant execute on function public.expandir_recorrencia(date, public.frequencia_recorrencia, integer, smallint[], smallint, date, integer) to authenticated;
grant execute on function public.criar_serie_eventos to authenticated;
grant execute on function public.agenda_alvos(public.eventos, text) to authenticated;
grant execute on function public.alterar_eventos to authenticated;
grant execute on function public.cancelar_eventos(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Transferência de carteira leva os compromissos futuros em aberto.
--
-- Sem isso, o closer antigo continuaria responsável por reuniões de um
-- cliente que ele não enxerga mais. Passado, realizados e cancelados ficam
-- com quem os fez; compromissos de gerente não mudam.
-- ---------------------------------------------------------------------------
create or replace function public.clientes_propaga_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.negociacoes
       set owner_id = new.owner_id
     where cliente_id = new.id;

    update public.eventos
       set usuario_id = new.owner_id
     where cliente_id = new.id
       and usuario_id = old.owner_id
       and status in ('agendado', 'confirmado')
       and inicio >= now();

    update public.eventos_series
       set usuario_id = new.owner_id
     where cliente_id = new.id
       and usuario_id = old.owner_id;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 'confirmado' é compromisso em aberto, como 'agendado'.
--
-- Recriação fiel das versões em produção (Fase 8B), mudando só o filtro de
-- status. funil_cards mantém security_invoker.
-- ---------------------------------------------------------------------------
create or replace view public.funil_cards
with (security_invoker = true)
as
select
  n.id,
  n.etapa_id,
  e.nome  as etapa_nome,
  e.cor   as etapa_cor,
  e.tipo  as etapa_tipo,
  n.posicao,
  n.valor_estimado,
  n.temperatura,
  n.data_entrada_etapa,
  n.owner_id,
  p.nome  as responsavel_nome,
  c.id    as cliente_id,
  c.nome  as cliente_nome,
  c.empresa as cliente_empresa,
  pa.titulo as proxima_acao_titulo,
  pa.data   as proxima_acao_data,
  ua.tipo      as ultima_atividade_tipo,
  ua.data      as ultima_atividade_data,
  ua.descricao as ultima_atividade_descricao
from public.negociacoes n
join public.etapas_funil e on e.id = n.etapa_id
join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
left join public.profiles p on p.id = n.owner_id
left join lateral (
  select x.titulo, x.data
  from (
    select a.titulo, a.data
    from public.proximas_acoes a
    where a.concluida_em is null
      and (a.negociacao_id = n.id or (a.negociacao_id is null and a.cliente_id = n.cliente_id))
    union all
    select ev.titulo, (ev.inicio at time zone 'America/Sao_Paulo')::date
    from public.eventos ev
    where ev.status in ('agendado', 'confirmado')
      and ev.inicio >= now()
      and (ev.negociacao_id = n.id or (ev.negociacao_id is null and ev.cliente_id = n.cliente_id))
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
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta'
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    group by n.owner_id
  ),
  ganhos as (
    select n.owner_id, sum(f.valor_vendido) as valor, count(*) as qtd
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    where f.data_fechamento between p_inicio and p_fim
    group by n.owner_id
  ),
  perdidos as (
    select n.owner_id, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'perdida'
    cross join periodo
    where n.data_entrada_etapa >= periodo.inicio
      and n.data_entrada_etapa <  periodo.fim
    group by n.owner_id
  ),
  reunioes as (
    select
      e.usuario_id,
      count(*) filter (
        where e.status in ('agendado', 'confirmado')
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

-- ---------------------------------------------------------------------------
-- 8. View da agenda.
--
-- Um evento por linha com cliente, negociação e nome/cor do responsável.
-- security_invoker: respeita a RLS de quem consulta (o closer só vê os
-- próprios eventos — e o próprio perfil; o gerente, tudo). Cliente excluído
-- (soft delete) sai da agenda, como no funil.
-- ---------------------------------------------------------------------------
create view public.agenda_eventos
with (security_invoker = true)
as
select
  e.id,
  e.titulo,
  e.tipo,
  e.status,
  e.inicio,
  e.fim,
  e.descricao,
  e.cliente_id,
  c.nome     as cliente_nome,
  c.empresa  as cliente_empresa,
  e.negociacao_id,
  n.titulo   as negociacao_titulo,
  e.usuario_id,
  p.nome       as responsavel_nome,
  p.cor_agenda as responsavel_cor,
  e.serie_id,
  e.ocorrencia_original,
  e.origem,
  e.google_event_id
from public.eventos e
join public.clientes c on c.id = e.cliente_id and c.deleted_at is null
left join public.negociacoes n on n.id = e.negociacao_id
left join public.profiles p on p.id = e.usuario_id;

comment on view public.agenda_eventos is
  'Eventos para as visões da agenda (dia/semana/quinzena/mês). security_invoker: respeita a RLS.';

revoke all on public.agenda_eventos from anon;
grant select on public.agenda_eventos to authenticated;
