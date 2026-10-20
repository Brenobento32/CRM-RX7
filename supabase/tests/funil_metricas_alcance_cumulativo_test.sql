-- ===========================================================================
-- Teste do ALCANCE CUMULATIVO de `public.funil_metricas` (migration
-- supabase/migrations/20261020140000_funil_metricas_alcance_cumulativo.sql
-- — ainda NÃO aplicada em produção).
--
-- AUTO-INSTALAÇÃO TRANSACIONAL (mesmo padrão de funil_metricas_test.sql):
--   BEGIN
--     -> instala a NOVA versão de public.funil_metricas E a nova coluna
--        etapas_funil.participa_conversao (DDL EXATAMENTE copiado, sem
--        nenhuma diferença, de
--        supabase/migrations/20261020140000_funil_metricas_alcance_cumulativo.sql
--        — se um dos dois arquivos mudar, atualize o outro)
--     -> cria os fixtures de teste (dois funis)
--     -> roda os asserts contra a função recém-instalada
--   ROLLBACK
--     -> DDL é transacional no Postgres: desfaz a coluna nova, a constraint
--        nova e o DROP+CREATE da função, junto com os dados — tudo volta a
--        ser exatamente como estava, como se nada tivesse acontecido.
--
-- COMO RODAR: cole este arquivo inteiro no SQL Editor do Supabase e execute.
--   Mesmo cuidado de concorrência do funil_metricas_test.sql (lock breve em
--   DROP FUNCTION/ALTER TABLE durante a transação aberta).
--
-- O QUE ELE PROVA (cenários A-K da especificação aprovada)
--   A) caminho normal: Lead Novo -> MQL -> Reunião agendada — conta nas três.
--   B) salto: Lead Novo -> Reunião agendada (pula MQL) — MQL conta mesmo
--      assim (o BUG que motivou esta migration).
--   C) salto direto pra Fechado, fechamento VÁLIDO — conta em TODAS as
--      principais até Fechado, inclusive Fechado.
--   D) salto direto pra Fechado, fechamento ANULADO — conta em todas as
--      principais ANTERIORES a Fechado; Fechado em si não conta.
--   E) No Show — conta até Reunião agendada; No Show só lateral.
--   F) No Show seguido de avanço — conta até Reunião realizada; No Show não
--      interfere no denominador.
--   G) Perdido — conta até Reunião agendada; Perdido só lateral.
--   H) Recuperação — conta até Proposta; Recuperação só lateral.
--   I) retrocesso (Proposta -> volta pra Negociação) — continua contando
--      Proposta como alcançada.
--   J) múltiplas entradas na mesma etapa — conta uma única vez
--      (count(distinct), entidade única).
--   K) dois funis — números nunca se misturam (funil2 isolado).
--
--   Também confirma: participa_conversao=false não aumenta a maior ordem
--   alcançada; a constraint "ganha sempre participa" existe; e Perdido/
--   Recuperação continuam com o `alcancaram` BRUTO (não cumulativo) de
--   sempre, inalterado.
--
-- FUNIL 3 — cenários de COORTE/data (rodada "ajuste definitivo dos dados
-- do funil por coorte/período"), isolado do funil 1 de propósito:
--   lead antigo (nov/2023) nunca entra na coorte de janeiro/2024 (nem em
--     total_entraram, nem em atuais/oportunidades/pipelineValor/parados,
--     nem em alcancaram) — continua existindo normalmente;
--   limite de início (>= início) e de fim (< fim + 1 dia) inclusivos,
--     testados no segundo exato da borda dos dois lados;
--   ganho registrado DEPOIS do fim do período conta no alcance da coorte
--     (nunca por data_fechamento), mas NÃO na métrica financeira por data
--     (ganhos_periodo/quantidade — essa continua por data_fechamento, de
--     propósito, pras telas de faturamento);
--   perda registrada DEPOIS do fim do período conta como Perdido da coorte
--     (perdidos_periodo agora é por coorte, não mais por data do evento);
--   desqualificado (arquivada_em) DEPOIS do fim do período aparece no novo
--     total `desqualificados`, independente de quando aconteceu, e some de
--     atuais/oportunidades/pipelineValor da etapa onde estava.
-- ===========================================================================

begin;

-- ===========================================================================
-- Migration 20261020140000 JÁ APLICADA de verdade (coluna, backfill e as
-- três constraints já existem em produção) — esta instalação não recria
-- mais isso (um ADD COLUMN/ADD CONSTRAINT duplicado falharia, 42701/42710).
-- Recria só as FUNÇÕES/TRIGGER (CREATE OR REPLACE é idempotente: reinstala
-- byte a byte o mesmo corpo já ao vivo), pra provar o corpo exato contra o
-- schema real.
-- ===========================================================================

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
       or new.participa_conversao is distinct from old.participa_conversao
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
  participa_conversao     boolean,
  quantidade              bigint,
  valor                   numeric,
  alcancaram              bigint,
  tempo_medio_segundos    numeric,
  permanencias            bigint,
  parados_medio_segundos  numeric,
  parados_7_dias          bigint,
  total_entraram          bigint,
  desqualificados         bigint
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

  historico_base as (
    select n.*
    from public.negociacoes n
    where n.funil_id = p_funil_id
  ),

  coorte as (
    select n.id
    from historico_base n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),

  total_entraram as (
    select count(*) as total from coorte
  ),

  atuais_base as (
    select n.*
    from historico_base n
    join coorte co on co.id = n.id
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.arquivada_em is null
      and n.excluida_em is null
  ),

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

  desqualificados_coorte as (
    select count(*) as total
    from historico_base n
    join coorte co on co.id = n.id
    where n.arquivada_em is not null
      and n.excluida_em is null
  ),

  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),

  etapas_principais as (
    select e.id, e.ordem, e.tipo
    from public.etapas_funil e
    where e.funil_id = p_funil_id
      and e.ativo
      and e.tipo <> 'perdida'
      and not e.pos_fechamento
      and e.participa_conversao
  ),

  alcance_fisico_principal as (
    select distinct h.negociacao_id, ep.ordem
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join etapas_principais ep on ep.id = h.etapa_nova_id
  ),

  maior_ordem_fisica as (
    select negociacao_id, max(ordem) as ordem
    from alcance_fisico_principal
    group by negociacao_id
  ),

  alcance_cumulativo as (
    select ep.id as etapa_id, count(distinct m.negociacao_id) as qtd
    from etapas_principais ep
    join maior_ordem_fisica m on m.ordem >= ep.ordem
    where ep.tipo <> 'ganha'
    group by ep.id
  ),

  alcance_ganha as (
    select ep.id as etapa_id, count(distinct m.negociacao_id) as qtd
    from etapas_principais ep
    join maior_ordem_fisica m on m.ordem >= ep.ordem
    join public.fechamentos f on f.negociacao_id = m.negociacao_id and f.anulado_em is null
    where ep.tipo = 'ganha'
    group by ep.id
  ),

  ganhos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'ganha') as etapa_id,
      count(*) as qtd,
      sum(f.valor_vendido) as valor
    from public.fechamentos f
    join historico_base n on n.id = f.negociacao_id
    where f.data_fechamento between p_inicio and p_fim
      and f.anulado_em is null
  ),

  negociacoes_perdidas_coorte as (
    select distinct h.negociacao_id
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id and e.tipo = 'perdida'
  ),
  perdidos_periodo as (
    select
      (select e.id from public.etapas_funil e
        where e.funil_id = p_funil_id and e.tipo = 'perdida') as etapa_id,
      count(*) as qtd,
      sum(n.valor_estimado) as valor
    from negociacoes_perdidas_coorte p
    join historico_base n on n.id = p.negociacao_id
  ),

  estadias as (
    select
      h.etapa_nova_id as etapa_id,
      h.created_at as entrada,
      lead(h.created_at) over (
        partition by h.negociacao_id order by h.created_at, h.id
      ) as saida
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join historico_base n on n.id = h.negociacao_id
  ),
  tempos as (
    select
      s.etapa_id,
      avg(extract(epoch from s.saida - s.entrada)) as media,
      count(*) as n
    from estadias s
    where s.saida is not null
    group by s.etapa_id
  )

  select
    e.id,
    e.nome,
    e.cor,
    e.tipo,
    e.ordem,
    e.pos_fechamento,
    e.participa_conversao,
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
    case
      when e.tipo = 'ganha'
        then coalesce(ag.qtd, 0)
      when e.tipo <> 'perdida' and not e.pos_fechamento and e.participa_conversao
        then coalesce(ac.qtd, 0)
      else coalesce(al.qtd, 0)
    end,
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0),
    (select total from total_entraram),
    (select total from desqualificados_coorte)
  from public.etapas_funil e
  left join atuais              a  on a.etapa_id = e.id
  left join alcancaram          al on al.etapa_id = e.id
  left join alcance_cumulativo  ac on ac.etapa_id = e.id
  left join alcance_ganha       ag on ag.etapa_id = e.id
  left join ganhos_periodo      gp on gp.etapa_id = e.id
  left join perdidos_periodo    pp on pp.etapa_id = e.id
  left join tempos              t  on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;

-- ===========================================================================
-- Fixtures + asserts.
-- ===========================================================================

do $$
declare
  v_usuario uuid := 'b2222222-2222-2222-2222-222222222222';

  v_funil1_id uuid;
  v_lead_novo   uuid; v_mql uuid; v_reuniao_agendada uuid; v_no_show uuid;
  v_reuniao_realizada uuid; v_negociacao_etapa uuid; v_proposta uuid;
  v_fechado uuid; v_perdido uuid; v_recuperacao uuid;

  v_funil2_id uuid;
  v_f2_aberta uuid; v_f2_fechado uuid;

  -- Funil 3: dedicado aos cenários de COORTE/data (lead antigo, limites,
  -- ganho/perda/desqualificado depois do período) — ISOLADO do funil 1 de
  -- propósito, pra não precisar recalcular as 10+ asserções já conferidas
  -- do funil 1 toda vez que um cliente novo entrar na mesma coorte.
  v_funil3_id uuid;
  v_f3_lead_novo uuid; v_f3_fechado uuid; v_f3_perdido uuid;

  v_cli_a uuid; v_neg_a uuid;
  v_cli_b uuid; v_neg_b uuid;
  v_cli_c uuid; v_neg_c uuid;
  v_cli_d uuid; v_neg_d uuid;
  v_cli_e uuid; v_neg_e uuid;
  v_cli_f uuid; v_neg_f uuid;
  v_cli_g uuid; v_neg_g uuid;
  v_cli_h uuid; v_neg_h uuid;
  v_cli_i uuid; v_neg_i uuid;
  v_cli_j uuid; v_neg_j uuid;
  v_cli_y uuid; v_neg_y uuid;

  -- Novos cenários (rodada "ajuste definitivo dos dados do funil por
  -- coorte/período"): lead antigo fora da coorte, limites de data, ganho/
  -- perda depois do fim do período, desqualificado.
  v_cli_old uuid; v_neg_old uuid;
  v_cli_bstart uuid; v_neg_bstart uuid;
  v_cli_bbefore uuid; v_neg_bbefore uuid;
  v_cli_bend uuid; v_neg_bend uuid;
  v_cli_ganho_depois uuid; v_neg_ganho_depois uuid;
  v_cli_perda_depois uuid; v_neg_perda_depois uuid;
  v_cli_desq uuid; v_neg_desq uuid;

  r_lead_novo bigint; r_mql bigint;
  r_desq_valor  numeric;
  v_participa   boolean;
  v_desq        bigint;
begin
  -- -------------------------------------------------------------------
  -- 0. Massa de teste: usuário, 2 funis, etapas.
  -- -------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    v_usuario, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'teste.alcance.cumulativo@teste.local', '', now(), now(), now(),
    '{}'::jsonb, '{"nome":"Closer Teste Alcance"}'::jsonb
  );

  insert into public.funis (nome, padrao) values ('Teste alcance cumulativo 1', false)
    returning id into v_funil1_id;
  insert into public.funis (nome, padrao) values ('Teste alcance cumulativo 2', false)
    returning id into v_funil2_id;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Lead Novo', 'turquesa', 500, 'aberta') returning id into v_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'MQL', 'ciano', 700, 'aberta') returning id into v_mql;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Reunião agendada', 'azul', 1000, 'aberta') returning id into v_reuniao_agendada;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'No Show', 'cinza', 1150, 'aberta') returning id into v_no_show;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Reunião realizada', 'violeta', 1300, 'aberta') returning id into v_reuniao_realizada;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Negociação', 'laranja', 1600, 'aberta') returning id into v_negociacao_etapa;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Proposta enviada', 'amarelo', 1900, 'aberta') returning id into v_proposta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil1_id, 'Fechado', 'verde', 100000, 'ganha') returning id into v_fechado;
  -- participa_conversao explícito abaixo (nunca o default true, que agora
  -- violaria etapas_funil_perdida_nao_participa_conversao/
  -- etapas_funil_pos_fechamento_nao_participa_conversao).
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao) values
    (v_funil1_id, 'Perdido', 'vermelho', 100001, 'perdida', false) returning id into v_perdido;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento, participa_conversao) values
    (v_funil1_id, 'Recuperação', 'cinza', 100002, 'aberta', true, false) returning id into v_recuperacao;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Aberta', 'azul', 1000, 'aberta') returning id into v_f2_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil2_id, 'Fechado', 'verde', 100000, 'ganha') returning id into v_f2_fechado;

  -- Backfill: "No Show" criado ACIMA (nome exato) tem que virar
  -- participa_conversao = false pelo UPDATE já rodado no topo deste bloco
  -- (que roda ANTES desta massa de dados existir — por isso confirmamos
  -- aqui, manualmente, que a etapa desta fixture específica também fica
  -- false, já que ela não existia quando aquele UPDATE de instalação rodou).
  update public.etapas_funil set participa_conversao = false where id = v_no_show;

  -- -------------------------------------------------------------------
  -- 0b. Permissão comercial do usuário de teste — mesmo padrão de
  -- funil_metricas_test.sql: acesso ao funil (etapa_id null) + pode_ver/
  -- pode_mover em CADA etapa que os cenários abaixo de fato movimentam.
  -- -------------------------------------------------------------------
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values
    (v_usuario, v_funil1_id, null, null, null, v_usuario),
    (v_usuario, v_funil2_id, null, null, null, v_usuario);

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values
    (v_usuario, v_funil1_id, v_lead_novo,          true, true, v_usuario),
    (v_usuario, v_funil1_id, v_mql,                true, true, v_usuario),
    (v_usuario, v_funil1_id, v_reuniao_agendada,    true, true, v_usuario),
    (v_usuario, v_funil1_id, v_no_show,             true, true, v_usuario),
    (v_usuario, v_funil1_id, v_reuniao_realizada,   true, true, v_usuario),
    (v_usuario, v_funil1_id, v_negociacao_etapa,    true, true, v_usuario),
    (v_usuario, v_funil1_id, v_proposta,            true, true, v_usuario),
    (v_usuario, v_funil1_id, v_fechado,             true, true, v_usuario),
    (v_usuario, v_funil1_id, v_perdido,             true, true, v_usuario),
    (v_usuario, v_funil1_id, v_recuperacao,         true, true, v_usuario),
    (v_usuario, v_funil2_id, v_f2_aberta,           true, true, v_usuario),
    (v_usuario, v_funil2_id, v_f2_fechado,          true, true, v_usuario);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);

  -- -------------------------------------------------------------------
  -- Cenário A: caminho normal — Lead Novo -> MQL -> Reunião agendada.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente A', v_usuario)
    returning id into v_cli_a;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_a, v_lead_novo) returning id into v_neg_a;
  update public.negociacoes set etapa_id = v_mql where id = v_neg_a;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_a;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_a;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_a;

  -- -------------------------------------------------------------------
  -- Cenário B: salto — Lead Novo -> Reunião agendada, PULANDO MQL. MQL tem
  -- que contar mesmo assim (o bug que motivou esta migration).
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente B', v_usuario)
    returning id into v_cli_b;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_b, v_lead_novo) returning id into v_neg_b;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_b;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_b;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_b;

  -- -------------------------------------------------------------------
  -- Cenário C: salto direto pra Fechado, fechamento VÁLIDO. Conta em TODAS
  -- as principais até Fechado, inclusive Fechado.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente C', v_usuario)
    returning id into v_cli_c;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_c, v_lead_novo) returning id into v_neg_c;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_c, 9000, '2024-01-15', true, true, 'pago', 'concluido', v_usuario, 'tcv'
  );
  update public.negociacoes set etapa_id = v_fechado where id = v_neg_c;
  execute 'set constraints all immediate'; -- força checar já "ganha exige fechamento" (deve passar)
  execute 'set constraints all deferred';
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_c;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_c;

  -- -------------------------------------------------------------------
  -- Cenário D: salto direto pra Fechado, fechamento ANULADO DEPOIS. Conta
  -- em todas as principais ANTERIORES a Fechado; Fechado em si NÃO conta.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente D', v_usuario)
    returning id into v_cli_d;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_d, v_lead_novo) returning id into v_neg_d;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_d, 5000, '2024-01-15', true, true, 'pago', 'concluido', v_usuario, 'tcv'
  );
  update public.negociacoes set etapa_id = v_fechado where id = v_neg_d;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_d;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_d;
  -- Anula DIRETO (sem passar por `anular_fechamento()`, que exige gerente —
  -- aqui é só massa de dados, não o teste da função de anulação em si, que
  -- já tem o próprio arquivo: fechamentos_anulacao_test.sql).
  update public.fechamentos set anulado_em = now(), motivo_anulacao = 'teste', anulado_por = v_usuario
    where negociacao_id = v_neg_d;

  -- -------------------------------------------------------------------
  -- Cenário E: No Show — Lead Novo -> Reunião agendada -> No Show. Conta
  -- até Reunião agendada; No Show só lateral.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente E', v_usuario)
    returning id into v_cli_e;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_e, v_lead_novo) returning id into v_neg_e;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_e;
  update public.negociacoes set etapa_id = v_no_show where id = v_neg_e;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_e;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_e;

  -- -------------------------------------------------------------------
  -- Cenário F: No Show seguido de avanço — ... -> No Show -> Reunião
  -- realizada. Conta até Reunião realizada; No Show não interfere.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente F', v_usuario)
    returning id into v_cli_f;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_f, v_lead_novo) returning id into v_neg_f;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_f;
  update public.negociacoes set etapa_id = v_no_show where id = v_neg_f;
  update public.negociacoes set etapa_id = v_reuniao_realizada where id = v_neg_f;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_f;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_f;

  -- -------------------------------------------------------------------
  -- Cenário G: Perdido — Lead Novo -> MQL -> Reunião agendada -> Perdido.
  -- Conta até Reunião agendada; Perdido só lateral.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente G', v_usuario)
    returning id into v_cli_g;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_g, v_lead_novo) returning id into v_neg_g;
  update public.negociacoes set etapa_id = v_mql where id = v_neg_g;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_g;
  update public.negociacoes set etapa_id = v_perdido, motivo_perda = 'teste' where id = v_neg_g;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_g;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_g;

  -- -------------------------------------------------------------------
  -- Cenário H: Recuperação — avança até Proposta, depois -> Recuperação.
  -- Conta todas as principais até Proposta; Recuperação só lateral.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente H', v_usuario)
    returning id into v_cli_h;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_h, v_lead_novo) returning id into v_neg_h;
  update public.negociacoes set etapa_id = v_mql where id = v_neg_h;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_h;
  update public.negociacoes set etapa_id = v_reuniao_realizada where id = v_neg_h;
  update public.negociacoes set etapa_id = v_negociacao_etapa where id = v_neg_h;
  update public.negociacoes set etapa_id = v_proposta where id = v_neg_h;
  update public.negociacoes set etapa_id = v_recuperacao where id = v_neg_h;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_h;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_h;

  -- -------------------------------------------------------------------
  -- Cenário I: retrocesso — alcança Proposta, depois volta pra Negociação.
  -- Continua contando Proposta como alcançada.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente I', v_usuario)
    returning id into v_cli_i;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_i, v_lead_novo) returning id into v_neg_i;
  update public.negociacoes set etapa_id = v_mql where id = v_neg_i;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_i;
  update public.negociacoes set etapa_id = v_reuniao_realizada where id = v_neg_i;
  update public.negociacoes set etapa_id = v_negociacao_etapa where id = v_neg_i;
  update public.negociacoes set etapa_id = v_proposta where id = v_neg_i;
  update public.negociacoes set etapa_id = v_negociacao_etapa where id = v_neg_i; -- retrocesso
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_i;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_i;

  -- -------------------------------------------------------------------
  -- Cenário J: múltiplas entradas na mesma etapa — conta uma única vez.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente J', v_usuario)
    returning id into v_cli_j;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_j, v_lead_novo) returning id into v_neg_j;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_j;
  update public.negociacoes set etapa_id = v_lead_novo where id = v_neg_j;
  update public.negociacoes set etapa_id = v_reuniao_agendada where id = v_neg_j;
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_j;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_j;

  -- -------------------------------------------------------------------
  -- Cenário K: outro funil (funil2) — Y avança Aberta -> Fechado (válido),
  -- no MESMO período. Prova que os números de um funil nunca aparecem no
  -- resultado do outro.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Y', v_usuario)
    returning id into v_cli_y;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_y, v_f2_aberta) returning id into v_neg_y;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_y, 3000, '2024-01-15', true, true, 'pago', 'concluido', v_usuario, 'tcv'
  );
  update public.negociacoes set etapa_id = v_f2_fechado where id = v_neg_y;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  update public.negociacoes set created_at = '2024-01-10' where id = v_neg_y;
  update public.historico_etapas set created_at = '2024-01-10' where negociacao_id = v_neg_y;

  -- =====================================================================
  -- Funil 3 — cenários de COORTE/data: lead antigo fora do período, limites
  -- de data (>= início, < fim + 1 dia), ganho/perda/desqualificado
  -- registrados DEPOIS do fim do período (ainda contam pra coorte).
  -- =====================================================================
  insert into public.funis (nome, padrao) values ('Teste alcance cumulativo 3 - coorte', false)
    returning id into v_funil3_id;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Lead Novo', 'turquesa', 500, 'aberta') returning id into v_f3_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil3_id, 'Fechado', 'verde', 100000, 'ganha') returning id into v_f3_fechado;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao) values
    (v_funil3_id, 'Perdido', 'vermelho', 100001, 'perdida', false) returning id into v_f3_perdido;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values (v_usuario, v_funil3_id, null, null, null, v_usuario);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  values
    (v_usuario, v_funil3_id, v_f3_lead_novo, true, true, v_usuario),
    (v_usuario, v_funil3_id, v_f3_fechado,   true, true, v_usuario),
    (v_usuario, v_funil3_id, v_f3_perdido,   true, true, v_usuario);

  -- Período consultado nas asserções de funil3: janeiro/2024 (mesmo
  -- '2024-01-01' a '2024-01-31' dos demais, por simplicidade).

  -- A/N/O/P) Lead ANTIGO, fora do período: criado em novembro/2023, aberto
  -- (nunca arquivado) em Lead Novo. Não pode entrar em total_entraram,
  -- atuais/oportunidades/pipelineValor/parados nem alcancaram ao consultar
  -- janeiro/2024 — mas continua existindo (visível no Kanban normalmente).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Antigo', v_usuario)
    returning id into v_cli_old;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_old, v_f3_lead_novo) returning id into v_neg_old;
  update public.negociacoes set created_at = '2023-11-01 12:00:00-03' where id = v_neg_old;
  update public.historico_etapas set created_at = '2023-11-01 12:00:00-03' where negociacao_id = v_neg_old;

  -- B) limite de início — criado EXATAMENTE no primeiro instante do
  -- período ('2024-01-01 00:00:00-03'): tem que ENTRAR (>= início).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Início', v_usuario)
    returning id into v_cli_bstart;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cli_bstart, v_f3_lead_novo, 1000)
    returning id into v_neg_bstart;
  update public.negociacoes set created_at = '2024-01-01 00:00:00-03' where id = v_neg_bstart;
  update public.historico_etapas set created_at = '2024-01-01 00:00:00-03' where negociacao_id = v_neg_bstart;

  -- C) um segundo ANTES do início ('2023-12-31 23:59:59-03'): NÃO pode entrar.
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Antes', v_usuario)
    returning id into v_cli_bbefore;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_bbefore, v_f3_lead_novo) returning id into v_neg_bbefore;
  update public.negociacoes set created_at = '2023-12-31 23:59:59-03' where id = v_neg_bbefore;
  update public.historico_etapas set created_at = '2023-12-31 23:59:59-03' where negociacao_id = v_neg_bbefore;

  -- D) limite de fim — criado no ÚLTIMO segundo do último dia do período
  -- ('2024-01-31 23:59:59-03'): tem que ENTRAR (< fim + 1 dia).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Fim', v_usuario)
    returning id into v_cli_bend;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cli_bend, v_f3_lead_novo, 2000)
    returning id into v_neg_bend;
  update public.negociacoes set created_at = '2024-01-31 23:59:59-03' where id = v_neg_bend;
  update public.historico_etapas set created_at = '2024-01-31 23:59:59-03' where negociacao_id = v_neg_bend;

  -- G) ganho DEPOIS do fim do período: criado dentro da coorte (15/jan),
  -- salta direto pra Fechado com fechamento VÁLIDO, mas `data_fechamento`
  -- em março (depois do fim do período). Tem que contar como alcance de
  -- Fechado (coorte + fechamento válido, nunca por data_fechamento) — mas
  -- NÃO entra em `ganhos_periodo` (financeiro, por data, fora de propósito).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Ganho Depois', v_usuario)
    returning id into v_cli_ganho_depois;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_ganho_depois, v_f3_lead_novo)
    returning id into v_neg_ganho_depois;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_ganho_depois, 7000, '2024-03-01', true, true, 'pago', 'concluido', v_usuario, 'tcv'
  );
  update public.negociacoes set etapa_id = v_f3_fechado where id = v_neg_ganho_depois;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  update public.negociacoes set created_at = '2024-01-15' where id = v_neg_ganho_depois;
  update public.historico_etapas set created_at = '2024-01-15' where negociacao_id = v_neg_ganho_depois;

  -- I) perda DEPOIS do fim do período: criado dentro da coorte (15/jan),
  -- o EVENTO de perda (historico_etapas) acontece em março. Tem que contar
  -- como Perdido da coorte mesmo assim (coorte evolui até o momento).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Perda Depois', v_usuario)
    returning id into v_cli_perda_depois;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cli_perda_depois, v_f3_lead_novo)
    returning id into v_neg_perda_depois;
  update public.negociacoes set etapa_id = v_f3_perdido, motivo_perda = 'teste: perda depois do período'
    where id = v_neg_perda_depois;
  update public.negociacoes set created_at = '2024-01-15' where id = v_neg_perda_depois;
  update public.historico_etapas set created_at = '2024-01-15'
    where negociacao_id = v_neg_perda_depois and etapa_nova_id = v_f3_lead_novo;
  update public.historico_etapas set created_at = '2024-03-01'
    where negociacao_id = v_neg_perda_depois and etapa_nova_id = v_f3_perdido;

  -- J) desqualificado DEPOIS do fim do período: criado dentro da coorte
  -- (15/jan), aberto em Lead Novo, desqualificado (arquivada_em) em março.
  -- Tem que aparecer em `desqualificados` e sair de atuais/oportunidades/
  -- pipelineValor/parados da etapa onde estava.
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Desqualificado', v_usuario)
    returning id into v_cli_desq;
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cli_desq, v_f3_lead_novo, 4000)
    returning id into v_neg_desq;
  update public.negociacoes set created_at = '2024-01-15' where id = v_neg_desq;
  update public.historico_etapas set created_at = '2024-01-15' where negociacao_id = v_neg_desq;
  update public.negociacoes
     set arquivada_em = '2024-03-01', motivo_arquivamento = 'teste: desqualificado depois do período'
   where id = v_neg_desq;

  -- =====================================================================
  -- ASSERÇÕES — funil 1, período janeiro/2024. Coorte: A..J = 10.
  -- =====================================================================

  -- participa_conversao: No Show false, demais abertas true, ganha sempre true.
  select participa_conversao into v_participa from public.etapas_funil where id = v_no_show;
  assert v_participa is false, 'No Show deveria ter participa_conversao = false após o backfill';
  select participa_conversao into v_participa from public.etapas_funil where id = v_lead_novo;
  assert v_participa is true, 'Lead Novo deveria ter participa_conversao = true (padrão)';
  select participa_conversao into v_participa from public.etapas_funil where id = v_fechado;
  assert v_participa is true, 'Fechado (ganha) tem que ter participa_conversao = true sempre';

  -- Constraint: não deixa marcar 'ganha' como fora da conversão.
  begin
    update public.etapas_funil set participa_conversao = false where id = v_fechado;
    assert false, 'deveria ter sido bloqueado pela constraint etapas_funil_ganha_participa_conversao';
  exception when check_violation then
    null; -- esperado
  end;

  -- A) caminho normal + B) salto: MQL tem que contar as DUAS (prova do bug
  -- corrigido — B nunca teve historico_etapas em MQL).
  select e.alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) e where e.nome = 'MQL';
  assert r_mql = 10, format('alcancaram(MQL) deveria ser 10 (A..J, todo mundo chegou pelo menos em Reunião agendada), veio %s', r_mql);

  select e.alcancaram into r_lead_novo from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) e where e.nome = 'Lead Novo';
  assert r_lead_novo = 10, format('alcancaram(Lead Novo) deveria ser 10, veio %s', r_lead_novo);

  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Reunião agendada';
  assert r_mql = 10, format('alcancaram(Reunião agendada) deveria ser 10 (todos chegaram lá ou além), veio %s', r_mql);

  -- C/D/F/H/I chegaram em Reunião realizada (5); A/B/E/G/J não.
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Reunião realizada';
  assert r_mql = 5, format('alcancaram(Reunião realizada) deveria ser 5 (C,D,F,H,I), veio %s', r_mql);

  -- C/D/H/I chegaram em Negociação e Proposta (4 cada).
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Negociação';
  assert r_mql = 4, format('alcancaram(Negociação) deveria ser 4 (C,D,H,I), veio %s', r_mql);

  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Proposta enviada';
  assert r_mql = 4, format('alcancaram(Proposta enviada) deveria ser 4 (C,D,H,I) — I conta mesmo após o retrocesso, veio %s', r_mql);

  -- Fechado: só C (fechamento válido). D chegou fisicamente mas o
  -- fechamento foi anulado — NÃO conta como Fechado, mas D já contou em
  -- todas as etapas principais anteriores (provado acima).
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Fechado';
  assert r_mql = 1, format('alcancaram(Fechado) deveria ser 1 (só C — D tem fechamento anulado), veio %s', r_mql);

  -- No Show: lateral, alcance BRUTO (não cumulativo) — E e F passaram por lá.
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'No Show';
  assert r_mql = 2, format('alcancaram(No Show) deveria ser 2 (E, F — bruto, não cumulativo), veio %s', r_mql);

  -- Perdido: lateral — só G.
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Perdido';
  assert r_mql = 1, format('alcancaram(Perdido) deveria ser 1 (G), veio %s', r_mql);

  -- Recuperação: lateral — só H.
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Recuperação';
  assert r_mql = 1, format('alcancaram(Recuperação) deveria ser 1 (H), veio %s', r_mql);

  -- total_entraram do funil1 = 10 (A..J) — nunca contaminado por Y (funil2).
  select total_entraram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id) where nome = 'Lead Novo';
  assert r_mql = 10, format('total_entraram do funil1 deveria ser 10, veio %s', r_mql);

  -- =====================================================================
  -- K) Dois funis nunca se misturam.
  -- =====================================================================
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil2_id) where nome = 'Aberta';
  assert r_mql = 1, format('alcancaram(Aberta) do funil2 deveria ser 1 (Y), veio %s', r_mql);
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil2_id) where nome = 'Fechado';
  assert r_mql = 1, format('alcancaram(Fechado) do funil2 deveria ser 1 (Y, fechamento válido), veio %s', r_mql);
  select total_entraram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil2_id) where nome = 'Aberta';
  assert r_mql = 1, format('total_entraram do funil2 deveria ser 1 (só Y), veio %s', r_mql);

  -- =====================================================================
  -- Funil 3 — COORTE/data. Período: janeiro/2024. Coorte real = 5
  -- (Início, Fim, Ganho Depois, Perda Depois, Desqualificado) — Antigo e
  -- Antes ficam de fora.
  -- =====================================================================

  -- A/N/Q) total_entraram = 5: o lead ANTIGO (nov/2023) e o de ANTES do
  -- início nunca entram, mesmo existindo (hipoteticamente visível no
  -- Kanban) — só quem é da coorte conta.
  select total_entraram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Lead Novo';
  assert r_mql = 5, format('total_entraram do funil3 deveria ser 5 (Início,Fim,GanhoDepois,PerdaDepois,Desqualificado), veio %s', r_mql);

  -- B) limite de início inclusivo: Cliente Início (exatamente >= início) ENTRA.
  -- C) um segundo antes: Cliente Antes NÃO entra (já provado acima, pois não altera o total_entraram=5).
  -- D) limite de fim inclusivo: Cliente Fim (último segundo do período) ENTRA (também já provado no total).

  -- N/O/P) quantidade/pipelineValor atuais: SÓ Início (1000) e Fim (2000)
  -- estão correntemente em Lead Novo e são da coorte — nem o Antigo (fora
  -- da coorte), nem o Desqualificado (arquivada_em not null) contam aqui,
  -- mesmo este último sendo da coorte.
  select quantidade into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Lead Novo';
  assert r_mql = 2, format('quantidade atual de Lead Novo (funil3) deveria ser 2 (Início, Fim), veio %s', r_mql);
  select valor into r_desq_valor from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Lead Novo';
  assert r_desq_valor = 3000, format('pipelineValor de Lead Novo (funil3) deveria ser 3000 (1000+2000), veio %s', r_desq_valor);

  -- G) ganho depois do fim do período: alcance de Fechado CONTA (coorte +
  -- fechamento válido, nunca por data_fechamento) — mas a métrica
  -- FINANCEIRA (quantidade/valor, por data_fechamento) NÃO conta, porque a
  -- venda está registrada em março, fora de "janeiro/2024".
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Fechado';
  assert r_mql = 1, format('alcancaram(Fechado) do funil3 deveria ser 1 (Ganho Depois), veio %s', r_mql);
  select quantidade into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Fechado';
  assert r_mql = 0, format('quantidade financeira de Fechado (funil3) deveria ser 0 (venda registrada fora da janela data_fechamento), veio %s', r_mql);

  -- Lead Novo (funil3) cumulativo: TODOS os 5 da coorte alcançaram, inclusive
  -- Ganho Depois (que pulou direto pra Fechado — crédito cumulativo) e
  -- Desqualificado (continua contando nas principais que alcançou antes).
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Lead Novo';
  assert r_mql = 5, format('alcancaram(Lead Novo) do funil3 deveria ser 5 (toda a coorte, cumulativo), veio %s', r_mql);

  -- I) perda depois do fim do período: conta como Perdido da coorte, mesmo
  -- o EVENTO de perda (historico_etapas) estando datado em março.
  select alcancaram into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Perdido';
  assert r_mql = 1, format('alcancaram(Perdido) do funil3 deveria ser 1 (Perda Depois), veio %s', r_mql);
  select quantidade into r_mql from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Perdido';
  assert r_mql = 1, format('quantidade(Perdido) do funil3 (agora coorte-based) deveria ser 1 (Perda Depois), veio %s', r_mql);

  -- J) desqualificado depois do fim do período: aparece em `desqualificados`
  -- (total da coorte), não importa quando arquivada_em aconteceu.
  select desqualificados into v_desq from public.funil_metricas('2024-01-01', '2024-01-31', v_funil3_id) where nome = 'Lead Novo';
  assert v_desq = 1, format('desqualificados do funil3 deveria ser 1 (Cliente Desqualificado), veio %s', v_desq);

  -- Monotonicidade: dentro do pipeline principal do funil1, nenhuma etapa
  -- seguinte pode ter alcancaram MAIOR que a anterior (conferido pela
  -- própria ordem, já que a sequência inteira já foi lida acima — repete
  -- a leitura ordenada e compara par a par).
  declare
    v_anterior bigint := null;
    v_rec record;
  begin
    for v_rec in
      select nome, alcancaram
      from public.funil_metricas('2024-01-01', '2024-01-31', v_funil1_id)
      where tipo <> 'perdida' and not pos_fechamento and participa_conversao
      order by ordem
    loop
      if v_anterior is not null then
        assert v_rec.alcancaram <= v_anterior,
          format('monotonicidade quebrada: %s (alcancaram=%s) é maior que a etapa principal anterior (%s)',
            v_rec.nome, v_rec.alcancaram, v_anterior);
      end if;
      v_anterior := v_rec.alcancaram;
    end loop;
  end;

  raise notice 'funil_metricas_alcance_cumulativo_test.sql: todas as asserções passaram.';
end;
$$;

rollback;

-- ===========================================================================
-- Depois deste ROLLBACK: a coluna participa_conversao, a constraint e a
-- função voltam a ser exatamente como eram antes (produção, sem esta
-- migration) — nada é gravado, nem o schema novo, nem os fixtures.
-- ===========================================================================
