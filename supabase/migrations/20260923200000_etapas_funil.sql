-- ===========================================================================
-- Fase 8B — Funil dinâmico: etapas deixam de ser o enum `etapa_funil` e
-- passam a ser linhas de `etapas_funil`.
--
-- As regras de negócio que antes olhavam o NOME da etapa ('fechado',
-- 'perdido') passam a olhar o TIPO:
--   aberta  — etapas de trabalho (as de sistema e todas as personalizadas)
--   ganha   — Fechado: exige registro em `fechamentos`
--   perdida — Perdido: exige motivo
--
-- Etapas de sistema (as 6 originais): só a cor muda. Personalizadas: nome,
-- cor e posição, sempre antes de Negociação. Excluir só o que nunca foi
-- usado; o que já teve negociação é desativado.
--
-- Ordem do arquivo:
--   1. tipos e tabela   2. regras da tabela   3. negociacoes.etapa_id
--   4. historico_etapas   5. triggers e funções recriados
--   6. view e dashboard   7. remoção do enum antigo
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos e tabela.
-- ---------------------------------------------------------------------------
create type public.tipo_etapa as enum ('aberta', 'ganha', 'perdida');

-- Paleta fixa: o app mapeia cada nome para a cor. Não há hex livre.
create type public.cor_etapa as enum (
  'azul', 'violeta', 'amarelo', 'laranja', 'verde',
  'vermelho', 'ciano', 'rosa', 'turquesa', 'cinza'
);

create table public.etapas_funil (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 1 and 60),
  cor         public.cor_etapa not null,
  ordem       numeric not null,
  tipo        public.tipo_etapa not null default 'aberta',
  sistema     boolean not null default false,
  chave       text unique,
  ativo       boolean not null default true,
  criado_por  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- `chave` identifica as etapas de sistema no código e no SQL; as
  -- personalizadas não têm.
  constraint etapas_funil_chave_so_sistema check ((chave is not null) = sistema)
);

comment on table public.etapas_funil is
  'Colunas do Kanban. Regras de negócio seguem o tipo (aberta/ganha/perdida), nunca o nome.';
comment on column public.etapas_funil.ordem is
  'Posição da coluna. numeric para inserir entre duas etapas sem renumerar.';

-- Uma única etapa ganha e uma única perdida.
create unique index etapas_funil_tipo_final_unico
  on public.etapas_funil (tipo)
  where tipo in ('ganha', 'perdida');

create unique index etapas_funil_nome_ativo_unico
  on public.etapas_funil (lower(btrim(nome)))
  where ativo;

create unique index etapas_funil_ordem_unica on public.etapas_funil (ordem);

create trigger etapas_funil_set_updated_at
  before update on public.etapas_funil
  for each row
  execute function public.set_updated_at();

-- As 6 etapas atuais, com as cores que o app já usa. A ordem é espaçada
-- para caber personalizadas entre as abertas.
insert into public.etapas_funil (nome, cor, ordem, tipo, sistema, chave, criado_por) values
  ('Reunião agendada',  'azul',     1000,   'aberta',  true, 'reuniao_agendada',  null),
  ('Reunião realizada', 'violeta',  2000,   'aberta',  true, 'reuniao_realizada', null),
  ('Proposta enviada',  'amarelo',  3000,   'aberta',  true, 'proposta_enviada',  null),
  ('Negociação',        'laranja',  4000,   'aberta',  true, 'negociacao',        null),
  ('Fechado',           'verde',    100000, 'ganha',   true, 'fechado',           null),
  ('Perdido',           'vermelho', 100001, 'perdida', true, 'perdido',           null);

-- ---------------------------------------------------------------------------
-- Funções de apoio.
-- ---------------------------------------------------------------------------
create or replace function public.etapa_id_por_chave(p_chave text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select e.id from public.etapas_funil e where e.chave = p_chave;
$$;

create or replace function public.etapa_tipo(p_etapa_id uuid)
returns public.tipo_etapa
language sql
stable
set search_path = ''
as $$
  select e.tipo from public.etapas_funil e where e.id = p_etapa_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. Regras da tabela de etapas.
-- ---------------------------------------------------------------------------
create or replace function public.etapas_funil_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limite numeric;
begin
  if tg_op = 'DELETE' then
    if old.sistema then
      raise exception 'Etapas padrão do funil não podem ser excluídas.' using errcode = '23514';
    end if;
    if exists (select 1 from public.negociacoes n where n.etapa_id = old.id)
       or exists (
         select 1 from public.historico_etapas h
         where h.etapa_nova_id = old.id or h.etapa_anterior_id = old.id
       )
    then
      raise exception 'A etapa "%" já teve negociações. Desative-a em vez de excluir.', old.nome
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.sistema then
    -- Sistema: só a cor muda.
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Personalizada (inserção ou edição).
  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;
  if new.tipo <> 'aberta' then
    raise exception 'Etapas personalizadas são sempre etapas abertas.' using errcode = '23514';
  end if;

  -- Sempre antes de Negociação (e, portanto, de Fechado e Perdido).
  select e.ordem into v_limite from public.etapas_funil e where e.chave = 'negociacao';
  if new.ordem >= v_limite then
    raise exception 'Etapas personalizadas ficam antes de Negociação.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.ativo and not new.ativo
     and exists (select 1 from public.negociacoes n where n.etapa_id = new.id)
  then
    raise exception 'Mova as negociações da etapa "%" antes de desativá-la.', new.nome
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger etapas_funil_regras
  before insert or update or delete on public.etapas_funil
  for each row
  execute function public.etapas_funil_regras();

alter table public.etapas_funil enable row level security;

create policy etapas_funil_select on public.etapas_funil
  for select to authenticated
  using (true);

create policy etapas_funil_insert on public.etapas_funil
  for insert to authenticated
  with check (public.is_gerente());

create policy etapas_funil_update on public.etapas_funil
  for update to authenticated
  using (public.is_gerente())
  with check (public.is_gerente());

create policy etapas_funil_delete on public.etapas_funil
  for delete to authenticated
  using (public.is_gerente() and not sistema);

revoke all on table public.etapas_funil from anon;
grant select, insert, update, delete on table public.etapas_funil to authenticated;

-- ---------------------------------------------------------------------------
-- 3. negociacoes.etapa_id
--
-- A view e os triggers que usam a coluna antiga saem antes; são recriados
-- nas seções 5 e 6.
-- ---------------------------------------------------------------------------
drop view public.funil_cards;
drop trigger negociacoes_marca_etapa on public.negociacoes;
drop trigger negociacoes_registra_etapa on public.negociacoes;
alter table public.negociacoes drop constraint negociacoes_perdido_exige_motivo;

alter table public.negociacoes
  add column etapa_id uuid references public.etapas_funil (id) on delete restrict;

update public.negociacoes n
   set etapa_id = e.id
  from public.etapas_funil e
 where e.chave = n.etapa::text;

-- O UPDATE acima enfileira o constraint trigger deferido "fechado exige
-- fechamento", e o Postgres não altera uma tabela com eventos pendentes.
-- Dispara as checagens agora (continuam valendo) e volta ao modo deferido.
set constraints all immediate;
set constraints all deferred;

do $$
begin
  if exists (select 1 from public.negociacoes where etapa_id is null) then
    raise exception 'Migração abortada: negociação sem etapa correspondente.';
  end if;
end;
$$;

alter table public.negociacoes
  alter column etapa_id set not null,
  -- Toda negociação nova começa em Reunião agendada.
  alter column etapa_id set default public.etapa_id_por_chave('reuniao_agendada');

create index negociacoes_owner_etapa_id_idx on public.negociacoes (owner_id, etapa_id);
create index negociacoes_board_etapa_id_idx on public.negociacoes (etapa_id, posicao);

-- ---------------------------------------------------------------------------
-- 4. historico_etapas
-- ---------------------------------------------------------------------------
alter table public.historico_etapas
  add column etapa_anterior_id uuid references public.etapas_funil (id) on delete restrict,
  add column etapa_nova_id     uuid references public.etapas_funil (id) on delete restrict;

update public.historico_etapas h
   set etapa_nova_id = (select e.id from public.etapas_funil e where e.chave = h.etapa_nova::text),
       etapa_anterior_id = (select e.id from public.etapas_funil e where e.chave = h.etapa_anterior::text);

do $$
begin
  if exists (select 1 from public.historico_etapas where etapa_nova_id is null)
     or exists (
       select 1 from public.historico_etapas
       where etapa_anterior is not null and etapa_anterior_id is null
     )
  then
    raise exception 'Migração abortada: histórico sem etapa correspondente.';
  end if;
end;
$$;

alter table public.historico_etapas alter column etapa_nova_id set not null;

-- Uso de cada etapa, para a tela de configuração decidir entre excluir e
-- desativar. SECURITY INVOKER: o gerente enxerga todas as negociações.
create or replace function public.etapas_funil_uso()
returns table (etapa_id uuid, negociacoes_atuais bigint, ja_usada boolean)
language sql
stable
set search_path = ''
as $$
  select
    e.id,
    (select count(*) from public.negociacoes n where n.etapa_id = e.id),
    exists (select 1 from public.negociacoes n where n.etapa_id = e.id)
      or exists (
        select 1 from public.historico_etapas h
        where h.etapa_nova_id = e.id or h.etapa_anterior_id = e.id
      )
  from public.etapas_funil e;
$$;

revoke all on function public.etapas_funil_uso from public, anon;
grant execute on function public.etapas_funil_uso to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Regras da negociação, agora pelo tipo da etapa.
-- ---------------------------------------------------------------------------

-- Etapa perdida exige motivo; e ninguém entra numa etapa desativada.
-- (Era uma CHECK constraint; CHECK não consulta outra tabela.)
create or replace function public.negociacoes_valida_etapa()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_etapa public.etapas_funil%rowtype;
begin
  select * into v_etapa from public.etapas_funil where id = new.etapa_id;

  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    if not v_etapa.ativo then
      raise exception 'A etapa "%" está desativada.', v_etapa.nome using errcode = '23514';
    end if;
  end if;

  if v_etapa.tipo = 'perdida'
     and (new.motivo_perda is null or length(btrim(new.motivo_perda)) = 0)
  then
    raise exception 'Negociação perdida exige motivo.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger negociacoes_valida_etapa
  before insert or update of etapa_id, motivo_perda on public.negociacoes
  for each row
  execute function public.negociacoes_valida_etapa();

create or replace function public.negociacoes_marca_etapa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.etapa_id is distinct from old.etapa_id then
    new.data_entrada_etapa := now();
  end if;
  return new;
end;
$$;

create trigger negociacoes_marca_etapa
  before update of etapa_id on public.negociacoes
  for each row
  execute function public.negociacoes_marca_etapa();

create or replace function public.negociacoes_registra_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    insert into public.historico_etapas (negociacao_id, etapa_anterior_id, etapa_nova_id, usuario_id)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.etapa_id end,
      new.etapa_id,
      (select auth.uid())
    );
  end if;
  return null;
end;
$$;

create trigger negociacoes_registra_etapa
  after insert or update of etapa_id on public.negociacoes
  for each row
  execute function public.negociacoes_registra_etapa();

-- Etapa ganha exige fechamento (constraint trigger deferido, como antes).
create or replace function public.negociacoes_exige_fechamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.etapa_tipo(new.etapa_id) = 'ganha'
     and not exists (select 1 from public.fechamentos f where f.negociacao_id = new.id)
  then
    raise exception 'Negociação % não pode ir para a etapa de fechamento sem registro de fechamento (valor vendido, contrato enviado, contrato assinado, status de pagamento e onboarding).', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.fechamentos_protege_negociacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.negociacoes n
    where n.id = old.negociacao_id
      and public.etapa_tipo(n.etapa_id) = 'ganha'
  )
  then
    raise exception 'Tire a negociação % da etapa de fechamento antes de remover o registro de fechamento.', old.negociacao_id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.negociacoes
     set etapa_id = (select e.id from public.etapas_funil e where e.tipo = 'ganha'),
         posicao = p_posicao
   where id = p_negociacao_id;

  if not found then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, link_contrato, status_pagamento, status_onboarding
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;

create or replace function public.criar_cliente(
  p_tipo_cliente public.tipo_cliente,
  p_nome         text,
  p_empresa      text default null,
  p_cpf          text default null,
  p_cnpj         text default null,
  p_telefone     text default null,
  p_whatsapp     text default null,
  p_email        text default null,
  p_responsavel  text default null,
  p_cargo        text default null,
  p_observacoes  text default null,
  p_owner_id     uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_cliente_id uuid;
begin
  insert into public.clientes (
    tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
    responsavel, cargo, observacoes, owner_id
  )
  values (
    p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone, p_whatsapp,
    p_email, p_responsavel, p_cargo, p_observacoes,
    coalesce(p_owner_id, (select auth.uid()))
  )
  returning id into v_cliente_id;

  -- Sempre em Reunião agendada, qualquer que seja a ordem das colunas.
  insert into public.negociacoes (cliente_id, owner_id, etapa_id)
  values (
    v_cliente_id,
    coalesce(p_owner_id, (select auth.uid())),
    public.etapa_id_por_chave('reuniao_agendada')
  );

  return v_cliente_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. View do funil e funções do dashboard.
-- ---------------------------------------------------------------------------
create view public.funil_cards
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
  ua.descricao      as ultima_atividade_descricao
from public.negociacoes n
join public.etapas_funil e
  on e.id = n.etapa_id
join public.clientes c
  on c.id = n.cliente_id
 and c.deleted_at is null
left join public.profiles p
  on p.id = n.owner_id
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
  'Um card do Kanban por negociação. security_invoker: respeita a RLS.';

revoke all on public.funil_cards from anon;
grant select on public.funil_cards to authenticated;

-- Mesma lógica de antes; "fechado"/"perdido"/"abertas" viram tipos.
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

-- O retorno muda (etapa deixa de ser enum), então a função é recriada.
drop function public.dashboard_etapas(date, date);

create function public.dashboard_etapas(
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
  with periodo as (
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
    count(n.id),
    coalesce(sum(coalesce(f.valor_vendido, n.valor_estimado)), 0)
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
     or (e.tipo = 'perdida'
         and n.data_entrada_etapa >= periodo.inicio
         and n.data_entrada_etapa <  periodo.fim)
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
  group by e.id, e.nome, e.cor, e.tipo, e.ordem
  order by e.ordem;
$$;

comment on function public.dashboard_etapas is
  'Quantidade e valor por etapa ativa. Abertas: atual; ganha/perdida: no período.';

revoke all on function public.dashboard_etapas from public, anon;
grant execute on function public.dashboard_etapas to authenticated;

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
    join public.negociacoes n on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
  )
    on date_trunc('month', f.data_fechamento)::date = m.mes
  group by m.mes
  order by m.mes;
$$;

-- ---------------------------------------------------------------------------
-- 7. Remoção do enum antigo.
-- ---------------------------------------------------------------------------
alter table public.negociacoes drop column etapa;
alter table public.historico_etapas drop column etapa_anterior, drop column etapa_nova;
drop type public.etapa_funil;
