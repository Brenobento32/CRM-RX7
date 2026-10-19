-- ===========================================================================
-- Anulação explícita e auditável de fechamentos — infraestrutura.
--
-- CONTEXTO (auditoria desta rodada, banco real): dois registros em
-- `fechamentos` são inválidos (um "Colégio Batista" duplicado em 14/10 — o
-- legítimo é 16/10 — e um "TESTE CRM - NAO ATENDER" de teste, nunca uma
-- venda real), inflando TCV/MRR em Meta Mensal, Contexto do funil e
-- Realizado por funil.
--
-- POR QUE NÃO ARQUIVAR/EXCLUIR A NEGOCIAÇÃO (já tentado por quem usa o
-- sistema, não resolveu): `funil_metricas`/`obterRealizadoFunil`/
-- `realizado_periodo` nunca filtram por `negociacoes.arquivada_em`/
-- `excluida_em` nos números HISTÓRICOS (decisão deliberada, documentada em
-- 20261015100000_funil_metricas_entidade_unica.sql: "arquivar/excluir a
-- negociação depois de vendida nunca apaga a venda do histórico
-- financeiro"). As duas negociações aqui JÁ estão arquivadas — e os
-- valores continuam contando, exatamente por isso.
--
-- POR QUE NÃO DELETE/mover para Perdida/NULL em tipo_venda (alternativas
-- descartadas nesta rodada, por decisão explícita):
--   - DELETE direto em `fechamentos`: bloqueado por uma constraint trigger
--     real (`fechamentos_protege_negociacao`, 20260923120500_fechamentos.sql)
--     — nunca permite apagar o fechamento de uma negociação que ainda está
--     na etapa `ganha`. Confirmado ao vivo (BEGIN/ROLLBACK): tentar o DELETE
--     + `SET CONSTRAINTS ALL IMMEDIATE` dispara
--     "Tire a negociação ... da etapa de fechamento antes de remover o
--     registro de fechamento." (23514).
--   - Mover para Perdida: tocaria `etapa_id` e acrescentaria uma entrada em
--     `historico_etapas` — explicitamente fora de escopo desta correção
--     (decisão do usuário: só correção FINANCEIRA, histórico de etapas
--     intocado).
--   - tipo_venda = NULL: tiraria o registro de `obterRealizadoFunil`/
--     `realizado_periodo` (que já filtram `tipo_venda is not null`), mas
--     NÃO de `funil_metricas` (cuja CTE `ganhos_periodo` nunca filtrou por
--     tipo_venda) — o funil visual continuaria contando as 2 negociações
--     como "Fechado" válido. Correção incompleta, descartada.
--
-- SOLUÇÃO: um ESTADO EXPLÍCITO de anulação na própria linha de
-- `fechamentos` — a linha nunca é tocada em negociacao_id/valor_vendido/
-- tipo_venda/data_fechamento/responsavel_id (prova financeira original
-- preservada, auditável), só ganha 3 colunas novas que dizem "isto foi
-- anulado, por quem, quando e por quê". Todo agregado financeiro (Meta
-- Mensal, Contexto do funil, Realizado por funil, e agora também o
-- "Fechado" do funil visual) passa a exigir `anulado_em is null`.
-- `historico_etapas` continua intocado — a entrada bruta em `ganha`
-- permanece no histórico, só a CONVERSÃO COMERCIAL (ganho válido) exclui
-- fechamentos anulados.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas de anulação. Nenhuma coluna existente é tocada.
-- ---------------------------------------------------------------------------
alter table public.fechamentos
  add column anulado_em      timestamptz null,
  add column motivo_anulacao text        null,
  add column anulado_por     uuid        null references public.profiles(id) on delete restrict;

comment on column public.fechamentos.anulado_em is
  'NULL = fechamento ativo (conta em TCV/MRR/metas/realizado/conversão). '
  'Preenchido = anulado: a linha permanece (negociacao_id/valor_vendido/'
  'tipo_venda/data_fechamento/responsavel_id nunca mudam — prova financeira '
  'original intacta), mas para de contar em qualquer agregado comercial. '
  'Nunca um DELETE: ver public.anular_fechamento().';

comment on column public.fechamentos.motivo_anulacao is
  'Obrigatório (não vazio) sempre que anulado_em estiver preenchido — '
  'motivo legível do porquê este fechamento não representa uma venda '
  'válida (duplicata, teste, erro de cadastro etc).';

comment on column public.fechamentos.anulado_por is
  'Quem anulou (profiles.id), via public.anular_fechamento(). NULL só em '
  'correções sistêmicas (ex.: uma migration de dados) — nunca em anulação '
  'feita por um usuário pela aplicação, onde auth.uid() é sempre exigido.';

-- Dois estados válidos, nunca um meio-termo: ativo (as 3 colunas null) ou
-- anulado (anulado_em preenchido + motivo não vazio; anulado_por livre —
-- null em correção sistêmica, preenchido quando anulado por um usuário).
alter table public.fechamentos add constraint fechamentos_anulacao_valida check (
  (anulado_em is null and motivo_anulacao is null and anulado_por is null)
  or
  (anulado_em is not null and motivo_anulacao is not null and btrim(motivo_anulacao) <> '')
);

-- ---------------------------------------------------------------------------
-- 2. anular_fechamento() — único caminho oficial pra anular. SECURITY
-- DEFINER porque a RLS de `fechamentos` segue o dono atual da negociação
-- (mesmo motivo de `realizado_periodo`/`metas_progresso`) — sem isso um
-- gerente poderia não conseguir anular o fechamento de uma carteira já
-- transferida. `auth.uid()` é exigido explicitamente (nunca `current_user`
-- pra identidade comercial) — quem chama sem sessão (automação) é recusado,
-- de propósito: anulação é sempre uma decisão de uma PESSOA, nunca um
-- script. Reativação NÃO existe ainda (decisão explícita desta rodada).
-- ---------------------------------------------------------------------------
create function public.anular_fechamento(
  p_negociacao_id uuid,
  p_motivo        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_motivo text := btrim(p_motivo);
  v_existe boolean;
  v_ja_anulado boolean;
begin
  if v_uid is null then
    raise exception 'Operação exige um usuário autenticado.' using errcode = '42501';
  end if;

  if not public.is_gerente() then
    raise exception 'Somente gerentes podem anular um fechamento.' using errcode = '42501';
  end if;

  select true, f.anulado_em is not null into v_existe, v_ja_anulado
    from public.fechamentos f
   where f.negociacao_id = p_negociacao_id;

  if v_existe is null then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;

  if v_ja_anulado then
    raise exception 'Este fechamento já está anulado.' using errcode = '23514';
  end if;

  if v_motivo is null or v_motivo = '' then
    raise exception 'Informe o motivo da anulação.' using errcode = '23514';
  end if;

  update public.fechamentos
     set anulado_em      = now(),
         motivo_anulacao = v_motivo,
         anulado_por     = v_uid
   where negociacao_id = p_negociacao_id;
end;
$$;

comment on function public.anular_fechamento is
  'Anula um fechamento (não conta mais em TCV/MRR/metas/realizado/'
  'conversão) sem apagar a linha nem tocar negociacoes/historico_etapas. '
  'Só GERENTE, só com auth.uid() real (nunca automação) e motivo '
  'obrigatório. Não existe reativação nesta versão — fluxo futuro, '
  'separado.';

revoke all on function public.anular_fechamento(uuid, text) from public, anon;
grant execute on function public.anular_fechamento(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. fechar_negociacao()/atualizar_fechamento() nunca tocam, nem
-- silenciosamente, um fechamento já anulado. `atualizar_fechamento` passa a
-- recusar editar; `fechar_negociacao` passa a recusar reabrir/sobrescrever
-- via o UPSERT (`on conflict (negociacao_id) do update`) — sem isso, fechar
-- de novo a MESMA negociação (ela já está em `ganha`) reescreveria por
-- cima do registro anulado silenciosamente, apagando a anulação. Mesma
-- assinatura das duas (create or replace, nenhum DROP necessário) — só a
-- checagem nova, resto do corpo idêntico a 20261014150000_tcv_mrr_sdr.sql.
-- ---------------------------------------------------------------------------
create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null,
  p_servico_ids        uuid[] default null,
  p_observacoes        text default null,
  p_tipo_venda         public.tipo_venda default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_ganha_id uuid;
begin
  select n.funil_id into v_funil_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.fechamentos f
    where f.negociacao_id = p_negociacao_id and f.anulado_em is not null
  ) then
    raise exception 'Este fechamento foi anulado e não pode ser reaberto/sobrescrito por aqui — exige um fluxo de reativação (ainda não implementado).'
      using errcode = '23514';
  end if;

  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;

  select e.id into v_ganha_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id
     and e.tipo = 'ganha';

  update public.negociacoes
     set etapa_id = v_ganha_id,
         posicao = p_posicao
   where id = p_negociacao_id;

  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, link_contrato, status_pagamento, status_onboarding,
    observacoes, tipo_venda
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding,
    p_observacoes, p_tipo_venda
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        observacoes        = excluded.observacoes,
        tipo_venda         = coalesce(excluded.tipo_venda, public.fechamentos.tipo_venda),
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;

revoke all on function public.fechar_negociacao(
  uuid, numeric, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text, public.tipo_venda
) from public, anon;

grant execute on function public.fechar_negociacao(
  uuid, numeric, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text, public.tipo_venda
) to authenticated;

comment on function public.fechar_negociacao is
  'Fecha uma negociação (etapa -> ganha + upsert de fechamentos). Recusa '
  'reabrir/sobrescrever um fechamento já ANULADO (23514) — anulação nunca é '
  'desfeita silenciosamente por um fechamento novo.';

create or replace function public.atualizar_fechamento(
  p_negociacao_id      uuid,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null,
  p_servico_ids        uuid[] default null,
  p_observacoes        text default null,
  p_tipo_venda         public.tipo_venda default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tipo public.tipo_etapa;
begin
  select e.tipo into v_tipo
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id
   where n.id = p_negociacao_id;

  if v_tipo is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if v_tipo <> 'ganha' then
    raise exception 'Só é possível editar o fechamento de uma negociação fechada.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.fechamentos f
    where f.negociacao_id = p_negociacao_id and f.anulado_em is not null
  ) then
    raise exception 'Este fechamento foi anulado e não pode ser editado — exige um fluxo de reativação (ainda não implementado).'
      using errcode = '23514';
  end if;

  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;

  update public.fechamentos
     set valor_vendido      = p_valor_vendido,
         data_fechamento    = p_data_fechamento,
         contrato_enviado   = p_contrato_enviado,
         contrato_assinado  = p_contrato_assinado,
         link_contrato      = p_link_contrato,
         status_pagamento   = p_status_pagamento,
         status_onboarding  = p_status_onboarding,
         observacoes        = p_observacoes,
         tipo_venda         = coalesce(p_tipo_venda, tipo_venda)
   where negociacao_id = p_negociacao_id;

  if not found then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text, public.tipo_venda
) from public, anon;

grant execute on function public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text, public.tipo_venda
) to authenticated;

comment on function public.atualizar_fechamento is
  'Edita um fechamento já existente (negociação ganha): valor_vendido, '
  'data_fechamento, contrato, status, serviços, observações e (opcional) '
  'tipo_venda. Recusa editar um fechamento ANULADO (23514). Nunca toca '
  'negociacoes.etapa_id/posicao nem fechamentos.fechado_em/fechado_por. '
  'SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 4. funil_metricas(): ganho VÁLIDO (quantidade/valor/alcance da etapa
-- 'ganha') passa a exigir fechamento com anulado_em is null. Resto da
-- função idêntico a 20261015100000_funil_metricas_entidade_unica.sql —
-- coorte, total_entraram, demais etapas (alcançaram "bruto", via
-- historico_etapas) e perdidos_periodo NÃO mudam: a passagem física pela
-- etapa ganha continua no histórico ("alcançaram" de qualquer etapa é
-- sempre EXISTS real em historico_etapas, nunca reescrito); só a
-- CONVERSÃO COMERCIAL da etapa ganha (alcance E quantidade/valor) deixa de
-- contar negociações cujo único fechamento está anulado.
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

  historico_base as (
    select n.*
    from public.negociacoes n
    where n.funil_id = p_funil_id
  ),

  atuais_base as (
    select n.*
    from historico_base n
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

  coorte as (
    select n.id
    from historico_base n, periodo
    where n.created_at >= periodo.inicio
      and n.created_at <  periodo.fim
  ),

  total_entraram as (
    select count(*) as total from coorte
  ),

  -- Alcance BRUTO (todas as etapas, inclusive 'ganha') — EXISTS real em
  -- historico_etapas, sem filtro de anulação: a passagem física pela etapa
  -- continua no histórico pra sempre, mesmo que o fechamento associado
  -- venha a ser anulado depois.
  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),

  -- Alcance VÁLIDO da etapa 'ganha' (achado desta rodada): só conta quem
  -- alcançou 'ganha' E tem um fechamento NÃO anulado — um fechamento
  -- anulado não é um ganho comercial válido, mesmo que a passagem física
  -- pela etapa continue registrada em historico_etapas (CTE acima).
  alcancaram_ganha_valido as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id and e.tipo = 'ganha'
    join public.fechamentos f on f.negociacao_id = h.negociacao_id and f.anulado_em is null
    group by h.etapa_nova_id
  ),

  -- Ganhos no período: venda histórica real (fechamentos.data_fechamento),
  -- NÃO ANULADA — um fechamento anulado nunca é um ganho comercial válido.
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
    case when e.tipo = 'ganha' then coalesce(alg.qtd, 0) else coalesce(al.qtd, 0) end,
    t.media,
    coalesce(t.n, 0),
    a.parados,
    coalesce(a.parados_7, 0),
    (select total from total_entraram)
  from public.etapas_funil e
  left join atuais                    a   on a.etapa_id = e.id
  left join alcancaram                al  on al.etapa_id = e.id
  left join alcancaram_ganha_valido   alg on alg.etapa_id = e.id
  left join ganhos_periodo            gp  on gp.etapa_id = e.id
  left join perdidos_periodo          pp  on pp.etapa_id = e.id
  left join tempos                    t   on t.etapa_id = e.id
  where e.ativo
    and e.funil_id = p_funil_id
  order by e.ordem;
$$;

comment on function public.funil_metricas is
  'Métricas por etapa ativa de UM funil, entidade única. Coorte = criadas '
  'no período (toda negociação, sem exclusão de arquivada/excluída/'
  'cliente-excluído). Alcançaram = EXISTS real em historico_etapas, '
  'evolução até o momento da consulta (nunca truncado pelo período, nunca '
  'inferido por etapa pulada) — EXCETO a etapa ganha, cujo alcance/'
  'quantidade/valor exige fechamento com anulado_em is null (um fechamento '
  'anulado não é um ganho comercial válido, mesmo que a passagem física '
  'pela etapa continue em historico_etapas). Ganhos = venda real por '
  'fechamentos.data_fechamento, não anulada, sobre o histórico completo. '
  'Perdidos = entrada real em etapa perdida no período, deduplicada por '
  'negociação antes de somar valor_estimado (aproximado, sem histórico de '
  'valor). Atual (quantidade/valor/parados de etapas abertas) é a ÚNICA '
  'parte que exclui arquivada/excluída/cliente-excluído. SECURITY INVOKER.';

revoke all on function public.funil_metricas from public, anon;
grant execute on function public.funil_metricas to authenticated;

-- ---------------------------------------------------------------------------
-- 5. metas_progresso()/realizado_periodo(): a CTE `vendas` de cada uma soma
-- `fechamentos.valor_vendido` direto — ganham `and f.anulado_em is null` ao
-- lado do `f.tipo_venda is not null` já existente. Resto do corpo idêntico
-- (puxado ao vivo do banco linked via `pg_get_functiondef`, pra garantir
-- que esta migration reaplica exatamente a versão hoje instalada — ambas
-- já foram reescritas por migrations anteriores, 20261016190000/
-- 20261016200000). `metas_progresso` alimenta `/metas` E o bloco "Meta
-- Mensal" de `/funil/metricas`; `realizado_periodo` alimenta a mesma tela
-- (realizado geral/individual do período) — as duas PRECISAM mudar junto
-- com `funil_metricas`, senão a meta mensal e o realizado geral continuam
-- contando os 2 fechamentos anulados mesmo depois desta migration.
-- ---------------------------------------------------------------------------
create or replace function public.metas_progresso(p_mes date)
returns table (
  meta_id_tcv    uuid,
  meta_id_mrr    uuid,
  usuario_id     uuid,
  nome           text,
  role           public.user_role,
  ativo          boolean,
  valor_meta_tcv numeric,
  realizado_tcv  numeric,
  valor_meta_mrr numeric,
  realizado_mrr  numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  mes as (
    select date_trunc('month', p_mes)::date as inicio
  ),
  vendas as (
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join mes
    where f.data_fechamento >= mes.inicio
      and f.data_fechamento <  (mes.inicio + interval '1 month')::date
      and f.tipo_venda is not null
      and f.anulado_em is null
    group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select usuario_id, valor from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select usuario_id, valor from vendas where tipo_venda = 'mrr')
  select
    mt.id,
    mm.id,
    null::uuid,
    null::text,
    null::public.user_role,
    null::boolean,
    mt.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    mm.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  from mes
  left join public.metas mt
    on mt.usuario_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.usuario_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  -- Linha da empresa: sempre presente (geral, sem PII).

  union all

  select
    mt.id,
    mm.id,
    p.id,
    p.nome,
    p.role,
    p.ativo,
    mt.valor_meta,
    coalesce(vt.valor, 0),
    mm.valor_meta,
    coalesce(vm.valor, 0)
  from public.profiles p
  cross join mes
  left join public.metas mt
    on mt.usuario_id = p.id and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.usuario_id = p.id and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  left join vendas_tcv vt on vt.usuario_id = p.id
  left join vendas_mrr vm on vm.usuario_id = p.id
  where (
      public.is_gerente()
      or (p.id = (select auth.uid()) and p.role = 'closer')
    )
    and (
      (p.role = 'closer' and p.ativo)
      or mt.id is not null
      or mm.id is not null
      or vt.valor is not null
      or vm.valor is not null
    );
$$;

comment on function public.metas_progresso is
  'Meta x realizado do mês (TCV/MRR), SECURITY DEFINER. Realizado exclui '
  'fechamentos anulados (anulado_em is not null) — um fechamento anulado '
  'não é uma venda válida. GERENTE vê empresa + equipe; closer só a '
  'própria linha + a da empresa; SDR só a da empresa.';

revoke all on function public.metas_progresso(date) from public, anon;
grant execute on function public.metas_progresso(date) to authenticated;

create or replace function public.realizado_periodo(p_inicio date, p_fim date)
returns table (
  usuario_id     uuid,
  nome           text,
  role           public.user_role,
  ativo          boolean,
  realizado_tcv  numeric,
  realizado_mrr  numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  vendas as (
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    where f.data_fechamento >= p_inicio
      and f.data_fechamento <= p_fim
      and f.tipo_venda is not null
      and f.anulado_em is null
    group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select usuario_id, valor from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select usuario_id, valor from vendas where tipo_venda = 'mrr')
  select
    null::uuid,
    null::text,
    null::public.user_role,
    null::boolean,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  -- Linha da empresa: sempre presente (geral, sem PII).

  union all

  select
    p.id,
    p.nome,
    p.role,
    p.ativo,
    coalesce(vt.valor, 0),
    coalesce(vm.valor, 0)
  from public.profiles p
  left join vendas_tcv vt on vt.usuario_id = p.id
  left join vendas_mrr vm on vm.usuario_id = p.id
  where (
      public.is_gerente()
      or (p.id = (select auth.uid()) and p.role = 'closer')
    )
    and (
      (p.role = 'closer' and p.ativo)
      or vt.valor is not null
      or vm.valor is not null
    );
$$;

comment on function public.realizado_periodo is
  'Realizado (TCV/MRR) de um período arbitrário, SEM filtro de funil, '
  'atribuído por fechamentos.responsavel_id. Exclui fechamentos anulados '
  '(anulado_em is not null). Mesmo padrão de autorização de '
  'metas_progresso (SECURITY DEFINER: GERENTE vê a empresa + a equipe '
  'inteira; closer só a própria linha).';

revoke all on function public.realizado_periodo(date, date) from public, anon;
grant execute on function public.realizado_periodo(date, date) to authenticated;
