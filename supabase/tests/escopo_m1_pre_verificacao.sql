-- ===========================================================================
-- M1 — PRÉ-VERIFICAÇÃO (SOMENTE LEITURA). Rodar no SQL Editor do CRM-RX7 logo
-- antes de aplicar a M1. TODAS as linhas devem vir com ok = true.
-- Se qualquer linha vier false: NÃO APLICAR; ver "critérios de parada" em
-- docs/RUNBOOK-M1.md.
-- Corte = 21/10/2026 21:00 UTC (antes da cópia dos dados legados).
-- ===========================================================================
with base(tabela, esperado) as (
  values ('clientes', 74), ('negociacoes', 79), ('fechamentos', 14), ('metas', 9),
         ('atividades', 69), ('eventos', 35), ('conversas', 5), ('historico_etapas', 188)
),
contagem as (
  select tabela, esperado,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tabela), false, true, '')))[1]::text::int as atual
    from base
),
corte as (select timestamptz '2026-10-21 21:00:00+00' as t)
select 'contagem ' || tabela as verificacao, esperado::text as esperado, atual::text as atual, (atual = esperado) as ok
  from contagem
union all
select 'nenhuma das 7 tabelas tem a coluna escopo', '0', count(*)::text, count(*) = 0
  from information_schema.columns
 where table_schema = 'public' and column_name = 'escopo'
   and table_name in ('clientes','negociacoes','fechamentos','metas','conversas','eventos','eventos_series')
union all
select 'registros criados ou alterados após o corte', '0',
       (  (select count(*) from public.clientes, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.negociacoes, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.fechamentos, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.metas, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.eventos, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.conversas, corte where created_at > corte.t or ultima_mensagem_em > corte.t)
        + (select count(*) from public.atividades, corte where created_at > corte.t)
        + (select count(*) from public.historico_etapas, corte where created_at > corte.t))::text,
       (  (select count(*) from public.clientes, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.negociacoes, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.fechamentos, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.metas, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.eventos, corte where created_at > corte.t or updated_at > corte.t)
        + (select count(*) from public.conversas, corte where created_at > corte.t or ultima_mensagem_em > corte.t)
        + (select count(*) from public.atividades, corte where created_at > corte.t)
        + (select count(*) from public.historico_etapas, corte where created_at > corte.t)) = 0
union all
select 'faturamento 2026-09 (fechamentos não anulados)', '33650.00',
       coalesce(sum(valor_vendido), 0)::numeric(12,2)::text,
       coalesce(sum(valor_vendido), 0) = 33650
  from public.fechamentos
 where anulado_em is null and to_char(coalesce(data_fechamento::timestamp, fechado_em), 'YYYY-MM') = '2026-09'
union all
select 'faturamento 2026-10 (fechamentos não anulados)', '17900.00',
       coalesce(sum(valor_vendido), 0)::numeric(12,2)::text,
       coalesce(sum(valor_vendido), 0) = 17900
  from public.fechamentos
 where anulado_em is null and to_char(coalesce(data_fechamento::timestamp, fechado_em), 'YYYY-MM') = '2026-10'
union all
select 'órfãos (negociação sem cliente + fechamento sem negociação)', '0',
       ((select count(*) from public.negociacoes n where not exists (select 1 from public.clientes c where c.id = n.cliente_id))
      + (select count(*) from public.fechamentos f where not exists (select 1 from public.negociacoes n where n.id = f.negociacao_id)))::text,
       ((select count(*) from public.negociacoes n where not exists (select 1 from public.clientes c where c.id = n.cliente_id))
      + (select count(*) from public.fechamentos f where not exists (select 1 from public.negociacoes n where n.id = f.negociacao_id))) = 0
union all
select 'triggers de usuário no schema public (todos ligados)', '48', count(*)::text, count(*) = 48 and bool_and(t.tgenabled = 'O')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'constraints NOT VALID no schema public (esperadas: clientes_documento_por_tipo e clientes_telefone_formato)', '2', count(*)::text, count(*) = 2
  from pg_constraint where not convalidated and connamespace = 'public'::regnamespace
order by 1;

-- ---------------------------------------------------------------------------
-- INFORMATIVO (rodar SEPARADO, logo antes de aplicar): quem está conectado e
-- escrevendo agora? Esperado: só a sua própria sessão e sessões internas.
--
--   select pid, usename, application_name, state, left(query, 60) as consulta
--     from pg_stat_activity
--    where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle';
-- ---------------------------------------------------------------------------
