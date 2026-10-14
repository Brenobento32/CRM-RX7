-- ===========================================================================
-- Operação real: metas/vendas separadas por TCV/MRR + trava de handoff
-- SDR -> CLOSER em "Reunião realizada".
--
-- Pré-requisito: 20261014140000_user_role_sdr.sql (valor 'sdr' do enum
-- user_role, numa migration própria — Postgres não deixa usar um valor de
-- enum recém-criado na mesma transação).
--
-- Ordem do arquivo:
--   1. tipo_venda (enum compartilhado por fechamentos.tipo_venda e
--      metas.tipo_meta)
--   2. fechamentos.tipo_venda — nullable, histórico preservado, obrigatório
--      só em vendas NOVAS (trigger, nunca backfill)
--   3. fechar_negociacao / atualizar_fechamento — ganham p_tipo_venda
--   4. metas — tipo_meta, unique por (usuario_id, periodo_mes, tipo_meta),
--      metas_regras() trava o tipo igual a alvo/mês
--   5. metas_progresso — reescrita com colunas tcv/mrr separadas
--   6. negociacoes — trava de handoff SDR -> CLOSER em "reuniao_realizada"
--
-- NADA aqui faz backfill de dado histórico de venda: todo fechamento já
-- existente fica com tipo_venda/tipo_meta NULL ("não classificado"), de
-- propósito — ver comentários de cada seção.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipo compartilhado.
-- ---------------------------------------------------------------------------
create type public.tipo_venda as enum ('tcv', 'mrr');

comment on type public.tipo_venda is
  'TCV (Total Contract Value) ou MRR (Monthly Recurring Revenue) — classifica '
  'tanto uma venda (fechamentos.tipo_venda) quanto uma meta (metas.tipo_meta). '
  'Os dois nunca se misturam: cada venda conta só para o seu tipo.';

-- ---------------------------------------------------------------------------
-- 2. fechamentos.tipo_venda — nullable de propósito.
--
-- NÃO há UPDATE de backfill aqui. Todo fechamento já existente nasce (e
-- permanece) com tipo_venda = null — "não classificado". O trigger abaixo só
-- impede que uma venda NOVA seja criada sem escolher TCV/MRR; nunca toca uma
-- linha já existente, então editar outros campos de um fechamento antigo
-- (valor, status, serviços — via atualizar_fechamento) não força nada aqui.
-- ---------------------------------------------------------------------------
alter table public.fechamentos
  add column tipo_venda public.tipo_venda;

comment on column public.fechamentos.tipo_venda is
  'TCV ou MRR da venda. NULL em fechamentos anteriores a esta migration — '
  '"não classificado", nunca inferido automaticamente. Obrigatório (via '
  'trigger) em todo fechamento novo a partir de agora.';

create or replace function public.fechamentos_exige_tipo_venda_novo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tipo_venda is null then
    raise exception 'Toda nova venda precisa ser classificada como TCV ou MRR.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.fechamentos_exige_tipo_venda_novo is
  'Só roda em INSERT — nunca em UPDATE, para não forçar classificação '
  'retroativa de fechamentos antigos ao editar outro campo deles.';

create trigger fechamentos_exige_tipo_venda_novo
  before insert on public.fechamentos
  for each row
  execute function public.fechamentos_exige_tipo_venda_novo();

-- ---------------------------------------------------------------------------
-- 3. fechar_negociacao / atualizar_fechamento ganham p_tipo_venda.
--
-- `fechar_negociacao`: o INSERT que ela faz cai no trigger acima — se
-- p_tipo_venda vier null, a venda nova é recusada (mensagem clara, sem
-- depender só da validação de formulário no Next.js).
--
-- `atualizar_fechamento`: UPDATE puro, o trigger de INSERT não se aplica.
-- `coalesce(p_tipo_venda, tipo_venda)` preserva o valor atual quando o
-- chamador não manda um tipo novo — nunca reclassifica goela abaixo; só
-- classifica se alguém escolher ativamente TCV/MRR na tela de edição.
-- ---------------------------------------------------------------------------
drop function if exists public.fechar_negociacao(
  uuid, numeric, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
);

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

drop function if exists public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
);

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
  'tipo_venda. tipo_venda só muda se o chamador mandar um valor explícito — '
  'coalesce preserva o que já estava gravado (nunca reclassifica histórico '
  'sozinho). Nunca toca negociacoes.etapa_id/posicao nem '
  'fechamentos.fechado_em/fechado_por. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 4. metas.tipo_meta — mesma filosofia de fechamentos: nullable, sem
-- backfill. Metas antigas (criadas antes desta migration) continuam com
-- tipo_meta = null; o índice único (nulls not distinct) garante que elas não
-- colidem entre si, e o trigger abaixo só exige o tipo em metas NOVAS.
-- ---------------------------------------------------------------------------
alter table public.metas
  add column tipo_meta public.tipo_venda;

comment on column public.metas.tipo_meta is
  'TCV ou MRR da meta. NULL em metas criadas antes desta migration — '
  '"não classificada". Obrigatório (via trigger) em toda meta nova.';

alter table public.metas drop constraint metas_uma_por_mes;

alter table public.metas
  add constraint metas_uma_por_mes
  unique nulls not distinct (usuario_id, periodo_mes, tipo_meta);

create or replace function public.metas_exige_tipo_novo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tipo_meta is null then
    raise exception 'Toda nova meta precisa ser classificada como TCV ou MRR.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger metas_exige_tipo_novo
  before insert on public.metas
  for each row
  execute function public.metas_exige_tipo_novo();

-- `metas_regras()` (20260924120000_metas.sql): mesma função, agora também
-- travando tipo_meta junto de usuario_id/periodo_mes/criado_por — editar uma
-- meta já existente continua sendo só mudar o valor.
create or replace function public.metas_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.usuario_id is not null and not exists (
      select 1
      from public.profiles p
      where p.id = new.usuario_id
        and p.role = 'closer'
    ) then
      raise exception 'Metas individuais são apenas para closers.'
        using errcode = '23514';
    end if;
  elsif new.usuario_id is distinct from old.usuario_id
     or new.periodo_mes <> old.periodo_mes
     or new.tipo_meta is distinct from old.tipo_meta
     or new.criado_por <> old.criado_por
  then
    raise exception 'Só o valor de uma meta pode ser alterado.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. metas_progresso — TCV e MRR separados na mesma linha por alvo.
--
-- `vendas` só soma fechamentos CLASSIFICADOS (tipo_venda is not null) — um
-- fechamento histórico "não classificado" nunca entra em nenhum dos dois
-- totais, nunca é assumido como TCV.
-- ---------------------------------------------------------------------------
drop function if exists public.metas_progresso(date);

create or replace function public.metas_progresso(p_mes date)
returns table (
  meta_id_tcv     uuid,
  meta_id_mrr     uuid,
  usuario_id      uuid,
  nome            text,
  role            public.user_role,
  ativo           boolean,
  valor_meta_tcv  numeric,
  realizado_tcv   numeric,
  valor_meta_mrr  numeric,
  realizado_mrr   numeric
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
  where public.is_gerente()

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
  where (public.is_gerente() or p.id = (select auth.uid()))
    and (
      (p.role = 'closer' and p.ativo)
      or mt.id is not null
      or mm.id is not null
      or vt.valor is not null
      or vm.valor is not null
    );
$$;

comment on function public.metas_progresso is
  'Meta x realizado do mês, TCV e MRR separados na mesma linha por alvo '
  '(empresa e por pessoa). Realizado só soma fechamentos.tipo_venda '
  'classificado — histórico sem tipo não entra em nenhum dos dois totais. '
  'SECURITY DEFINER com autorização explícita: closer recebe só a própria linha.';

revoke all on function public.metas_progresso(date) from public, anon;
grant execute on function public.metas_progresso(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Handoff SDR -> CLOSER em "Reunião realizada".
--
-- Trava por ORDEM/CHAVE de etapas_funil, nunca pelo nome (editável pelo
-- gerente) — mesmo espírito de `etapa_tipo()`/`etapa_id_por_chave()`. Só se
-- aplica a quem tem role = 'sdr'; closer e gerente nunca passam por aqui.
--
-- `chave = 'reuniao_realizada'` é única no banco inteiro (etapas_funil_chave
-- é `unique`, não `unique por funil`) — só o Funil Principal tem essa etapa
-- de sistema. Um funil novo (criar_funil) nunca ganha essa chave, então
-- `v_limite_ordem` vem null nele e a função libera o movimento: a regra
-- simplesmente não existe em funis sem essa etapa técnica, por design (não
-- inventamos uma regra equivalente baseada em nome/posição lá).
--
-- Mensagem de erro aqui é a mesma do `moverNegociacao` (lib/dal/funil.ts) —
-- esta função é o backstop para quem for direto na API/REST do Supabase
-- (ignorando a Server Action); a checagem em TypeScript é que dá a
-- experiência normal (mensagem amigável sem round-trip extra ao banco).
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_valida_handoff_sdr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role          public.user_role;
  v_funil_id      uuid;
  v_ordem_destino numeric;
  v_limite_ordem  numeric;
  v_ordem_atual   numeric;
begin
  select role into v_role from public.profiles where id = (select auth.uid());
  if v_role is distinct from 'sdr' then
    return new;
  end if;

  select funil_id, ordem into v_funil_id, v_ordem_destino
    from public.etapas_funil where id = new.etapa_id;

  select ordem into v_limite_ordem
    from public.etapas_funil
   where funil_id = v_funil_id and chave = 'reuniao_realizada';

  if v_limite_ordem is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select ordem into v_ordem_atual from public.etapas_funil where id = old.etapa_id;
    if v_ordem_atual is not null and v_ordem_atual >= v_limite_ordem then
      raise exception 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
        using errcode = '42501';
    end if;
  end if;

  if v_ordem_destino > v_limite_ordem then
    raise exception 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.negociacoes_valida_handoff_sdr is
  'Backstop no banco da trava SDR -> CLOSER: um SDR não move uma negociação '
  'que já alcançou (ou tentaria pular além de) a etapa de chave '
  '''reuniao_realizada'' no mesmo funil. Funis sem essa etapa técnica não são '
  'afetados. security definer só para ler profiles.role do usuário atual.';

revoke all on function public.negociacoes_valida_handoff_sdr() from public, anon;

create trigger negociacoes_valida_handoff_sdr
  before insert or update of etapa_id on public.negociacoes
  for each row
  execute function public.negociacoes_valida_handoff_sdr();
