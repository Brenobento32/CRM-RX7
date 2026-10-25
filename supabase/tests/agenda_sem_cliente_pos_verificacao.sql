-- ===========================================================================
-- Pós-verificação SOMENTE LEITURA da migration 20261026100000_agenda_sem_cliente
-- no Supabase de produção. Não grava nada. Rodar logo depois de aplicar:
--   supabase db query --linked --project-ref ybgzlxgeoiggmfdxarqx \
--     --output-format json --file supabase/tests/agenda_sem_cliente_pos_verificacao.sql
--
-- Esperado (antes da migration, em 25/10/2026: 35 eventos, 0 séries):
--   migration_registrada = true
--   cliente_opcional_eventos = 'YES', cliente_opcional_series = 'YES'
--   tenant_obrigatorio_eventos = 'NO', tenant_obrigatorio_series = 'NO'
--   triggers_padrao = 2, ordem_ok = true
--   eventos >= 35, eventos_sem_tenant = 0
--   policies_series_com_cliente_opcional = 2
-- ===========================================================================
select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20261026100000') as migration_registrada,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'eventos' and column_name = 'cliente_id') as cliente_opcional_eventos,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'eventos_series' and column_name = 'cliente_id') as cliente_opcional_series,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'eventos' and column_name = 'tenant_id') as tenant_obrigatorio_eventos,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'eventos_series' and column_name = 'tenant_id') as tenant_obrigatorio_series,
  (select count(*) from pg_trigger
    where tgname = '_tenant_05_padrao'
      and tgrelid in ('public.eventos'::regclass, 'public.eventos_series'::regclass)) as triggers_padrao,
  -- _tenant_05_padrao roda antes de _tenant_10_derivar (ordem alfabética dos triggers BEFORE).
  ('_tenant_05_padrao' < '_tenant_10_derivar') as ordem_ok,
  (select count(*) from public.eventos) as eventos,
  (select count(*) from public.eventos where tenant_id is null) as eventos_sem_tenant,
  (select count(*) from pg_policies
    where tablename = 'eventos_series' and policyname in ('eventos_series_insert', 'eventos_series_update')
      and coalesce(with_check, '') like '%cliente_id IS NULL%') as policies_series_com_cliente_opcional;
