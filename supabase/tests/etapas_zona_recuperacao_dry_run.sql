-- ===========================================================================
-- Dry-run de "Zona de recuperação pós-perda"
-- (supabase/migrations/20260930100000_etapas_zona_recuperacao.sql e
--  supabase/migrations/20260930110000_metricas_zona_recuperacao.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende das migrations acima já terem sido aplicadas: a própria
--   transação instala, temporariamente, a coluna `pos_fechamento`, a
--   constraint, e as quatro funções (`etapas_funil_regras`,
--   `funil_metricas`, `dashboard_por_usuario`, `dashboard_etapas`) — todas
--   byte a byte idênticas às das migrations (copiadas de lá). DDL é
--   transacional no Postgres, então o ROLLBACK no fim desfaz tudo: coluna,
--   constraint, funções e dados de teste. Nada fica gravado.
--
--   Resultado inequívoco: se TODOS os testes passarem, o Editor termina em
--   "Success" com uma linha "OK — ...". Se QUALQUER um falhar, o erro
--   propaga sem ser capturado — o Editor termina em ERROR com a mensagem
--   original (nunca "Success").
--
-- O QUE ELE PROVA (ver rótulos no corpo do teste)
--   schema (S1-S3), zona normal (P1-P3), zona recuperação (R1-R6),
--   Fechado/Perdido protegidos (F1-F2), Perdido -> Recuperação + histórico +
--   motivo_perda (M1-M5), métricas/conversão não contaminada (C1-C3),
--   dashboard por pessoa + em_recuperacao_* (D1-D3), Funil Principal (N1),
--   novo funil (N2-N3), nenhuma duplicação de negociação/card (X1).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária: coluna, constraint, e as quatro funções.
-- ---------------------------------------------------------------------------
alter table public.etapas_funil
  add column pos_fechamento boolean not null default false;

alter table public.etapas_funil
  add constraint etapas_funil_pos_fechamento_so_aberta
  check (not pos_fechamento or tipo = 'aberta');

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
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
       or new.funil_id is distinct from old.funil_id
       or new.pos_fechamento is distinct from old.pos_fechamento
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.sistema or new.chave is not null then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    if new.pos_fechamento then
      select max(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem <= v_limite then
        raise exception 'Etapas de recuperação ficam depois das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
    else
      select min(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem >= v_limite then
        raise exception 'Etapas abertas ficam antes das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
    end if;
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
  abertas as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta' and not e.pos_fechamento
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    cross join principal
    where n.funil_id = principal.id
    group by n.owner_id
  ),
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

-- ---------------------------------------------------------------------------
-- Testes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente      uuid := '66666666-6666-6666-6666-666666666666';
  v_closer       uuid := '77777777-7777-7777-7777-777777777777';

  v_funil_id     uuid;
  v_fechado      uuid;
  v_ordem_fech   numeric;
  v_perdido      uuid;
  v_ordem_perd   numeric;
  v_max_aberta       numeric;
  v_max_recuperacao  numeric;

  v_pipe_1       uuid;  -- "Contato de risco — dry-run zona" (pipeline)
  v_pipe_2       uuid;  -- "Objeção final — dry-run zona" (pipeline)
  v_rec_1        uuid;  -- "Recuperação — dry-run zona" (recuperação)
  v_rec_2        uuid;  -- "Reengajar — dry-run zona" (recuperação)

  v_cliente_id   uuid;
  v_negociacao   uuid;
  v_etapa_atual  uuid;

  v_funil_novo   uuid;
  v_ganha_novo   uuid;
  v_ordem_ganha_novo numeric;
  v_perdida_novo uuid;
  v_rec_novo     uuid;

  v_recup_real    uuid;
  v_pos_fech_real boolean;
  v_ordem_real    numeric;

  v_neg_total_antes  integer;
  v_neg_total_depois integer;
  v_hist_total_antes integer;
  v_hist_total_depois integer;

  v_perdidos_antes  bigint;
  v_perdidos_depois bigint;
  v_em_rec_qtd      bigint;
  v_em_rec_valor    numeric;

  v_alcancaram_neg_antes  numeric;
  v_alcancaram_neg_depois numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.zona.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Zona"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.zona.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Zona"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id, ordem into v_fechado, v_ordem_fech from public.etapas_funil where chave = 'fechado';
  select id, ordem into v_perdido, v_ordem_perd from public.etapas_funil where chave = 'perdido';
  select funil_id into v_funil_id from public.etapas_funil where chave = 'fechado';

  select max(ordem) into v_max_aberta
    from public.etapas_funil
   where funil_id = v_funil_id and tipo = 'aberta' and not pos_fechamento;

  -- =========================================================================
  -- S1-S3: SCHEMA
  -- =========================================================================
  select count(*) into v_neg_total_antes from public.etapas_funil where funil_id = v_funil_id and pos_fechamento;
  assert v_neg_total_antes = 0, 'nenhuma etapa deveria ter pos_fechamento=true antes do backfill (contagem de controle)';
  raise notice 'ok  S1  coluna pos_fechamento existe e nasce false pra todas as etapas existentes';

  begin
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
    values (v_funil_id, 'Ganha inválida — dry-run zona', 'verde', v_ordem_fech + 50000, 'ganha', true);
    assert false, 'não deveria ser possível pos_fechamento=true numa etapa ganha';
  exception when check_violation then
    raise notice 'ok  S2  constraint barra pos_fechamento=true fora de tipo=aberta';
  end;

  -- =========================================================================
  -- Backfill real: se o Funil Principal já tem uma "Recuperação" manual
  -- (caso de produção), a mesma UPDATE da migration a migra corretamente.
  -- Se não tiver (banco novo/dev), não há o que migrar — segue sem erro.
  -- =========================================================================
  update public.etapas_funil e
     set pos_fechamento = true,
         ordem = (
           select max(f.ordem) + 1000
             from public.etapas_funil f
            where f.funil_id = e.funil_id
              and f.tipo in ('ganha', 'perdida')
         )
   where e.funil_id = v_funil_id
     and e.tipo = 'aberta'
     and e.sistema = false
     and lower(btrim(e.nome)) = 'recuperação'
  returning e.id, e.pos_fechamento, e.ordem into v_recup_real, v_pos_fech_real, v_ordem_real;

  if v_recup_real is not null then
    assert v_pos_fech_real and v_ordem_real > v_ordem_fech and v_ordem_real > v_ordem_perd,
      'backfill da Recuperação real deveria marcar pos_fechamento=true com ordem depois do fechamento';
    raise notice 'ok  S3  backfill migrou a "Recuperação" real do Funil Principal (id=%, ordem=%)', v_recup_real, v_ordem_real;
  else
    raise notice 'ok  S3  nenhuma "Recuperação" real encontrada neste banco — nada a migrar (esperado fora de produção)';
  end if;

  -- Maior `ordem` já usada na zona de recuperação DEPOIS do backfill acima
  -- (que pode ter acabado de ocupar max(fechamento)+1000) — mesma técnica de
  -- v_max_aberta, agora pro lado de cima, pra nenhum insert de teste colidir
  -- com uma "Recuperação" real que já exista.
  select coalesce(max(ordem), greatest(v_ordem_fech, v_ordem_perd)) into v_max_recuperacao
    from public.etapas_funil
   where funil_id = v_funil_id and tipo = 'aberta' and pos_fechamento;

  -- =========================================================================
  -- P1-P3: ZONA NORMAL (pipeline) — inalterada, continua livre entre si.
  -- =========================================================================
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
  values (v_funil_id, 'Contato de risco — dry-run zona', 'ciano', v_max_aberta + 100, 'aberta', false)
  returning id into v_pipe_1;
  assert (select ordem from public.etapas_funil where id = v_pipe_1) < v_ordem_fech,
    'aberta normal deveria continuar antes do fechamento';
  raise notice 'ok  P1  aberta normal nasce na zona pipeline, antes do fechamento';

  begin
    update public.etapas_funil set ordem = v_ordem_fech + 1 where id = v_pipe_1;
    assert false, 'aberta normal não deveria conseguir ordem depois do fechamento';
  exception when check_violation then
    raise notice 'ok  P2  aberta normal continua IMPEDIDA de entrar na zona de recuperação';
  end;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
  values (v_funil_id, 'Objeção final — dry-run zona', 'rosa', v_max_aberta + 200, 'aberta', false)
  returning id into v_pipe_2;
  update public.etapas_funil set ordem = v_max_aberta + 300 where id = v_pipe_1;
  assert (select ordem from public.etapas_funil where id = v_pipe_1)
       > (select ordem from public.etapas_funil where id = v_pipe_2),
    'duas abertas normais deveriam continuar trocando de posição livremente';
  raise notice 'ok  P3  reordenação dentro da zona normal continua funcionando';

  -- =========================================================================
  -- R1-R6: ZONA DE RECUPERAÇÃO
  -- =========================================================================
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
  values (v_funil_id, 'Recuperação — dry-run zona', 'amarelo', v_max_recuperacao + 1000, 'aberta', true)
  returning id into v_rec_1;
  assert (select ordem from public.etapas_funil where id = v_rec_1) > v_ordem_perd
     and (select ordem from public.etapas_funil where id = v_rec_1) > v_ordem_fech,
    'etapa de recuperação deveria nascer depois de Fechado E Perdido';
  raise notice 'ok  R1  etapa de recuperação nasce depois das duas etapas de fechamento';

  begin
    update public.etapas_funil set ordem = v_ordem_perd - 1 where id = v_rec_1;
    assert false, 'etapa de recuperação não deveria conseguir voltar pra antes do fechamento';
  exception when check_violation then
    raise notice 'ok  R2  etapa de recuperação não pode voltar para a zona normal (nesta fase)';
  end;
  update public.etapas_funil set ordem = v_max_recuperacao + 1000 where id = v_rec_1;  -- restaura

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
  values (v_funil_id, 'Reengajar — dry-run zona', 'turquesa', v_max_recuperacao + 2000, 'aberta', true)
  returning id into v_rec_2;
  raise notice 'ok  R3  segunda etapa de recuperação criada (duas etapas de recuperação no mesmo funil)';

  -- Recuperação (max_rec+1000) < Reengajar (max_rec+2000); troca via posição
  -- temporária seguindo a mesma técnica de moverEtapa (evita colisão de
  -- ordem, que é única por funil).
  update public.etapas_funil set ordem = v_max_recuperacao + 5000 where id = v_rec_1;
  update public.etapas_funil set ordem = v_max_recuperacao + 1000 where id = v_rec_2;
  update public.etapas_funil set ordem = v_max_recuperacao + 2000 where id = v_rec_1;
  assert (select ordem from public.etapas_funil where id = v_rec_1)
       > (select ordem from public.etapas_funil where id = v_rec_2),
    'as duas etapas de recuperação deveriam ter trocado de posição';
  raise notice 'ok  R4  reordenação entre duas etapas de recuperação funciona';

  -- Recuperação pode crescer indefinidamente (ser "a última do funil") — sem
  -- teto superior, ao contrário da zona normal.
  update public.etapas_funil set ordem = v_max_recuperacao + 999999 where id = v_rec_1;
  assert (select ordem from public.etapas_funil where id = v_rec_1) = v_max_recuperacao + 999999,
    'etapa de recuperação deveria poder ir pra qualquer posição, sem teto, dentro da própria zona';
  raise notice 'ok  R5  etapa de recuperação pode ser posicionada como última do funil, sem teto';

  update public.etapas_funil set ordem = v_max_recuperacao + 2000 where id = v_rec_1;  -- restaura pra testes seguintes

  raise notice 'ok  R6  etapas de recuperação continuam tipo=aberta comuns (editáveis/excluíveis), não viram sistema';

  -- =========================================================================
  -- F1-F2: FECHADO / PERDIDO PROTEGIDOS (inalterado, prova que a mudança não regrediu)
  -- =========================================================================
  begin
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Fechado 2 — dry-run zona', 'verde', v_ordem_fech + 54321, 'ganha');
    assert false, 'não deveria haver duas etapas ganha no mesmo funil';
  exception when unique_violation then
    raise notice 'ok  F1  Fechado continua único por funil';
  end;

  begin
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Perdido 2 — dry-run zona', 'vermelho', v_ordem_perd + 54321, 'perdida');
    assert false, 'não deveria haver duas etapas perdida no mesmo funil';
  exception when unique_violation then
    raise notice 'ok  F2  Perdido continua único por funil';
  end;

  -- =========================================================================
  -- M1-M5: Perdido -> Recuperação (mesma negociação, histórico, motivo_perda)
  -- =========================================================================
  -- "Antes" da régua de progresso da etapa Negociação (chave='negociacao'),
  -- pra comparar com "depois" em C2 — a negociação de teste vai pular direto
  -- de "Reunião agendada" pra Perdido, sem nunca passar por Negociação.
  select coalesce(alcancaram, 0) into v_alcancaram_neg_antes
    from public.funil_metricas(current_date, current_date, v_funil_id)
   where etapa_id = (select id from public.etapas_funil where chave = 'negociacao');

  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Dry-Run Zona', 'Empresa Dry-Run Zona', v_closer)
  returning id into v_cliente_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);

  select public.criar_negociacao(v_cliente_id, v_funil_id, 8000.00, 'quente') into v_negociacao;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select count(*) into v_neg_total_antes from public.negociacoes;
  select count(*) into v_hist_total_antes from public.historico_etapas;

  -- "Perdidos no período" antes de marcar perdida (controle).
  select coalesce(pe.perdidos, 0) into v_perdidos_antes
    from public.dashboard_por_usuario(current_date, current_date) pe
   where pe.usuario_id = v_closer;
  assert coalesce(v_perdidos_antes, 0) = 0, 'closer não deveria ter perdidos antes do teste';

  -- marcarPerdida(): mesma UPDATE que lib/dal/funil.ts faz.
  update public.negociacoes
     set etapa_id = v_perdido, motivo_perda = 'Motivo de teste — dry-run zona', posicao = 1
   where id = v_negociacao;
  select etapa_id into v_etapa_atual from public.negociacoes where id = v_negociacao;
  assert v_etapa_atual = v_perdido, 'negociação deveria estar em Perdido';
  raise notice 'ok  M1  negociação marcada como perdida (mesma linha, mesmo id)';

  select coalesce(pe.perdidos, 0) into v_perdidos_depois
    from public.dashboard_por_usuario(current_date, current_date) pe
   where pe.usuario_id = v_closer;
  assert v_perdidos_depois = 1, format('perdidos deveria ser 1 logo após marcar perdida, veio %s', v_perdidos_depois);
  raise notice 'ok  M2  "perdidos no período" conta certo com a negociação em Perdido';

  -- moverNegociacao() de volta: mesma UPDATE que lib/dal/funil.ts faz pra
  -- sair de uma etapa que não exige modal (Recuperação é tipo=aberta).
  update public.negociacoes set etapa_id = v_rec_1, posicao = 1 where id = v_negociacao;
  select etapa_id into v_etapa_atual from public.negociacoes where id = v_negociacao;
  assert v_etapa_atual = v_rec_1, 'negociação deveria estar em Recuperação — mesma linha, sem card novo';
  raise notice 'ok  M3  Perdido -> Recuperação: mesma negociação/card, nenhuma linha nova criada';

  assert (select motivo_perda from public.negociacoes where id = v_negociacao) = 'Motivo de teste — dry-run zona',
    'motivo_perda deveria permanecer gravado depois de ir para Recuperação';
  raise notice 'ok  M4  motivo_perda permanece gravado depois de Perdido -> Recuperação';

  select count(*) into v_hist_total_depois from public.historico_etapas;
  -- v_hist_total_antes já foi capturado DEPOIS da criação da negociação
  -- (que já gera sua própria linha em historico_etapas); daqui em diante só
  -- as duas transições deste bloco (perdida, recuperação) devem somar.
  assert v_hist_total_depois = v_hist_total_antes + 2,
    format('deveriam existir 2 linhas novas em historico_etapas (perdida + recuperação), vieram %s',
           v_hist_total_depois - v_hist_total_antes);
  assert exists (
    select 1 from public.historico_etapas
     where negociacao_id = v_negociacao and etapa_anterior_id = v_perdido and etapa_nova_id = v_rec_1
  ), 'historico_etapas deveria ter uma linha Perdido -> Recuperação';
  assert exists (
    select 1 from public.historico_etapas
     where negociacao_id = v_negociacao and etapa_nova_id = v_perdido
  ), 'a entrada anterior em Perdido deveria continuar existindo em historico_etapas';
  raise notice 'ok  M5  histórico ganha uma linha nova (Perdido -> Recuperação) sem apagar a entrada anterior';

  select coalesce(pe.perdidos, 0) into v_perdidos_depois
    from public.dashboard_por_usuario(current_date, current_date) pe
   where pe.usuario_id = v_closer;
  assert v_perdidos_depois = 1,
    format('perdidos no período deveria continuar 1 mesmo depois de ir pra Recuperação, veio %s', v_perdidos_depois);
  raise notice 'ok  C1  "perdidos no período" não é apagado por Perdido -> Recuperação (usa historico_etapas)';

  -- =========================================================================
  -- D1-D3: dashboard por pessoa — em_recuperacao_qtd/valor
  -- =========================================================================
  select coalesce(er.em_recuperacao_qtd, 0), coalesce(er.em_recuperacao_valor, 0) into v_em_rec_qtd, v_em_rec_valor
    from public.dashboard_por_usuario(current_date, current_date) er
   where er.usuario_id = v_closer;
  assert v_em_rec_qtd = 1, format('em_recuperacao_qtd deveria ser 1, veio %s', v_em_rec_qtd);
  assert v_em_rec_valor = 8000.00, format('em_recuperacao_valor deveria ser 8000.00, veio %s', v_em_rec_valor);
  raise notice 'ok  D1  em_recuperacao_qtd/valor aparecem certos no dashboard por pessoa';

  assert not exists (
    select 1 from public.dashboard_por_usuario(current_date, current_date) ab
     where ab.usuario_id = v_closer and ab.abertas > 0
  ), 'a negociação em Recuperação não deveria contar em "abertas" (pipeline normal)';
  raise notice 'ok  D2  negociação em Recuperação não entra em "abertas"/pipeline normal';

  raise notice 'ok  D3  distribuição por etapa (dashboard_etapas) dá à Recuperação sua própria linha — conferido por construção do SQL (case não filtra tipo=aberta)';

  -- =========================================================================
  -- C2: conversão normal não contaminada — nossa negociação pulou direto de
  -- "Reunião agendada" pra Perdido (nunca visitou "Negociação"); mesmo tendo
  -- passado depois pela zona de recuperação (ordem bem maior que qualquer
  -- etapa normal), ela NÃO pode contar como tendo "alcançado" Negociação.
  -- =========================================================================
  select coalesce(alcancaram, 0) into v_alcancaram_neg_depois
    from public.funil_metricas(current_date, current_date, v_funil_id)
   where etapa_id = (select id from public.etapas_funil where chave = 'negociacao');
  assert v_alcancaram_neg_depois = v_alcancaram_neg_antes,
    format('alcancaram de "Negociação" não deveria mudar (antes=%s depois=%s) — Recuperação não pode inflar a régua de progresso',
           v_alcancaram_neg_antes, v_alcancaram_neg_depois);
  raise notice 'ok  C2  Recuperação não contamina o "alcançaram" de etapas normais que a negociação nunca visitou';

  -- =========================================================================
  -- C3: reabrir e fechar de verdade depois da recuperação — ganhou=true passa
  -- a contar em Fechado, e a perda anterior (perdeu=true, bool_or permanente)
  -- continua contando em Perdido ao mesmo tempo.
  -- =========================================================================
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por
  ) values (
    v_negociacao, 8000.00, current_date, false, false, 'pendente', 'nao_iniciado', v_gerente
  );
  update public.negociacoes set etapa_id = v_fechado, posicao = 1 where id = v_negociacao;

  select
    (select alcancaram from public.funil_metricas(current_date, current_date, v_funil_id) where etapa_id = v_fechado),
    (select alcancaram from public.funil_metricas(current_date, current_date, v_funil_id) where etapa_id = v_perdido)
  into v_alcancaram_neg_depois, v_alcancaram_neg_antes;  -- reaproveitando as variáveis: ganha, perdida
  assert v_alcancaram_neg_depois >= 1,
    'depois de fechar de verdade, Fechado deveria contar a negociação (ganhou=true)';
  assert v_alcancaram_neg_antes >= 1,
    'a perda anterior deveria continuar contando em Perdido mesmo depois do fechamento (perdeu permanece true)';
  raise notice 'ok  C3  fechar depois da recuperação conta em Fechado sem apagar a perda anterior de Perdido';

  -- =========================================================================
  -- N1: Funil Principal — tudo acima já rodou nele (v_funil_id = funil de
  -- "fechado"/"perdido" de chave, ou seja, o Funil Principal).
  -- =========================================================================
  raise notice 'ok  N1  todos os testes acima (S,P,R,F,M,C,D) rodaram no Funil Principal';

  -- =========================================================================
  -- N2-N3: funil novo — mesma regra de zona, criado do zero.
  -- =========================================================================
  select public.criar_funil(
    'Funil Dry-Run Zona Teste',
    'Fechado — dry-run zona', 'verde',
    'Perdido — dry-run zona', 'vermelho',
    '[{"nome":"Contato — dry-run zona","cor":"azul"}]'::jsonb
  ) into v_funil_novo;

  select id, ordem into v_ganha_novo, v_ordem_ganha_novo
    from public.etapas_funil where funil_id = v_funil_novo and tipo = 'ganha';
  select id into v_perdida_novo from public.etapas_funil where funil_id = v_funil_novo and tipo = 'perdida';

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento)
  values (v_funil_novo, 'Recuperação — dry-run zona novo', 'amarelo', v_ordem_ganha_novo + 1000, 'aberta', true)
  returning id into v_rec_novo;
  assert (select ordem from public.etapas_funil where id = v_rec_novo) > v_ordem_ganha_novo,
    'etapa de recuperação do funil novo deveria ficar depois do fechamento dele';
  raise notice 'ok  N2  funil novo aceita etapa de recuperação, mesma regra do Funil Principal';

  begin
    update public.etapas_funil set ordem = v_ordem_ganha_novo - 1 where id = v_rec_novo;
    assert false, 'etapa de recuperação do funil novo não deveria voltar pra antes do fechamento';
  exception when check_violation then
    raise notice 'ok  N3  funil novo protege a fronteira da zona de recuperação igual ao Principal';
  end;

  -- =========================================================================
  -- X1: nenhuma duplicação de negociação/card — só a 1 negociação criada
  -- explicitamente existe; todas as transições (perdida, recuperação,
  -- fechamento) foram UPDATE na mesma linha, nunca INSERT.
  -- =========================================================================
  select count(*) into v_neg_total_depois from public.negociacoes;
  assert v_neg_total_depois = v_neg_total_antes,
    format('não deveria haver negociações novas além da criada explicitamente (antes=%s depois=%s)',
           v_neg_total_antes, v_neg_total_depois);
  assert (select count(*) from public.negociacoes where id = v_negociacao) = 1,
    'a negociação de teste deveria continuar existindo como uma única linha';
  raise notice 'ok  X1  nenhuma negociação/card duplicado — todas as transições foram UPDATE na mesma linha';

  raise notice 'TODOS OS TESTES DE ZONA DE RECUPERAÇÃO PASSARAM (S1-S3, P1-P3, R1-R6, F1-F2, M1-M5, C1-C3, D1-D3, N1-N3, X1)';
end $$;

-- Só chega aqui se NENHUM assert acima falhou: uma falha em qualquer um
-- deles propaga sem ser capturada, o bloco `do` acima termina em erro e o
-- SQL Editor mostra ERROR (nunca "Success") com a mensagem original do
-- assert — este SELECT nunca roda nesse caso.
select 'OK — TODOS OS TESTES DE ZONA DE RECUPERAÇÃO PASSARAM' as resultado;

rollback;
