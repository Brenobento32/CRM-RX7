-- ===========================================================================
-- Teste de fumaça de `20261015120000_atividades_protege_insercao_por_permissao.sql`.
--
-- AUTO-INSTALAÇÃO TRANSACIONAL — mesmo padrão dos testes anteriores desta
-- rodada: instala temporariamente a policy nova (DROP+CREATE idêntico à
-- migration), cria fixtures, roda os asserts, e dá ROLLBACK — nada fica
-- gravado. Roda como `postgres` (bypassa RLS) até o `set local role
-- authenticated`, depois disso RLS real vale pra cada papel simulado via
-- `set_config('request.jwt.claims', ...)`.
--
-- O QUE ELE PROVA (mapeado nos 16 itens pedidos):
--   1  gerente insere observação sem nenhuma linha de permissão.
--   2  SDR pode_ver=true + pode_mover=true → consegue.
--   3  CLOSER pode_ver=true + pode_mover=true → consegue.
--   4  SDR pode_ver=true + pode_mover=false → 42501.
--   5  CLOSER pode_ver=true + pode_mover=false → 42501.
--   6  owner_id sozinho (sem nenhuma linha de permissão) → 42501.
--   7  observação com negociacao_id correto → sucesso, vinculada certa.
--   8  negociacao_id de outro cliente → bloqueado (trigger de integridade,
--      valida_negociacao_do_cliente, 23514 — dispara antes mesmo da RLS
--      avaliar, porque é BEFORE INSERT).
--   9  cliente sem negociação autorizada (negociacao_id null, nenhuma
--      negociação do cliente com pode_mover para o chamador) → 42501.
--  10  observação não altera a negociação (nenhuma coluna muda).
--  11  etapa_id não muda.
--  12  owner_id não muda.
--  13  valor_estimado não muda.
--  14  handoff (negociacoes_valida_handoff_sdr) continua intacto.
--  15  trigger de integridade (valida_negociacao_do_cliente) continua
--      intacta — é a mesma usada no item 8, não removida nem alterada.
--  16  GERENTE continua funcionando (mesmo item 1, reafirmado no fim).
--
-- Fluxo real da UI: não há teste de componente configurado neste projeto
-- (vitest só cobre lib/**/*.test.ts) — comportamento de botão
-- habilitado/desabilitado por pode_mover é verificado manualmente, ver
-- relatório desta rodada.
-- ===========================================================================

begin;

drop policy if exists atividades_insert on public.atividades;

create policy atividades_insert on public.atividades
  for insert
  to authenticated
  with check (
    usuario_id = (select auth.uid())
    and (
      public.is_gerente()
      or (
        negociacao_id is not null
        and exists (
          select 1 from public.negociacoes n
          where n.id = atividades.negociacao_id
            and n.cliente_id = atividades.cliente_id
            and public.pode_mover_etapa(n.funil_id, n.etapa_id)
        )
      )
      or (
        negociacao_id is null
        and exists (
          select 1 from public.negociacoes n
          where n.cliente_id = atividades.cliente_id
            and public.pode_mover_etapa(n.funil_id, n.etapa_id)
        )
      )
    )
  );

do $$
declare
  v_gerente   uuid := 'd0000000-0000-0000-0000-000000000001';
  v_sdr_ok    uuid := 'd0000000-0000-0000-0000-000000000002'; -- pode_ver+pode_mover
  v_sdr_so_ver uuid := 'd0000000-0000-0000-0000-000000000003'; -- só pode_ver
  v_closer_ok uuid := 'd0000000-0000-0000-0000-000000000004'; -- pode_ver+pode_mover
  v_closer_so_ver uuid := 'd0000000-0000-0000-0000-000000000005'; -- só pode_ver
  v_sdr_dono_sem_permissao uuid := 'd0000000-0000-0000-0000-000000000006'; -- owner_id do cliente, zero permissão

  v_funil uuid;
  v_etapa uuid;
  v_etapa2 uuid; -- mesma funil, sdr_ok NÃO tem permissão aqui

  v_cliente_a uuid;
  v_neg_a     uuid;
  v_cliente_b uuid;
  v_cliente_d uuid; -- owner_id = v_sdr_dono_sem_permissao
  v_cliente_c uuid; -- negociação em etapa sem permissão pra sdr_ok
  v_neg_c     uuid;

  v_etapa_antes uuid;
  v_owner_antes uuid;
  v_valor_antes numeric;
  v_atividade_id uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.teste.ativ@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste Ativ"}'::jsonb),
    (v_sdr_ok, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.ok.teste.ativ@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR OK Teste Ativ"}'::jsonb),
    (v_sdr_so_ver, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.ver.teste.ativ@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Ver Teste Ativ"}'::jsonb),
    (v_closer_ok, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.ok.teste.ativ@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer OK Teste Ativ"}'::jsonb),
    (v_closer_so_ver, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.ver.teste.ativ@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer Ver Teste Ativ"}'::jsonb),
    (v_sdr_dono_sem_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.dono.teste.ativ@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Dono Sem Permissao"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Ativ', false) returning id into v_funil;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_etapa;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Sem Permissao Sdr Ok', 'azul', 1000, 'aberta') returning id into v_etapa2;

  -- SDR/CLOSER "ok": pode_ver + pode_mover na etapa.
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_ok, v_funil, null, null, null, v_gerente),
    (v_sdr_ok, v_funil, v_etapa, true, true, v_gerente),
    (v_closer_ok, v_funil, null, null, null, v_gerente),
    (v_closer_ok, v_funil, v_etapa, true, true, v_gerente);

  -- SDR/CLOSER "só ver": pode_ver=true, pode_mover=false.
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_so_ver, v_funil, null, null, null, v_gerente),
    (v_sdr_so_ver, v_funil, v_etapa, true, false, v_gerente),
    (v_closer_so_ver, v_funil, null, null, null, v_gerente),
    (v_closer_so_ver, v_funil, v_etapa, true, false, v_gerente);

  -- Clientes/negociações de fixture (criados como postgres, bypassa RLS —
  -- só fixture, não é o que está sendo testado).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente A Ativ', v_gerente) returning id into v_cliente_a;
  insert into public.negociacoes (cliente_id, owner_id, funil_id, etapa_id, origem, valor_estimado)
    values (v_cliente_a, v_gerente, v_funil, v_etapa, 'manual', 1000)
    returning id into v_neg_a;

  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente B Ativ', v_gerente) returning id into v_cliente_b;
  insert into public.negociacoes (cliente_id, owner_id, funil_id, etapa_id, origem)
    values (v_cliente_b, v_gerente, v_funil, v_etapa, 'manual');

  -- Cliente cujo owner_id É o SDR sem nenhuma permissão — prova que
  -- owner_id sozinho não basta (item 6/9 do pedido original).
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente D Ativ', v_sdr_dono_sem_permissao) returning id into v_cliente_d;
  insert into public.negociacoes (cliente_id, owner_id, funil_id, etapa_id, origem)
    values (v_cliente_d, v_sdr_dono_sem_permissao, v_funil, v_etapa, 'manual');

  -- Cliente C: única negociação está numa etapa do MESMO funil onde
  -- sdr_ok não tem nenhuma linha de permissão — usado nos itens 8/9.
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente C Ativ', v_gerente) returning id into v_cliente_c;
  insert into public.negociacoes (cliente_id, owner_id, funil_id, etapa_id, origem)
    values (v_cliente_c, v_gerente, v_funil, v_etapa2, 'manual')
    returning id into v_neg_c;

  select etapa_id, owner_id, valor_estimado into v_etapa_antes, v_owner_antes, v_valor_antes
    from public.negociacoes where id = v_neg_a;

  execute 'set local role authenticated';

  -- =====================================================================
  -- 1. GERENTE adiciona observação sem nenhuma linha de permissão.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
    values (v_cliente_a, v_neg_a, 'nota', 'Observação do gerente', v_gerente)
    returning id into v_atividade_id;
  assert v_atividade_id is not null, 'GERENTE deveria conseguir registrar observação';
  raise notice 'ok 1  GERENTE registra observação sem permissão configurada';

  -- =====================================================================
  -- 2. SDR com pode_ver+pode_mover consegue.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_ok, 'role', 'authenticated')::text, true);
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
    values (v_cliente_a, v_neg_a, 'nota', 'Observação do SDR autorizado', v_sdr_ok)
    returning id into v_atividade_id;
  assert (select cliente_id from public.atividades where id = v_atividade_id) = v_cliente_a,
    'atividade deveria ficar vinculada ao cliente correto';
  assert (select negociacao_id from public.atividades where id = v_atividade_id) = v_neg_a,
    'atividade deveria ficar vinculada à negociação correta';
  raise notice 'ok 2/13  SDR autorizado (pode_ver+pode_mover) registra observação, vinculada certa';

  -- =====================================================================
  -- 3. CLOSER com pode_ver+pode_mover consegue, em negociação diferente.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_ok, 'role', 'authenticated')::text, true);
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
    values (v_cliente_a, v_neg_a, 'nota', 'Observação do closer autorizado', v_closer_ok);
  raise notice 'ok 3  CLOSER autorizado registra observação';

  -- =====================================================================
  -- 4. SDR com pode_ver=true e pode_mover=false é bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_so_ver, 'role', 'authenticated')::text, true);
  begin
    insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
      values (v_cliente_a, v_neg_a, 'nota', 'Não deveria existir', v_sdr_so_ver);
    assert false, 'SDR com só pode_ver não deveria conseguir registrar observação';
  exception when insufficient_privilege then
    raise notice 'ok 4  SDR só com pode_ver (sem pode_mover) é bloqueado (42501)';
  end;

  -- =====================================================================
  -- 5. CLOSER com pode_ver=true e pode_mover=false é bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_so_ver, 'role', 'authenticated')::text, true);
  begin
    insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
      values (v_cliente_a, v_neg_a, 'nota', 'Não deveria existir', v_closer_so_ver);
    assert false, 'CLOSER com só pode_ver não deveria conseguir registrar observação';
  exception when insufficient_privilege then
    raise notice 'ok 5  CLOSER só com pode_ver (sem pode_mover) é bloqueado (42501)';
  end;

  -- =====================================================================
  -- 6. owner_id do cliente, sem NENHUMA linha de permissão, não basta.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_dono_sem_permissao, 'role', 'authenticated')::text, true);
  begin
    insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
      values (v_cliente_d, (select id from public.negociacoes where cliente_id = v_cliente_d), 'nota', 'Não deveria existir', v_sdr_dono_sem_permissao);
    assert false, 'owner_id do cliente não deveria bypassar a exigência de permissão';
  exception when insufficient_privilege then
    raise notice 'ok 6  owner_id sozinho (sem permissoes_colaborador) não autoriza';
  end;

  -- =====================================================================
  -- 7. Observação com negociacao_id correto → sucesso (já provado no item
  -- 2 acima, reafirmado aqui com asserção explícita de vínculo).
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_ok, 'role', 'authenticated')::text, true);
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
    values (v_cliente_a, v_neg_a, 'nota', 'Observação com negociacao_id correto', v_sdr_ok)
    returning id into v_atividade_id;
  assert (select cliente_id from public.atividades where id = v_atividade_id) = v_cliente_a
     and (select negociacao_id from public.atividades where id = v_atividade_id) = v_neg_a,
    'observação com negociacao_id correto deveria ficar vinculada certa';
  raise notice 'ok 7  observação com negociacao_id correto: sucesso, vínculo certo';

  -- =====================================================================
  -- 8. negociacao_id de OUTRO cliente é bloqueado — pela trigger de
  -- integridade (valida_negociacao_do_cliente, 23514), que dispara antes
  -- mesmo da RLS ser avaliada.
  -- =====================================================================
  begin
    insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
      values (v_cliente_a, v_neg_c, 'nota', 'Não deveria existir', v_sdr_ok);
    assert false, 'negociacao_id de outro cliente não deveria ser aceito';
  exception when check_violation then
    raise notice 'ok 8  negociacao_id de outro cliente é bloqueado (23514, trigger de integridade)';
  end;

  -- =====================================================================
  -- 9. Cliente sem NENHUMA negociação autorizada (negociacao_id null,
  -- única negociação do cliente está numa etapa sem pode_mover pra
  -- sdr_ok) é bloqueado.
  -- =====================================================================
  begin
    insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
      values (v_cliente_c, null, 'nota', 'Não deveria existir', v_sdr_ok);
    assert false, 'cliente sem negociação autorizada não deveria aceitar observação';
  exception when insufficient_privilege then
    raise notice 'ok 9  cliente sem negociação autorizada (negociacao_id null) é bloqueado (42501)';
  end;

  -- =====================================================================
  -- 10/11/12/13. Registrar observação não altera a negociação de nenhuma
  -- forma — etapa_id, owner_id e valor_estimado inalterados.
  -- =====================================================================
  assert (
    select etapa_id = v_etapa_antes and owner_id = v_owner_antes and valor_estimado = v_valor_antes
      from public.negociacoes where id = v_neg_a
  ), 'registrar observação não deveria ter alterado etapa_id/owner_id/valor_estimado';
  raise notice 'ok 10/11/12/13  negociação inalterada (etapa_id/owner_id/valor_estimado)';

  -- =====================================================================
  -- 14. negociacoes_valida_handoff_sdr continua existindo (intacta).
  -- =====================================================================
  assert exists (
    select 1 from pg_trigger where tgname = 'negociacoes_valida_handoff_sdr' and not tgisinternal
  ), 'negociacoes_valida_handoff_sdr deveria continuar existindo';
  raise notice 'ok 14  negociacoes_valida_handoff_sdr intacta';

  -- =====================================================================
  -- 15. valida_negociacao_do_cliente (trigger de integridade) continua
  -- existindo — já demonstrada funcionando no item 8 acima.
  -- =====================================================================
  assert exists (
    select 1 from pg_trigger where tgname = 'atividades_negociacao_do_cliente' and not tgisinternal
  ), 'atividades_negociacao_do_cliente (valida_negociacao_do_cliente) deveria continuar existindo';
  raise notice 'ok 15  trigger de integridade cliente/negociação intacta';

  -- =====================================================================
  -- 16. GERENTE continua funcionando (reafirma o item 1, num cliente
  -- diferente, depois de toda a bateria de bloqueios acima).
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, usuario_id)
    values (v_cliente_c, v_neg_c, 'nota', 'Observação do gerente, de novo', v_gerente);
  raise notice 'ok 16  GERENTE continua funcionando normalmente';

  -- =====================================================================
  -- (RLS de outras tabelas intacta) negociacoes_update/clientes_update
  -- continuam só owner/gerente — não foram tocadas por esta migration.
  -- Por último de propósito: `reset role` derruba `authenticated` de volta
  -- pra `postgres`, e qualquer asserção de RLS depois disso seria inválida.
  -- =====================================================================
  execute 'reset role';
  assert (
    select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polname = 'negociacoes_update' and polrelid = 'public.negociacoes'::regclass
  ) = '((owner_id = ( SELECT auth.uid() AS uid)) OR is_gerente())',
    'negociacoes_update não deveria ter sido alterada';
  assert (
    select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polname = 'clientes_update' and polrelid = 'public.clientes'::regclass
  ) = '((owner_id = ( SELECT auth.uid() AS uid)) OR is_gerente())',
    'clientes_update não deveria ter sido alterada';
  raise notice 'ok extra  negociacoes_update/clientes_update continuam owner/gerente, intocadas (nenhum UPDATE concedido)';

  raise notice 'atividades_protege_insercao_por_permissao_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
