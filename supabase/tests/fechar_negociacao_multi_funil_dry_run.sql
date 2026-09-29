-- ===========================================================================
-- Dry-run de "fechar_negociacao() escolhe a etapa ganha do funil certo"
-- (supabase/migrations/20260930120000_fechar_negociacao_multi_funil.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende da migration acima já ter sido aplicada: a própria transação
--   instala, temporariamente, a mesma definição de fechar_negociacao() —
--   byte a byte idêntica (copiada de lá). `create or replace function` é DDL
--   transacional no Postgres, então o ROLLBACK no fim desfaz a substituição
--   junto com todos os dados de teste. Nada fica gravado.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- O QUE ELE PROVA
--   B1: com 2+ funis, cada um tem sua própria etapa 'ganha' (índice único
--       por funil) — a função ANTIGA (subquery sem funil_id) encontraria
--       mais de uma linha e o Postgres levantaria cardinality_violation.
--       Prova que o bug era real, não hipotético.
--   F1: negociação do Funil Principal fecha na etapa ganha DO Principal.
--   F2: negociação do funil novo fecha na etapa ganha DO funil novo — o
--       caso que estava quebrado.
--   M1: mesma negociação/card (nenhuma linha nova), histórico ganha uma
--       entrada por fechamento, valor vendido e data de fechamento
--       gravados certos nos dois casos.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária: mesma definição da migration 20260930120000.
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
  p_link_contrato      text default null
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
    contrato_assinado, link_contrato, status_pagamento, status_onboarding
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Testes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente uuid := 'aaaaaaaa-1111-1111-1111-111111111111';
  v_closer  uuid := 'bbbbbbbb-1111-1111-1111-111111111111';

  v_funil_principal uuid;
  v_ganha_principal uuid;
  v_funil_novo      uuid;
  v_ganha_novo      uuid;

  v_cliente_principal uuid;
  v_cliente_novo      uuid;
  v_negociacao_principal uuid;
  v_negociacao_novo      uuid;

  v_total_ganha_global integer;

  v_neg_antes   integer;
  v_neg_depois  integer;
  v_hist_antes  integer;
  v_hist_depois integer;
  v_fech_antes  integer;
  v_fech_depois integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.fechar.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Fechar"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.fechar.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Fechar"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_principal from public.funis where padrao;
  select id into v_ganha_principal
    from public.etapas_funil where funil_id = v_funil_principal and tipo = 'ganha';

  select public.criar_funil(
    'Funil Dry-Run Fechar Multi',
    'Fechado — dry-run fechar', 'verde',
    'Perdido — dry-run fechar', 'vermelho',
    '[{"nome":"Contato — dry-run fechar","cor":"azul"}]'::jsonb
  ) into v_funil_novo;
  select id into v_ganha_novo
    from public.etapas_funil where funil_id = v_funil_novo and tipo = 'ganha';

  -- =========================================================================
  -- B1: confirma que o bug era real — 2+ linhas tipo='ganha' no sistema.
  -- =========================================================================
  select count(*) into v_total_ganha_global from public.etapas_funil where tipo = 'ganha';
  assert v_total_ganha_global >= 2,
    format('deveria haver pelo menos 2 etapas "ganha" no sistema (uma por funil), tem %s', v_total_ganha_global);
  raise notice 'ok  B1  2+ funis => a subquery antiga (sem funil_id) encontraria mais de uma "ganha" — bug confirmado como real';

  -- =========================================================================
  -- Massa de teste: uma negociação em cada funil.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Dry-Run Fechar Principal', 'Empresa A', v_closer)
  returning id into v_cliente_principal;
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Dry-Run Fechar Novo', 'Empresa B', v_closer)
  returning id into v_cliente_novo;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_principal, v_funil_principal, 5000.00, 'quente')
    into v_negociacao_principal;
  select public.criar_negociacao(v_cliente_novo, v_funil_novo, 6000.00, 'quente')
    into v_negociacao_novo;

  select count(*) into v_neg_antes  from public.negociacoes;
  select count(*) into v_hist_antes from public.historico_etapas;
  select count(*) into v_fech_antes from public.fechamentos;

  -- =========================================================================
  -- F1: negociação do Funil Principal fecha na etapa ganha DO Principal.
  -- =========================================================================
  perform public.fechar_negociacao(
    v_negociacao_principal, 1, 5500.00, current_date,
    true, true, 'pago', 'concluido'
  );
  assert (select etapa_id from public.negociacoes where id = v_negociacao_principal) = v_ganha_principal,
    'negociação do Principal deveria fechar na etapa ganha do Principal';
  assert (select valor_vendido from public.fechamentos where negociacao_id = v_negociacao_principal) = 5500.00,
    'valor_vendido deveria estar gravado certo (Principal)';
  assert (select data_fechamento from public.fechamentos where negociacao_id = v_negociacao_principal) = current_date,
    'data_fechamento deveria estar gravada certa (Principal)';
  raise notice 'ok  F1  negociação do Funil Principal fecha na etapa ganha do Principal';

  -- =========================================================================
  -- F2: negociação do funil NOVO fecha na etapa ganha DO funil novo — o caso
  -- que antes quebrava (subquery sem funil_id acharia 2 linhas e falharia).
  -- =========================================================================
  perform public.fechar_negociacao(
    v_negociacao_novo, 1, 6600.00, current_date,
    true, true, 'pago', 'concluido'
  );
  assert (select etapa_id from public.negociacoes where id = v_negociacao_novo) = v_ganha_novo,
    'negociação do funil novo deveria fechar na etapa ganha do funil novo';
  assert (select etapa_id from public.negociacoes where id = v_negociacao_novo) <> v_ganha_principal,
    'negociação do funil novo NUNCA deveria fechar na etapa ganha do Principal';
  assert (select valor_vendido from public.fechamentos where negociacao_id = v_negociacao_novo) = 6600.00,
    'valor_vendido deveria estar gravado certo (funil novo)';
  raise notice 'ok  F2  negociação do funil novo fecha na etapa ganha do funil novo (o caso que estava quebrado)';

  -- =========================================================================
  -- M1: mesma negociação/card, histórico preservado, nada duplicado.
  -- =========================================================================
  select count(*) into v_hist_depois from public.historico_etapas;
  assert v_hist_depois = v_hist_antes + 2,
    format('deveriam existir 2 linhas novas em historico_etapas (um fechamento por negociação), vieram %s',
           v_hist_depois - v_hist_antes);

  select count(*) into v_fech_depois from public.fechamentos;
  assert v_fech_depois = v_fech_antes + 2,
    format('deveriam existir 2 registros novos em fechamentos, vieram %s', v_fech_depois - v_fech_antes);

  select count(*) into v_neg_depois from public.negociacoes;
  assert v_neg_depois = v_neg_antes,
    format('não deveria haver negociação/card novo (antes=%s depois=%s)', v_neg_antes, v_neg_depois);
  assert (select count(*) from public.negociacoes where id in (v_negociacao_principal, v_negociacao_novo)) = 2,
    'as duas negociações de teste deveriam continuar existindo, cada uma como uma única linha';

  raise notice 'ok  M1  fechamento funciona nos dois funis: mesma negociação, histórico novo, valor/data certos, nenhuma duplicação';

  raise notice 'TODOS OS TESTES DE FECHAR NEGOCIACAO COM MULTIPLOS FUNIS PASSARAM (B1, F1, F2, M1)';
end $$;

select 'OK — TODOS OS TESTES DE FECHAR NEGOCIACAO COM MULTIPLOS FUNIS PASSARAM' as resultado;

rollback;
