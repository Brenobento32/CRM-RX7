-- ===========================================================================
-- M1 — Classificação estrutural dos registros: `escopo` = 'legado' | 'rx7'.
--
-- CONTEXTO: o CRM - RX7 nasceu de uma cópia dos dados do CRM anterior
-- (Scorpion). Esses registros são HISTÓRICO e não podem se misturar à operação
-- comercial nova (leads, WhatsApp, cadastro manual, métricas, metas). Esta
-- migration só cria a CLASSIFICAÇÃO; nenhuma regra passa a usá-la aqui.
--
-- O QUE FAZ: adiciona a coluna `escopo` nas 7 tabelas abaixo.
--   - Todas as linhas que JÁ EXISTEM passam a valer 'legado'.
--   - Toda linha criada DEPOIS desta migration nasce 'rx7'.
--
-- COMO, SEM TOCAR NAS LINHAS EXISTENTES:
--   `ADD COLUMN ... NOT NULL DEFAULT 'legado'` com default constante não
--   reescreve a tabela (Postgres 11+): o valor fica no catálogo e é lido por
--   todas as linhas já existentes. Não há UPDATE, nenhum trigger de linha
--   dispara (nenhum `updated_at` muda) e nenhum conteúdo é alterado. Em
--   seguida o default da coluna é trocado para 'rx7' — isso só vale para
--   linhas novas; as existentes continuam lendo 'legado'.
--
-- PRÉ-CONDIÇÃO (verificada pelo P0, fora desta migration): todo registro
-- existente no momento da aplicação é legado, e não há escrita no banco
-- durante a aplicação (janela de manutenção).
--
-- ATOMICIDADE: tudo roda dentro de UM bloco DO (uma única instrução): se
-- qualquer tabela falhar, nada fica classificado pela metade.
--
-- FORA DE ESCOPO (propositalmente): índices únicos, RLS, RPCs de ingestão e
-- de métricas, e qualquer filtro por `escopo` — isso é M2 em diante.
--
-- REVERSÃO: ver `docs/ISOLAMENTO-ESCOPO.md` (remover as colunas e as
-- constraints; só some o marcador, nenhum dado comercial).
-- ===========================================================================

do $$
declare
  v_tabelas text[] := array[
    'clientes',
    'negociacoes',
    'fechamentos',
    'metas',
    'conversas',
    'eventos',
    'eventos_series'
  ];
  v_tabela text;
  v_fora   bigint;
begin
  -- TRAVAS: cada ALTER TABLE precisa de lock exclusivo (por instantes, só
  -- metadado). Se alguma transação aberta segurar a tabela, em vez de esperar
  -- indefinidamente (e enfileirar as consultas novas atrás dele) a migration
  -- desiste em 5 s com erro 55P03 e DESFAZ TUDO; basta tentar de novo na
  -- janela de manutenção. Valem só dentro desta transação (is_local = true).
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '30s', true);

  foreach v_tabela in array v_tabelas loop
    -- 1. Coluna nova: NOT NULL, default constante 'legado' (sem reescrita).
    execute format(
      'alter table public.%I add column escopo text not null default %L',
      v_tabela, 'legado'
    );

    -- 2. Só 'legado' ou 'rx7'.
    execute format(
      'alter table public.%I add constraint %I check (escopo in (%L, %L))',
      v_tabela, v_tabela || '_escopo_check', 'legado', 'rx7'
    );

    -- 3. Daqui em diante, linhas novas nascem 'rx7'.
    execute format(
      'alter table public.%I alter column escopo set default %L',
      v_tabela, 'rx7'
    );

    execute format(
      'comment on column public.%I.escopo is %L',
      v_tabela,
      'Origem do registro: legado = herdado do CRM anterior (somente histórico); rx7 = criado na operação do CRM - RX7. Nunca NULL.'
    );
  end loop;

  -- 4. Conferência: logo após a migration, TODA linha existente tem que ser
  -- 'legado'. Se alguma tabela tiver outra coisa, aborta e desfaz tudo.
  foreach v_tabela in array v_tabelas loop
    execute format(
      'select count(*) from public.%I where escopo <> %L',
      v_tabela, 'legado'
    ) into v_fora;

    if v_fora <> 0 then
      raise exception 'M1 abortada: % linha(s) de % não ficaram como legado.', v_fora, v_tabela;
    end if;
  end loop;
end $$;
