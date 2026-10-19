-- ===========================================================================
-- Meta mensal por funil (TCV/MRR) — auditoria prévia em
-- supabase/migrations_propostas/20261019150000_metas_por_funil.sql (rascunho
-- não testado, não aplicado). Esta migration é a versão completa, testada
-- (supabase/tests/metas_por_funil_test.sql) e cronológica, construída a
-- partir daquele rascunho — o rascunho NÃO foi movido nem aplicado; continua
-- em migrations_propostas como estava.
--
-- SEMÂNTICA (igual ao rascunho):
--   metas.funil_id IS NULL      -> meta geral (todos os funis) ou meta
--                                   individual de um closer, como já existia.
--   metas.funil_id IS NOT NULL  -> meta mensal DAQUELE funil, sempre da
--                                   EMPRESA (usuario_id obrigatoriamente
--                                   null nesta primeira versão — nenhuma
--                                   meta individual por funil ainda).
--
-- NENHUMA distribuição automática: a meta geral e a soma das metas por funil
-- são cadastradas e lidas separadamente, sempre; esta migration nunca gera
-- nem corrige uma a partir da outra (ver `metas_funis_progresso` e a UI de
-- /metas, que só mostra um aviso quando divergem).
--
-- CRÍTICO (motivo pelo qual `metas_progresso` precisa ser recriada, não só
-- a tabela alterada): sem "and funil_id is null" nos 4 LEFT JOINs de `metas`
-- dentro de `metas_progresso`, uma meta por funil cadastrada no mesmo
-- mês/tipo passaria a casar TAMBÉM nesses LEFT JOINs (mesmo usuario_id null
-- + periodo_mes + tipo_meta, só o funil_id diferente) — o Postgres casaria
-- com uma linha arbitrária entre a meta geral e a de um funil específico,
-- corrompendo silenciosamente a meta geral já exibida em /metas e no bloco
-- "Meta mensal" de /funil/metricas. Esta migration recria `metas_progresso`
-- com esse filtro nos 4 joins (2 da linha empresa, 2 da linha por pessoa) —
-- a matemática de quem já existia (vendas/vendas_tcv/vendas_mrr, ganhos por
-- `fechamentos.anulado_em is null`) continua idêntica, só ganha uma coluna
-- de quantidade (qtd_tcv/qtd_mrr) por alvo, necessária para o ticket médio
-- do novo painel "Meta mensal" (realizado ÷ quantidade de vendas).
--
-- NÃO toca: RLS de `metas` (as 4 policies não referenciam nenhuma coluna
-- específica, continuam valendo idênticas com a coluna nova — confirmado na
-- auditoria do rascunho); `realizado_periodo` (não lê `metas`, não tem
-- noção de funil, fora de escopo aqui); `funil_metricas`; anulação de
-- fechamentos; histórico de etapas; permissões comerciais; WhatsApp.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Coluna nova + regra de combinação + índice + unicidade.
-- ---------------------------------------------------------------------------
alter table public.metas
  add column funil_id uuid references public.funis (id) on delete restrict;

comment on column public.metas.funil_id is
  'NULL = meta geral (todos os funis) ou meta individual de closer, como '
  'antes desta coluna existir. NÃO-NULL = meta mensal deste funil '
  'específico, sempre da empresa (usuario_id obrigatoriamente null — '
  'constraint metas_funil_requer_meta_geral). Nunca uma distribuição '
  'automática da meta geral: cadastro manual, mesmo trigger de '
  'imutabilidade (metas_regras) protegendo o valor pós-criação.';

alter table public.metas
  add constraint metas_funil_requer_meta_geral
  check (funil_id is null or usuario_id is null);

create index metas_funil_idx on public.metas (funil_id);

alter table public.metas drop constraint metas_uma_por_mes;
alter table public.metas add constraint metas_uma_por_mes
  unique nulls not distinct (usuario_id, funil_id, periodo_mes, tipo_meta);

-- ---------------------------------------------------------------------------
-- 2. metas_regras — mesma função (20260924120000/20261014150000), agora
-- também travando funil_id na imutabilidade pós-criação (só o valor pode
-- mudar) e recusando a combinação funil_id + usuario_id não-nulos com uma
-- mensagem clara (a CHECK constraint acima é o backstop; esta mensagem é
-- só para dar um erro legível se algo tentar essa combinação via RPC/DAL).
-- ---------------------------------------------------------------------------
create or replace function public.metas_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.funil_id is not null and new.usuario_id is not null then
    raise exception 'Meta por funil é sempre da empresa (usuário deve ser nulo).'
      using errcode = '23514';
  end if;

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
     or new.funil_id is distinct from old.funil_id
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
-- 3. metas_progresso — mesma matemática de 20261019160000 (anulado_em is
-- null já estava lá), + "and funil_id is null" nos 4 joins de metas, + duas
-- colunas novas (qtd_tcv/qtd_mrr) para o ticket médio do painel "Meta
-- mensal". Assinatura de retorno muda (colunas novas) -> precisa DROP antes.
-- ---------------------------------------------------------------------------
drop function if exists public.metas_progresso(date);

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
  qtd_tcv        bigint,
  valor_meta_mrr numeric,
  realizado_mrr  numeric,
  qtd_mrr        bigint
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
    select f.responsavel_id as usuario_id, f.tipo_venda,
           sum(f.valor_vendido) as valor, count(*) as qtd
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
  vendas_tcv as (select usuario_id, valor, qtd from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select usuario_id, valor, qtd from vendas where tipo_venda = 'mrr')
  select
    mt.id,
    mm.id,
    null::uuid,
    null::text,
    null::public.user_role,
    null::boolean,
    mt.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_tcv v),
    (select coalesce(sum(v.qtd), 0) from vendas_tcv v),
    mm.valor_meta,
    (select coalesce(sum(v.valor), 0) from vendas_mrr v),
    (select coalesce(sum(v.qtd), 0) from vendas_mrr v)
  from mes
  left join public.metas mt
    on mt.usuario_id is null and mt.funil_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.usuario_id is null and mm.funil_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
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
    coalesce(vt.qtd, 0),
    mm.valor_meta,
    coalesce(vm.valor, 0),
    coalesce(vm.qtd, 0)
  from public.profiles p
  cross join mes
  left join public.metas mt
    on mt.usuario_id = p.id and mt.funil_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.usuario_id = p.id and mm.funil_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
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
  'fechamentos anulados (anulado_em is not null) e nunca inclui uma meta '
  'POR FUNIL (funil_id is null nos 4 joins de metas) — meta geral e meta '
  'por funil nunca se misturam. qtd_tcv/qtd_mrr: quantidade de vendas de '
  'cada tipo, para ticket médio. GERENTE vê empresa + equipe; closer só a '
  'própria linha + a da empresa; SDR só a da empresa.';

revoke all on function public.metas_progresso(date) from public, anon;
grant execute on function public.metas_progresso(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. metas_funis_progresso — uma linha por funil ATIVO, com a meta/realizado
-- (TCV e MRR) daquele funil no mês. SECURITY DEFINER: precisa ver vendas de
-- TODOS os responsáveis (agregado por funil, nunca individual — não há
-- nenhuma coluna de pessoa aqui, então não há PII pra restringir por papel;
-- GERENTE/SDR/CLOSER recebem exatamente as mesmas linhas, igual à linha da
-- EMPRESA de metas_progresso). `metas_select` (RLS) já deixaria qualquer
-- autenticado ler a meta por funil diretamente (usuario_id is null), mas a
-- leitura de `fechamentos`/`negociacoes` de TODOS os responsáveis exige
-- bypassar a RLS deles — por isso SECURITY DEFINER, como metas_progresso.
-- ---------------------------------------------------------------------------
create or replace function public.metas_funis_progresso(p_mes date)
returns table (
  funil_id       uuid,
  funil_nome     text,
  meta_id_tcv    uuid,
  valor_meta_tcv numeric,
  realizado_tcv  numeric,
  meta_id_mrr    uuid,
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
    select n.funil_id, f.tipo_venda, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join mes
    where f.data_fechamento >= mes.inicio
      and f.data_fechamento <  (mes.inicio + interval '1 month')::date
      and f.tipo_venda is not null
      and f.anulado_em is null
    group by n.funil_id, f.tipo_venda
  ),
  vendas_tcv as (select funil_id, valor from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select funil_id, valor from vendas where tipo_venda = 'mrr')
  select
    fu.id,
    fu.nome,
    mt.id,
    mt.valor_meta,
    coalesce(vt.valor, 0),
    mm.id,
    mm.valor_meta,
    coalesce(vm.valor, 0)
  from public.funis fu
  cross join mes
  left join public.metas mt
    on mt.funil_id = fu.id and mt.usuario_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm
    on mm.funil_id = fu.id and mm.usuario_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  left join vendas_tcv vt on vt.funil_id = fu.id
  left join vendas_mrr vm on vm.funil_id = fu.id
  where fu.ativo
  order by fu.ordem;
$$;

comment on function public.metas_funis_progresso is
  'Meta x realizado mensal (TCV/MRR) de cada funil ATIVO. Realizado: '
  'fechamentos não anulados (anulado_em is null), negociação atualmente em '
  'etapa ganha, por data_fechamento dentro do mês, TODOS os responsáveis '
  '(agregado, sem PII). SECURITY DEFINER só para bypassar a RLS de '
  'fechamentos/negociacoes de outros responsáveis — GERENTE/SDR/CLOSER '
  'recebem exatamente as mesmas linhas (não há nenhum dado individual '
  'aqui para restringir por papel).';

revoke all on function public.metas_funis_progresso(date) from public, anon;
grant execute on function public.metas_funis_progresso(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. salvar_metas_funis — UMA chamada, UMA transação, tudo-ou-nada: o
-- formulário "Salvar metas dos funis" (gerente, /metas) manda todos os
-- campos preenchidos de uma vez; esta RPC valida TODOS os itens primeiro
-- (sem escrever nenhuma linha) e só então grava todos — se qualquer item
-- for inválido, NENHUM é salvo (uma função PL/pgSQL é uma transação única;
-- qualquer `raise exception` desfaz tudo que a própria função já tiver
-- feito nela, mesmo sem ROLLBACK explícito). Isso substitui o upsert
-- individual por item que a action fazia antes (um `.rpc()` por
-- funil×tipo) — aquele caminho podia salvar parcialmente se um item no
-- meio da lista falhasse; este nunca pode.
--
-- p_itens: array JSON de { funil_id, tipo_meta, valor_meta } — só os
-- campos PREENCHIDOS no formulário (um campo vazio nunca entra no array,
-- decidido na action/DAL, não aqui). usuario_id é SEMPRE null (meta por
-- funil é sempre da empresa, mesma regra de metas_funil_requer_meta_geral);
-- esta função nunca aceita usuario_id como parâmetro.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_metas_funis(
  p_mes    date,
  p_itens  jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mes        date;
  v_item       jsonb;
  v_funil_id   uuid;
  v_tipo_meta  text;
  v_valor_meta numeric;
  v_salvos     integer := 0;
  v_vistos     text[] := '{}';
  v_chave      text;
begin
  if (select auth.uid()) is null then
    raise exception 'Operação exige um usuário autenticado.' using errcode = '42501';
  end if;

  if not public.is_gerente() then
    raise exception 'Somente gerentes podem definir metas por funil.' using errcode = '42501';
  end if;

  if p_mes is null then
    raise exception 'Informe o mês.' using errcode = '23514';
  end if;
  v_mes := date_trunc('month', p_mes)::date;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Lista de metas inválida.' using errcode = '23514';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'Nenhuma meta para salvar.' using errcode = '23514';
  end if;

  -- 1ª passada: valida TODOS os itens. Nenhum INSERT/UPDATE acontece aqui —
  -- qualquer item inválido aborta a função inteira antes de tocar `metas`.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if not (v_item ? 'funil_id') or not (v_item ? 'tipo_meta') or not (v_item ? 'valor_meta') then
      raise exception 'Item de meta incompleto (funil_id/tipo_meta/valor_meta obrigatórios).'
        using errcode = '23514';
    end if;

    begin
      v_funil_id := (v_item->>'funil_id')::uuid;
    exception when others then
      raise exception 'funil_id inválido: %', v_item->>'funil_id' using errcode = '23514';
    end;

    v_tipo_meta := v_item->>'tipo_meta';
    if v_tipo_meta not in ('tcv', 'mrr') then
      raise exception 'tipo_meta deve ser "tcv" ou "mrr" (veio %).', coalesce(v_tipo_meta, 'null')
        using errcode = '23514';
    end if;

    begin
      v_valor_meta := (v_item->>'valor_meta')::numeric;
    exception when others then
      raise exception 'valor_meta inválido para o funil % (%): %', v_funil_id, v_tipo_meta, v_item->>'valor_meta'
        using errcode = '23514';
    end;
    if v_valor_meta is null or v_valor_meta <= 0 then
      raise exception 'valor_meta deve ser maior que zero (funil %, %).', v_funil_id, v_tipo_meta
        using errcode = '23514';
    end if;

    if not exists (select 1 from public.funis f where f.id = v_funil_id and f.ativo) then
      raise exception 'Funil % não existe ou não está ativo.', v_funil_id using errcode = '23514';
    end if;

    v_chave := v_funil_id::text || ':' || v_tipo_meta;
    if v_chave = any (v_vistos) then
      raise exception 'Funil % duplicado para o tipo % no mesmo envio.', v_funil_id, v_tipo_meta
        using errcode = '23514';
    end if;
    v_vistos := array_append(v_vistos, v_chave);
  end loop;

  -- 2ª passada: tudo validado — agora grava todos os itens (mesma
  -- transação da chamada da função inteira; um erro aqui também desfaz
  -- qualquer item já gravado nesta mesma passada).
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_funil_id   := (v_item->>'funil_id')::uuid;
    v_tipo_meta  := v_item->>'tipo_meta';
    v_valor_meta := (v_item->>'valor_meta')::numeric;

    insert into public.metas (usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta)
    values (null, v_funil_id, v_mes, v_tipo_meta::public.tipo_venda, v_valor_meta)
    on conflict (usuario_id, funil_id, periodo_mes, tipo_meta)
    do update set valor_meta = excluded.valor_meta;

    v_salvos := v_salvos + 1;
  end loop;

  return v_salvos;
end;
$$;

comment on function public.salvar_metas_funis is
  'Salva (upsert) a meta mensal de TCV/MRR de um ou mais funis numa ÚNICA '
  'operação atômica — tudo-ou-nada: valida todos os itens de p_itens antes '
  'de escrever qualquer linha; qualquer item inválido aborta a função '
  'inteira, sem alteração parcial. usuario_id é sempre null (meta por '
  'funil é sempre da empresa). GERENTE apenas.';

revoke all on function public.salvar_metas_funis(date, jsonb) from public, anon;
grant execute on function public.salvar_metas_funis(date, jsonb) to authenticated;
