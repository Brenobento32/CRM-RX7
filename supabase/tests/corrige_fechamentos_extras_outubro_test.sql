-- ===========================================================================
-- Teste transacional da CORREÇÃO dos 2 fechamentos extras de outubro/2026
-- (20261019170000_anula_fechamentos_extras_outubro.sql) — contra dados REAIS
-- do banco linked, mas inteiramente dentro de BEGIN/ROLLBACK: nada permanece.
--
-- Instala primeiro uma cópia da infraestrutura de anulação (colunas +
-- funil_metricas atualizada) — as migrations ainda não foram aplicadas no
-- banco real — e só então roda uma cópia exata da lógica de
-- 20261019170000_anula_fechamentos_extras_outubro.sql contra os 2
-- negociacao_id reais. ROLLBACK ao final: os 2 registros voltam a existir
-- sem anulado_em (confirmado por uma consulta read-only separada, depois
-- deste arquivo).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Infraestrutura (cópia de 20261019160000_fechamentos_anulacao.sql — só
-- as colunas/constraint e a funil_metricas atualizada; não precisamos de
-- anular_fechamento()/guardas de fechar/atualizar aqui, esta correção é uma
-- migration de dados direta, não passa pela RPC).
-- ---------------------------------------------------------------------------
alter table public.fechamentos
  add column if not exists anulado_em      timestamptz null,
  add column if not exists motivo_anulacao text        null,
  add column if not exists anulado_por     uuid        null references public.profiles(id) on delete restrict;

alter table public.fechamentos drop constraint if exists fechamentos_anulacao_valida;
alter table public.fechamentos add constraint fechamentos_anulacao_valida check (
  (anulado_em is null and motivo_anulacao is null and anulado_por is null)
  or
  (anulado_em is not null and motivo_anulacao is not null and btrim(motivo_anulacao) <> '')
);

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
    select n.* from public.negociacoes n where n.funil_id = p_funil_id
  ),
  atuais_base as (
    select n.* from historico_base n
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    where n.arquivada_em is null and n.excluida_em is null
  ),
  atuais as (
    select n.etapa_id, count(*) as qtd, sum(n.valor_estimado) as valor,
      avg(extract(epoch from now() - n.data_entrada_etapa)) as parados,
      count(*) filter (where n.data_entrada_etapa < now() - interval '7 days') as parados_7
    from atuais_base n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta'
    group by n.etapa_id
  ),
  coorte as (
    select n.id from historico_base n, periodo
    where n.created_at >= periodo.inicio and n.created_at < periodo.fim
  ),
  total_entraram as (select count(*) as total from coorte),
  alcancaram as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id
    group by h.etapa_nova_id
  ),
  alcancaram_ganha_valido as (
    select h.etapa_nova_id as etapa_id, count(distinct h.negociacao_id) as qtd
    from public.historico_etapas h
    join coorte co on co.id = h.negociacao_id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.funil_id = p_funil_id and e.tipo = 'ganha'
    join public.fechamentos f on f.negociacao_id = h.negociacao_id and f.anulado_em is null
    group by h.etapa_nova_id
  ),
  ganhos_periodo as (
    select (select e.id from public.etapas_funil e where e.funil_id = p_funil_id and e.tipo = 'ganha') as etapa_id,
      count(*) as qtd, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join historico_base n on n.id = f.negociacao_id
    where f.data_fechamento between p_inicio and p_fim and f.anulado_em is null
  ),
  negociacoes_perdidas_periodo as (
    select distinct h.negociacao_id
    from public.historico_etapas h
    join public.etapas_funil e on e.id = h.etapa_nova_id
    cross join periodo
    where e.funil_id = p_funil_id and e.tipo = 'perdida'
      and h.created_at >= periodo.inicio and h.created_at < periodo.fim
  ),
  perdidos_periodo as (
    select (select e.id from public.etapas_funil e where e.funil_id = p_funil_id and e.tipo = 'perdida') as etapa_id,
      count(*) as qtd, sum(n.valor_estimado) as valor
    from negociacoes_perdidas_periodo p
    join historico_base n on n.id = p.negociacao_id
  ),
  estadias as (
    select h.etapa_nova_id as etapa_id, h.created_at as entrada,
      lead(h.created_at) over (partition by h.negociacao_id order by h.created_at, h.id) as saida
    from public.historico_etapas h
    join historico_base n on n.id = h.negociacao_id
  ),
  tempos as (
    select s.etapa_id, avg(extract(epoch from s.saida - s.entrada)) as media, count(*) as n
    from estadias s, periodo
    where s.saida is not null and s.saida >= periodo.inicio and s.saida < periodo.fim
    group by s.etapa_id
  )
  select
    e.id, e.nome, e.cor, e.tipo, e.ordem, e.pos_fechamento,
    case e.tipo when 'perdida' then coalesce(pp.qtd, 0) when 'ganha' then coalesce(gp.qtd, 0) else coalesce(a.qtd, 0) end,
    case e.tipo when 'perdida' then coalesce(pp.valor, 0) when 'ganha' then coalesce(gp.valor, 0) else coalesce(a.valor, 0) end,
    case when e.tipo = 'ganha' then coalesce(alg.qtd, 0) else coalesce(al.qtd, 0) end,
    t.media, coalesce(t.n, 0), a.parados, coalesce(a.parados_7, 0),
    (select total from total_entraram)
  from public.etapas_funil e
  left join atuais a on a.etapa_id = e.id
  left join alcancaram al on al.etapa_id = e.id
  left join alcancaram_ganha_valido alg on alg.etapa_id = e.id
  left join ganhos_periodo gp on gp.etapa_id = e.id
  left join perdidos_periodo pp on pp.etapa_id = e.id
  left join tempos t on t.etapa_id = e.id
  where e.ativo and e.funil_id = p_funil_id
  order by e.ordem;
$$;

-- ---------------------------------------------------------------------------
-- Teste em si.
-- ---------------------------------------------------------------------------
do $$
declare
  v_neg_duplicado constant uuid := '15f8ed44-36b1-4a1b-908f-5b2b31a708f6';
  v_neg_teste     constant uuid := 'a5c6b406-3941-4f3a-b743-b63c76219263';
  v_neg_legitimo  constant uuid := '30b3ebeb-81db-4cc3-b7a9-beb19cb44764';
  v_funil_out     constant uuid := '66823f97-5858-4f84-8ca7-125024c9bd0e';
  v_funil_inbound constant uuid := 'f2d5592f-ff88-4cf3-8f57-dce8c858be38';

  -- Antes.
  v_out_tcv_antes numeric; v_out_mrr_antes numeric; v_set_total_antes numeric;
  v_clientes_antes int; v_negociacoes_antes int;
  v_hist_dup_antes int; v_hist_teste_antes int; v_ativ_dup_antes int; v_ativ_teste_antes int;
  v_fechamentos_anulados_antes int;
  v_ganha_fo_antes record; v_ganha_fi_antes record;

  -- Pré-condições (iguais à migration real).
  v_valor numeric; v_tipo public.tipo_venda; v_data date; v_empresa text; v_arquivada timestamptz; v_anulado timestamptz;

  -- Depois.
  v_out_tcv_depois numeric; v_out_mrr_depois numeric; v_set_total_depois numeric;
  v_clientes_depois int; v_negociacoes_depois int;
  v_hist_dup_depois int; v_hist_teste_depois int; v_ativ_dup_depois int; v_ativ_teste_depois int;
  v_fechamentos_anulados_depois int;
  v_qtd_anuladas int; v_tcv_anulado numeric; v_mrr_anulado numeric;
  v_etapa_dup_antes uuid; v_etapa_dup_depois uuid; v_etapa_teste_antes uuid; v_etapa_teste_depois uuid;
  v_funil_dup_antes uuid; v_funil_dup_depois uuid; v_owner_dup_antes uuid; v_owner_dup_depois uuid;
  v_origem_dup_antes text; v_origem_dup_depois text;
  v_ganha_fo_depois record; v_ganha_fi_depois record;
  v_motivo_dup text; v_motivo_teste text; v_anulado_por_dup uuid; v_anulado_por_teste uuid;
begin
  -- -------------------------------------------------------------------
  -- 1. CAPTURA "ANTES" (dados reais).
  -- -------------------------------------------------------------------
  select coalesce(sum(valor_vendido) filter (where tipo_venda = 'tcv'), 0),
         coalesce(sum(valor_vendido) filter (where tipo_venda = 'mrr'), 0)
    into v_out_tcv_antes, v_out_mrr_antes
  from public.fechamentos
  where data_fechamento between '2026-10-01' and '2026-10-31' and anulado_em is null;

  select coalesce(sum(valor_vendido), 0) into v_set_total_antes
  from public.fechamentos where data_fechamento between '2026-09-01' and '2026-09-30';

  select count(*) into v_clientes_antes from public.clientes where id in (
    select cliente_id from public.negociacoes where id in (v_neg_duplicado, v_neg_teste)
  );
  select count(*) into v_negociacoes_antes from public.negociacoes where id in (v_neg_duplicado, v_neg_teste);
  select count(*) into v_hist_dup_antes from public.historico_etapas where negociacao_id = v_neg_duplicado;
  select count(*) into v_hist_teste_antes from public.historico_etapas where negociacao_id = v_neg_teste;
  select count(*) into v_ativ_dup_antes from public.atividades where negociacao_id = v_neg_duplicado;
  select count(*) into v_ativ_teste_antes from public.atividades where negociacao_id = v_neg_teste;
  select count(*) into v_fechamentos_anulados_antes from public.fechamentos where anulado_em is not null;

  select etapa_id, funil_id, owner_id, origem into v_etapa_dup_antes, v_funil_dup_antes, v_owner_dup_antes, v_origem_dup_antes
    from public.negociacoes where id = v_neg_duplicado;
  select etapa_id into v_etapa_teste_antes from public.negociacoes where id = v_neg_teste;

  select quantidade, valor, alcancaram, total_entraram into v_ganha_fo_antes
    from public.funil_metricas('2026-10-01', '2026-10-31', v_funil_out) where tipo = 'ganha';
  select quantidade, valor, alcancaram, total_entraram into v_ganha_fi_antes
    from public.funil_metricas('2026-10-01', '2026-10-31', v_funil_inbound) where tipo = 'ganha';

  assert v_negociacoes_antes = 2, format('esperava achar as 2 negociações, achei %', v_negociacoes_antes);
  assert v_fechamentos_anulados_antes = 0, 'não deveria haver nenhum fechamento anulado antes do teste';

  -- -------------------------------------------------------------------
  -- 2. Cópia exata da lógica de 20261019170000_anula_fechamentos_extras_outubro.sql.
  -- -------------------------------------------------------------------
  select f.valor_vendido, f.tipo_venda, f.data_fechamento, c.empresa, n.arquivada_em, f.anulado_em
    into v_valor, v_tipo, v_data, v_empresa, v_arquivada, v_anulado
  from public.fechamentos f
  join public.negociacoes n on n.id = f.negociacao_id
  join public.clientes c on c.id = n.cliente_id
  where f.negociacao_id = v_neg_duplicado;
  assert v_valor = 1500 and v_tipo = 'mrr' and v_data = '2026-10-14' and v_empresa = 'Colégio Batista' and v_arquivada is not null and v_anulado is null,
    'pré-condição do duplicado não confere';

  select f.valor_vendido, f.tipo_venda, f.data_fechamento, c.empresa, n.arquivada_em, f.anulado_em
    into v_valor, v_tipo, v_data, v_empresa, v_arquivada, v_anulado
  from public.fechamentos f
  join public.negociacoes n on n.id = f.negociacao_id
  join public.clientes c on c.id = n.cliente_id
  where f.negociacao_id = v_neg_teste;
  assert v_valor = 4800 and v_tipo = 'tcv' and v_data = '2026-10-14' and v_empresa = 'TESTE CRM - NAO ATENDER' and v_arquivada is not null and v_anulado is null,
    'pré-condição do registro de teste não confere';

  select f.valor_vendido, f.tipo_venda, f.data_fechamento, f.anulado_em into v_valor, v_tipo, v_data, v_anulado
  from public.fechamentos f where f.negociacao_id = v_neg_legitimo;
  assert v_valor = 1500 and v_tipo = 'mrr' and v_data = '2026-10-16' and v_anulado is null,
    'pré-condição do legítimo 16/10 não confere';

  update public.fechamentos
     set anulado_em = now(),
         motivo_anulacao = 'Duplicidade confirmada; fechamento válido do Colégio Batista preservado em 2026-10-16 (negociacao_id 30b3ebeb-81db-4cc3-b7a9-beb19cb44764).',
         anulado_por = null
   where negociacao_id = v_neg_duplicado;

  update public.fechamentos
     set anulado_em = now(),
         motivo_anulacao = 'Registro de teste ("TESTE CRM - NAO ATENDER"), não representa venda real.',
         anulado_por = null
   where negociacao_id = v_neg_teste;

  select count(*), coalesce(sum(valor_vendido) filter (where tipo_venda = 'tcv'), 0), coalesce(sum(valor_vendido) filter (where tipo_venda = 'mrr'), 0)
    into v_qtd_anuladas, v_tcv_anulado, v_mrr_anulado
  from public.fechamentos where negociacao_id in (v_neg_duplicado, v_neg_teste) and anulado_em is not null;
  assert v_qtd_anuladas = 2 and v_tcv_anulado = 4800 and v_mrr_anulado = 1500, 'resultado do DELETE/UPDATE de anulação não confere';

  -- -------------------------------------------------------------------
  -- 3. CAPTURA "DEPOIS" e verificações.
  -- -------------------------------------------------------------------
  select coalesce(sum(valor_vendido) filter (where tipo_venda = 'tcv'), 0),
         coalesce(sum(valor_vendido) filter (where tipo_venda = 'mrr'), 0)
    into v_out_tcv_depois, v_out_mrr_depois
  from public.fechamentos
  where data_fechamento between '2026-10-01' and '2026-10-31' and anulado_em is null;
  assert v_out_tcv_depois = 11800, format('OUTUBRO TCV válido deveria ser 11800, veio %', v_out_tcv_depois);
  assert v_out_mrr_depois = 6100, format('OUTUBRO MRR válido deveria ser 6100, veio %', v_out_mrr_depois);
  assert v_out_tcv_depois + v_out_mrr_depois = 17900, 'OUTUBRO total válido deveria ser 17900';
  assert v_out_tcv_antes - v_out_tcv_depois = 4800, 'TCV deveria ter caído exatamente 4800';
  assert v_out_mrr_antes - v_out_mrr_depois = 1500, 'MRR deveria ter caído exatamente 1500';

  select coalesce(sum(valor_vendido), 0) into v_set_total_depois
  from public.fechamentos where data_fechamento between '2026-09-01' and '2026-09-30';
  assert v_set_total_depois = 33650, format('SETEMBRO deveria continuar 33650, veio %', v_set_total_depois);
  assert v_set_total_depois = v_set_total_antes, 'SETEMBRO não deveria ter mudado nada';

  -- As 2 linhas continuam em fechamentos; só elas anuladas; motivos exatos; anulado_por null.
  assert (select count(*) from public.fechamentos where negociacao_id in (v_neg_duplicado, v_neg_teste)) = 2,
    'as 2 linhas de fechamentos deveriam continuar existindo';
  select count(*) into v_fechamentos_anulados_depois from public.fechamentos where anulado_em is not null;
  assert v_fechamentos_anulados_depois = 2, format('deveria haver exatamente 2 fechamentos anulados no banco inteiro, veio %', v_fechamentos_anulados_depois);

  select motivo_anulacao, anulado_por into v_motivo_dup, v_anulado_por_dup from public.fechamentos where negociacao_id = v_neg_duplicado;
  select motivo_anulacao, anulado_por into v_motivo_teste, v_anulado_por_teste from public.fechamentos where negociacao_id = v_neg_teste;
  assert v_motivo_dup ilike '%Duplicidade confirmada%', 'motivo do duplicado não confere';
  assert v_motivo_teste ilike '%Registro de teste%', 'motivo do teste não confere';
  assert v_anulado_por_dup is null and v_anulado_por_teste is null, 'anulado_por deveria ser NULL (correção sistêmica)';

  -- Legítimo de 16/10 ativo.
  assert (select anulado_em from public.fechamentos where negociacao_id = v_neg_legitimo) is null,
    'o fechamento legítimo de 16/10 foi anulado por engano';

  -- Clientes/negociações preservados, etapa/funil/owner/origem intactos.
  select count(*) into v_clientes_depois from public.clientes where id in (
    select cliente_id from public.negociacoes where id in (v_neg_duplicado, v_neg_teste)
  );
  assert v_clientes_depois = v_clientes_antes, 'quantidade de clientes mudou';
  select count(*) into v_negociacoes_depois from public.negociacoes where id in (v_neg_duplicado, v_neg_teste);
  assert v_negociacoes_depois = v_negociacoes_antes, 'quantidade de negociações mudou';

  select etapa_id, funil_id, owner_id, origem into v_etapa_dup_depois, v_funil_dup_depois, v_owner_dup_depois, v_origem_dup_depois
    from public.negociacoes where id = v_neg_duplicado;
  assert v_etapa_dup_depois = v_etapa_dup_antes, 'etapa_id do duplicado mudou';
  assert v_funil_dup_depois = v_funil_dup_antes, 'funil_id do duplicado mudou';
  assert v_owner_dup_depois = v_owner_dup_antes, 'owner_id do duplicado mudou';
  assert v_origem_dup_depois is not distinct from v_origem_dup_antes, 'origem do duplicado mudou';

  select etapa_id into v_etapa_teste_depois from public.negociacoes where id = v_neg_teste;
  assert v_etapa_teste_depois = v_etapa_teste_antes, 'etapa_id do registro de teste mudou';

  -- historico_etapas/atividades preservados (contagem idêntica).
  select count(*) into v_hist_dup_depois from public.historico_etapas where negociacao_id = v_neg_duplicado;
  select count(*) into v_hist_teste_depois from public.historico_etapas where negociacao_id = v_neg_teste;
  assert v_hist_dup_depois = v_hist_dup_antes, 'historico_etapas do duplicado mudou de quantidade';
  assert v_hist_teste_depois = v_hist_teste_antes, 'historico_etapas do teste mudou de quantidade';

  select count(*) into v_ativ_dup_depois from public.atividades where negociacao_id = v_neg_duplicado;
  select count(*) into v_ativ_teste_depois from public.atividades where negociacao_id = v_neg_teste;
  assert v_ativ_dup_depois = v_ativ_dup_antes, 'atividades do duplicado mudou de quantidade';
  assert v_ativ_teste_depois = v_ativ_teste_antes, 'atividades do teste mudou de quantidade';

  -- -------------------------------------------------------------------
  -- 4. Impacto no FUNIL DE CONVERSÃO (funil_metricas).
  -- -------------------------------------------------------------------
  select quantidade, valor, alcancaram, total_entraram into v_ganha_fo_depois
    from public.funil_metricas('2026-10-01', '2026-10-31', v_funil_out) where tipo = 'ganha';
  select quantidade, valor, alcancaram, total_entraram into v_ganha_fi_depois
    from public.funil_metricas('2026-10-01', '2026-10-31', v_funil_inbound) where tipo = 'ganha';

  assert v_ganha_fo_depois.total_entraram = v_ganha_fo_antes.total_entraram, 'total_entraram do Funil Out mudou (não deveria)';
  assert v_ganha_fi_depois.total_entraram = v_ganha_fi_antes.total_entraram, 'total_entraram do Funil Inbound mudou (não deveria)';
  assert v_ganha_fo_depois.quantidade = v_ganha_fo_antes.quantidade - 1,
    format('quantidade de ganhos válidos do Funil Out deveria cair 1 (duplicado), antes=%, depois=%', v_ganha_fo_antes.quantidade, v_ganha_fo_depois.quantidade);
  assert v_ganha_fi_depois.quantidade = v_ganha_fi_antes.quantidade - 1,
    format('quantidade de ganhos válidos do Funil Inbound deveria cair 1 (teste), antes=%, depois=%', v_ganha_fi_antes.quantidade, v_ganha_fi_depois.quantidade);
  assert v_ganha_fo_depois.valor = v_ganha_fo_antes.valor - 1500, 'valor de ganhos válidos do Funil Out deveria cair 1500';
  assert v_ganha_fi_depois.valor = v_ganha_fi_antes.valor - 4800, 'valor de ganhos válidos do Funil Inbound deveria cair 4800';
  -- alcancaram da etapa ganha (válido) também cai, mesma contagem que quantidade aqui (coorte de outubro cobre as duas negociações, criadas dentro do período).
  assert v_ganha_fo_depois.alcancaram <= v_ganha_fo_antes.alcancaram, 'alcançaram válido do Funil Out não pode aumentar';
  assert v_ganha_fi_depois.alcancaram <= v_ganha_fi_antes.alcancaram, 'alcançaram válido do Funil Inbound não pode aumentar';

  -- historico_etapas BRUTO (via EXISTS, sem filtro de anulação) continua
  -- registrando a entrada em 'ganha' pras duas — não removemos histórico.
  assert exists (
    select 1 from public.historico_etapas h
    join public.etapas_funil e on e.id = h.etapa_nova_id
    where h.negociacao_id = v_neg_duplicado and e.tipo = 'ganha'
  ), 'a passagem física por ganha do duplicado deveria continuar em historico_etapas';
  assert exists (
    select 1 from public.historico_etapas h
    join public.etapas_funil e on e.id = h.etapa_nova_id
    where h.negociacao_id = v_neg_teste and e.tipo = 'ganha'
  ), 'a passagem física por ganha do teste deveria continuar em historico_etapas';

  raise notice 'corrige_fechamentos_extras_outubro_test.sql: todas as asserções passaram. Outubro TCV=%, MRR=%; Setembro=%.',
    v_out_tcv_depois, v_out_mrr_depois, v_set_total_depois;
end;
$$;

set constraints all immediate;

rollback;
