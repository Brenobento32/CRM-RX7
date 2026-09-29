-- ===========================================================================
-- Dry-run de "marcarPerdida() escolhe a etapa perdida do funil certo"
-- (correção em lib/dal/funil.ts — só TypeScript, sem migration).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. Cria um
--   segundo funil de teste (`criar_funil`), reproduz exatamente as duas
--   consultas que marcarPerdida() agora faz (funil_id da negociação, depois
--   a etapa 'perdida' DESSE funil) e o UPDATE final, para as duas
--   negociações de teste (uma em cada funil). ROLLBACK no final: nada fica
--   gravado.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- O QUE ELE PROVA
--   B1: com 2+ funis, cada um tem sua própria etapa 'perdida' (índice único
--       por funil) — ou seja, a consulta ANTIGA (`tipo='perdida'` sem
--       `funil_id`, com `.single()`) encontraria mais de uma linha e
--       falharia. Prova que o bug era real, não hipotético.
--   F1: a negociação do Funil Principal resolve pra a etapa 'perdida' DO
--       Funil Principal (nunca a do funil novo).
--   F2: a negociação do funil novo resolve pra a etapa 'perdida' DO funil
--       novo (nunca a do Principal) — o caso que estava quebrado.
--   M1: o UPDATE final (mesma negociação, motivo_perda, historico_etapas)
--       funciona igual pros dois funis, sem criar negociação/card novo.
-- ===========================================================================

begin;

do $$
declare
  v_gerente     uuid := '88888888-8888-8888-8888-888888888888';
  v_closer      uuid := '99999999-9999-9999-9999-999999999999';

  v_funil_principal   uuid;
  v_perdida_principal uuid;
  v_funil_novo        uuid;
  v_perdida_novo      uuid;

  v_cliente_principal uuid;
  v_cliente_novo      uuid;
  v_negociacao_principal uuid;
  v_negociacao_novo      uuid;

  v_funil_encontrado  uuid;
  v_perdida_encontrada uuid;

  v_total_perdida_global integer;
  v_hist_antes  integer;
  v_hist_depois integer;
  v_neg_antes   integer;
  v_neg_depois  integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.perdida.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Perdida"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.perdida.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Perdida"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_principal from public.funis where padrao;
  select id into v_perdida_principal
    from public.etapas_funil where funil_id = v_funil_principal and tipo = 'perdida';

  -- Segundo funil, com sua própria etapa perdida (criar_funil já garante isso).
  select public.criar_funil(
    'Funil Dry-Run Perdida Multi',
    'Fechado — dry-run perdida', 'verde',
    'Perdido — dry-run perdida', 'vermelho',
    '[{"nome":"Contato — dry-run perdida","cor":"azul"}]'::jsonb
  ) into v_funil_novo;
  select id into v_perdida_novo
    from public.etapas_funil where funil_id = v_funil_novo and tipo = 'perdida';

  -- =========================================================================
  -- B1: confirma que o bug era real — 2+ linhas tipo='perdida' no sistema.
  -- =========================================================================
  select count(*) into v_total_perdida_global from public.etapas_funil where tipo = 'perdida';
  assert v_total_perdida_global >= 2,
    format('deveria haver pelo menos 2 etapas "perdida" no sistema (uma por funil), tem %s',
           v_total_perdida_global);
  raise notice 'ok  B1  2+ funis => a consulta antiga (sem funil_id) encontraria mais de uma "perdida" — bug confirmado como real';

  -- =========================================================================
  -- Massa de teste: uma negociação em cada funil.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Dry-Run Perdida Principal', 'Empresa A', v_closer)
  returning id into v_cliente_principal;
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Dry-Run Perdida Novo', 'Empresa B', v_closer)
  returning id into v_cliente_novo;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_principal, v_funil_principal, 3000.00, 'morno')
    into v_negociacao_principal;
  select public.criar_negociacao(v_cliente_novo, v_funil_novo, 4000.00, 'morno')
    into v_negociacao_novo;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select count(*) into v_neg_antes from public.negociacoes;
  select count(*) into v_hist_antes from public.historico_etapas;

  -- =========================================================================
  -- F1: negociação do Funil Principal resolve pra "perdida" DO Principal.
  -- Mesmas duas consultas que marcarPerdida() faz agora.
  -- =========================================================================
  select funil_id into v_funil_encontrado
    from public.negociacoes where id = v_negociacao_principal;
  assert v_funil_encontrado = v_funil_principal, 'funil_id da negociação principal deveria ser o Funil Principal';

  select id into v_perdida_encontrada
    from public.etapas_funil
   where funil_id = v_funil_encontrado and tipo = 'perdida';
  assert v_perdida_encontrada = v_perdida_principal,
    'a etapa perdida encontrada deveria ser a do Funil Principal, não a de outro funil';
  raise notice 'ok  F1  negociação do Funil Principal resolve pra "perdida" do Principal (nunca a do funil novo)';

  -- =========================================================================
  -- F2: negociação do funil NOVO resolve pra "perdida" DO funil novo — o
  -- caso que antes quebrava (a consulta antiga, sem funil_id, acharia 2
  -- linhas e falharia com .single()).
  -- =========================================================================
  select funil_id into v_funil_encontrado
    from public.negociacoes where id = v_negociacao_novo;
  assert v_funil_encontrado = v_funil_novo, 'funil_id da negociação nova deveria ser o funil novo';

  select id into v_perdida_encontrada
    from public.etapas_funil
   where funil_id = v_funil_encontrado and tipo = 'perdida';
  assert v_perdida_encontrada = v_perdida_novo,
    'a etapa perdida encontrada deveria ser a do funil novo, não a do Funil Principal';
  assert v_perdida_encontrada <> v_perdida_principal,
    'a etapa perdida do funil novo nunca pode ser a mesma do Funil Principal';
  raise notice 'ok  F2  negociação do funil novo resolve pra "perdida" do funil novo (o caso que estava quebrado)';

  -- =========================================================================
  -- M1: UPDATE final — mesma negociação, motivo_perda, historico_etapas,
  -- sem criar negociação/card novo. Roda pros dois funis.
  -- =========================================================================
  update public.negociacoes
     set etapa_id = v_perdida_principal, motivo_perda = 'Motivo dry-run — funil principal', posicao = 1
   where id = v_negociacao_principal;
  update public.negociacoes
     set etapa_id = v_perdida_novo, motivo_perda = 'Motivo dry-run — funil novo', posicao = 1
   where id = v_negociacao_novo;

  assert (select etapa_id from public.negociacoes where id = v_negociacao_principal) = v_perdida_principal,
    'negociação do Principal deveria estar na etapa perdida do Principal';
  assert (select etapa_id from public.negociacoes where id = v_negociacao_novo) = v_perdida_novo,
    'negociação do funil novo deveria estar na etapa perdida do funil novo';
  assert (select motivo_perda from public.negociacoes where id = v_negociacao_principal) is not null,
    'motivo_perda deveria estar gravado (Principal)';
  assert (select motivo_perda from public.negociacoes where id = v_negociacao_novo) is not null,
    'motivo_perda deveria estar gravado (funil novo)';

  select count(*) into v_hist_depois from public.historico_etapas;
  assert v_hist_depois = v_hist_antes + 2,
    format('deveriam existir 2 linhas novas em historico_etapas (uma por negociação marcada perdida), vieram %s',
           v_hist_depois - v_hist_antes);

  select count(*) into v_neg_depois from public.negociacoes;
  assert v_neg_depois = v_neg_antes,
    format('não deveria haver negociação/card novo (antes=%s depois=%s)', v_neg_antes, v_neg_depois);

  raise notice 'ok  M1  marcar como perdida funciona nos dois funis: mesma negociação, motivo gravado, histórico novo, nenhuma duplicação';

  raise notice 'TODOS OS TESTES DE MARCAR PERDIDA COM MULTIPLOS FUNIS PASSARAM (B1, F1, F2, M1)';
end $$;

select 'OK — TODOS OS TESTES DE MARCAR PERDIDA COM MULTIPLOS FUNIS PASSARAM' as resultado;

rollback;
