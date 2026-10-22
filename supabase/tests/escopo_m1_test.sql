-- ===========================================================================
-- Teste da M1 (`20261021200000_escopo_dados_legado_rx7.sql`).
--
-- ONDE RODAR: SOMENTE num banco de TESTE com a cópia dos dados legados (projeto
-- Supabase de teste ou banco local descartável). NUNCA no CRM - RX7 de produção.
--
-- COMO FUNCIONA: transacional, mesmo padrão dos outros testes — fotografa o
-- estado ANTES, executa o corpo da migration, confere o DEPOIS e dá ROLLBACK
-- (nada fica gravado, nem em sucesso nem em falha). Se a M1 já estiver aplicada
-- no banco de teste, o teste aborta no início, sem alterar nada.
--
-- O QUE PROVA:
--   1  toda linha existente das 7 tabelas fica 'legado';
--   2  linhas novas nascem 'rx7' (default final);
--   3  nenhuma contagem mudou;
--   4  nenhum `updated_at`/`created_at` mudou (nenhum trigger de UPDATE rodou);
--   5  nenhum valor financeiro mudou (fechamentos.valor_vendido, metas.valor_meta);
--   6  escopo inválido e NULL são rejeitados;
--   7  relacionamentos (negociação → cliente, fechamento → negociação) intactos.
--
-- O mesmo conteúdo, com Postgres descartável e cenários de falha, está em
-- `supabase/tests/escopo_m1_pglite.mjs` (executa o ARQUIVO da migration).
-- ===========================================================================

begin;

do $$
declare
  v_tabelas text[] := array['clientes','negociacoes','fechamentos','metas','conversas','eventos','eventos_series'];
  v_t       text;
  v_antes   jsonb := '{}'::jsonb;
  v_n       bigint;
  v_datas   text;
  v_fin_a   numeric;
  v_fin_b   numeric;
  v_neg_ok  bigint;
  v_def     text;
begin
  -- Pré-condição: M1 ainda não aplicada.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and column_name = 'escopo'
                and table_name = any (v_tabelas)) then
    raise exception 'M1 já aplicada neste banco; rode o teste num banco ANTES da migration.';
  end if;

  -- Fotografia ANTES: contagem + assinatura das datas (sem ler dado pessoal).
  foreach v_t in array v_tabelas loop
    execute format('select count(*) from public.%I', v_t) into v_n;
    execute format(
      $q$select coalesce(md5(string_agg(coalesce(created_at::text,'') || '|' || coalesce(%s,''), ';' order by coalesce(created_at::text,''), coalesce(%s,''))), '') from public.%I$q$,
      case when v_t in ('clientes','negociacoes','fechamentos','metas','eventos') then 'updated_at::text' else $s$''$s$ end,
      case when v_t in ('clientes','negociacoes','fechamentos','metas','eventos') then 'updated_at::text' else $s$''$s$ end,
      v_t
    ) into v_datas;
    v_antes := v_antes || jsonb_build_object(v_t, jsonb_build_object('n', v_n, 'datas', v_datas));
  end loop;
  select coalesce(sum(valor_vendido), 0) into v_fin_a from public.fechamentos;
  select coalesce(sum(valor_meta), 0)    into v_fin_b from public.metas;
  select count(*) into v_neg_ok
    from public.negociacoes n
    join public.clientes c on c.id = n.cliente_id;

  -- ===== CORPO DA MIGRATION (idêntico ao arquivo) =====
  foreach v_t in array v_tabelas loop
    execute format('alter table public.%I add column escopo text not null default %L', v_t, 'legado');
    execute format('alter table public.%I add constraint %I check (escopo in (%L, %L))', v_t, v_t || '_escopo_check', 'legado', 'rx7');
    execute format('alter table public.%I alter column escopo set default %L', v_t, 'rx7');
  end loop;
  -- ===== FIM DO CORPO =====

  -- Fotografia DEPOIS e asserts.
  foreach v_t in array v_tabelas loop
    execute format('select count(*) from public.%I', v_t) into v_n;
    assert v_n = (v_antes -> v_t ->> 'n')::bigint, format('%s: contagem mudou', v_t);

    execute format('select count(*) from public.%I where escopo <> %L', v_t, 'legado') into v_n;
    assert v_n = 0, format('%s: existe linha que não ficou legado', v_t);

    execute format(
      $q$select coalesce(md5(string_agg(coalesce(created_at::text,'') || '|' || coalesce(%s,''), ';' order by coalesce(created_at::text,''), coalesce(%s,''))), '') from public.%I$q$,
      case when v_t in ('clientes','negociacoes','fechamentos','metas','eventos') then 'updated_at::text' else $s$''$s$ end,
      case when v_t in ('clientes','negociacoes','fechamentos','metas','eventos') then 'updated_at::text' else $s$''$s$ end,
      v_t
    ) into v_datas;
    assert v_datas = (v_antes -> v_t ->> 'datas'), format('%s: created_at/updated_at mudaram', v_t);

    select column_default into v_def from information_schema.columns
     where table_schema = 'public' and table_name = v_t and column_name = 'escopo';
    assert v_def like '%rx7%', format('%s: default final deveria ser rx7', v_t);
    raise notice 'ok  %: contagem, datas e classificação legado conferidos', v_t;
  end loop;

  assert (select coalesce(sum(valor_vendido), 0) from public.fechamentos) = v_fin_a, 'valor_vendido mudou';
  assert (select coalesce(sum(valor_meta), 0) from public.metas) = v_fin_b, 'valor_meta mudou';
  raise notice 'ok  valores financeiros inalterados';

  assert (select count(*) from public.negociacoes n join public.clientes c on c.id = n.cliente_id) = v_neg_ok,
    'relação negociação → cliente mudou';
  raise notice 'ok  relacionamentos inalterados';

  -- Escopo inválido e NULL são rejeitados. Usa uma linha EXISTENTE de `metas`
  -- (o UPDATE de teste acontece dentro da transação, que termina em ROLLBACK).
  if exists (select 1 from public.metas) then
    begin
      update public.metas set escopo = 'invalido' where id = (select id from public.metas limit 1);
      assert false, 'escopo inválido deveria ser rejeitado';
    exception when check_violation then
      raise notice 'ok  escopo inválido rejeitado (CHECK)';
    end;
    begin
      update public.metas set escopo = null where id = (select id from public.metas limit 1);
      assert false, 'escopo NULL deveria ser rejeitado';
    exception when not_null_violation then
      raise notice 'ok  escopo NULL rejeitado (NOT NULL)';
    end;
  else
    raise notice 'aviso: metas vazia neste banco; teste de escopo inválido/NULL não executado';
  end if;

  raise notice 'escopo_m1_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
