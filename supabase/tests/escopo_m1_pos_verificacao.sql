-- ===========================================================================
-- M1 — PÓS-VERIFICAÇÃO (SOMENTE LEITURA). Rodar logo DEPOIS de aplicar a M1.
-- TODAS as linhas devem vir com ok = true. Se alguma vier false: ver "critérios
-- de parada" e a reversão em docs/RUNBOOK-M1.md.
-- ===========================================================================
with tab(tabela) as (
  values ('clientes'), ('negociacoes'), ('fechamentos'), ('metas'), ('conversas'), ('eventos'), ('eventos_series')
),
base(tabela, esperado) as (
  values ('clientes', 74), ('negociacoes', 79), ('fechamentos', 14), ('metas', 9),
         ('atividades', 69), ('eventos', 35), ('conversas', 5), ('historico_etapas', 188)
),
contagem as (
  select tabela, esperado,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tabela), false, true, '')))[1]::text::int as atual
    from base
),
classif as (
  select tabela,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tabela), false, true, '')))[1]::text::int as total,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where escopo = %L', tabela, 'legado'), false, true, '')))[1]::text::int as legado,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where escopo = %L', tabela, 'rx7'), false, true, '')))[1]::text::int as rx7
    from tab
)
select 'contagem inalterada ' || tabela as verificacao, esperado::text as esperado, atual::text as atual, (atual = esperado) as ok
  from contagem
union all
select 'escopo ' || tabela || ': todas as linhas = legado, nenhuma rx7', 'total=' || total, 'legado=' || legado || ' rx7=' || rx7, (legado = total and rx7 = 0)
  from classif
union all
select 'default final rx7 e NOT NULL em ' || t.tabela, 'rx7 / NO',
       coalesce(c.column_default, 'sem coluna') || ' / ' || coalesce(c.is_nullable, '-'),
       coalesce(c.column_default like '%rx7%' and c.is_nullable = 'NO', false)
  from tab t
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = t.tabela and c.column_name = 'escopo'
union all
select 'constraint ' || t.tabela || '_escopo_check validada', 'existe', case when k.conname is null then 'ausente' else 'existe' end, coalesce(k.convalidated, false)
  from tab t
  left join pg_constraint k on k.conname = t.tabela || '_escopo_check' and k.conrelid = ('public.' || t.tabela)::regclass
union all
select 'nenhum UPDATE disparou (updated_at > corte)', '0',
       ((select count(*) from public.clientes where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.negociacoes where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.fechamentos where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.metas where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.eventos where updated_at > timestamptz '2026-10-21 21:00:00+00'))::text,
       ((select count(*) from public.clientes where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.negociacoes where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.fechamentos where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.metas where updated_at > timestamptz '2026-10-21 21:00:00+00')
      + (select count(*) from public.eventos where updated_at > timestamptz '2026-10-21 21:00:00+00')) = 0
union all
select 'faturamento 2026-09', '33650.00', coalesce(sum(valor_vendido), 0)::numeric(12,2)::text, coalesce(sum(valor_vendido), 0) = 33650
  from public.fechamentos
 where anulado_em is null and to_char(coalesce(data_fechamento::timestamp, fechado_em), 'YYYY-MM') = '2026-09'
union all
select 'faturamento 2026-10', '17900.00', coalesce(sum(valor_vendido), 0)::numeric(12,2)::text, coalesce(sum(valor_vendido), 0) = 17900
  from public.fechamentos
 where anulado_em is null and to_char(coalesce(data_fechamento::timestamp, fechado_em), 'YYYY-MM') = '2026-10'
union all
select 'órfãos', '0',
       ((select count(*) from public.negociacoes n where not exists (select 1 from public.clientes c where c.id = n.cliente_id))
      + (select count(*) from public.fechamentos f where not exists (select 1 from public.negociacoes n where n.id = f.negociacao_id)))::text,
       ((select count(*) from public.negociacoes n where not exists (select 1 from public.clientes c where c.id = n.cliente_id))
      + (select count(*) from public.fechamentos f where not exists (select 1 from public.negociacoes n where n.id = f.negociacao_id))) = 0
union all
select 'triggers de usuário no schema public (todos ligados)', '48', count(*)::text, count(*) = 48 and bool_and(t.tgenabled = 'O')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'constraints NOT VALID no schema public (as mesmas 2 de antes)', '2', count(*)::text, count(*) = 2
  from pg_constraint where not convalidated and connamespace = 'public'::regnamespace
union all
select 'migrations 20261021190000 e 20261021200000 registradas no histórico (2 linhas)', '2', count(*)::text, count(*) = 2
  from supabase_migrations.schema_migrations where version in ('20261021190000', '20261021200000')
order by 1;
