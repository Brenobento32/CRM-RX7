-- ===========================================================================
-- Teste de fumaça de
-- `20261015140000_criar_negociacao_protege_por_permissao.sql`.
--
-- AUTO-INSTALAÇÃO TRANSACIONAL — mesmo padrão dos testes anteriores:
-- instala temporariamente a função nova (CREATE OR REPLACE idêntico à
-- migration — sem DROP, assinatura igual), cria fixtures, roda os
-- asserts, dá ROLLBACK.
--
-- O QUE ELE PROVA:
--   1  GERENTE cria negociação pra cliente de outro dono, sem nenhuma
--      linha de permissão.
--   2  SDR com pode_mover_etapa na etapa inicial do funil escolhido cria
--      negociação pra cliente QUE NÃO É DELE (dono é outro usuário) —
--      o cerne da correção.
--   3  Mesma coisa pra CLOSER.
--   4  SDR sem NENHUMA permissão nesse funil é bloqueado (42501), mesmo
--      sendo owner_id do cliente — owner_id não é mais bypass.
--   5  SDR com permissão em OUTRO funil (não no escolhido) é bloqueado.
--   6  Negociação criada fica com cliente_id/funil_id/etapa_id corretos.
--   7  Cliente inexistente/excluído → P0002.
--   8  Funil inativo → P0002.
-- ===========================================================================

begin;

create or replace function public.criar_negociacao(
  p_cliente_id      uuid,
  p_funil_id        uuid,
  p_valor_estimado  numeric default null,
  p_temperatura     public.temperatura_negociacao default null,
  p_origem          public.origem_negociacao default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_negociacao_id uuid;
  v_etapa_id      uuid;
  v_cliente_existe boolean;
begin
  select true into v_cliente_existe
    from public.clientes c
   where c.id = p_cliente_id
     and c.deleted_at is null;

  if v_cliente_existe is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.funis f where f.id = p_funil_id and f.ativo) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  select e.id into v_etapa_id
    from public.etapas_funil e
   where e.funil_id = p_funil_id
     and e.tipo = 'aberta'
     and e.ativo
   order by e.ordem
   limit 1;

  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.'
      using errcode = '23514';
  end if;

  if not public.is_gerente() and not public.pode_mover_etapa(p_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para criar uma negociação para esse cliente.'
      using errcode = '42501';
  end if;

  v_negociacao_id := gen_random_uuid();

  insert into public.negociacoes (
    id, cliente_id, owner_id, etapa_id, valor_estimado, temperatura, origem
  )
  values (
    v_negociacao_id, p_cliente_id, (select auth.uid()), v_etapa_id,
    p_valor_estimado, p_temperatura, p_origem
  );

  return v_negociacao_id;
end;
$$;

do $$
declare
  v_gerente  uuid := 'e0000000-0000-0000-0000-000000000001';
  v_sdr_ok   uuid := 'e0000000-0000-0000-0000-000000000002'; -- pode_mover no funil/etapa certos
  v_closer_ok uuid := 'e0000000-0000-0000-0000-000000000003'; -- idem
  v_sdr_sem_permissao uuid := 'e0000000-0000-0000-0000-000000000004'; -- zero permissão, mas é owner_id do cliente
  v_sdr_outro_funil uuid := 'e0000000-0000-0000-0000-000000000005'; -- permissão só em outro funil

  v_funil_a uuid;
  v_etapa_a uuid;
  v_funil_b uuid;
  v_etapa_b uuid;

  v_cliente uuid; -- owner_id = v_sdr_sem_permissao, de propósito
  v_cliente_excluido uuid;

  v_neg uuid;
  v_erro text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.teste.negocia@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste Negocia"}'::jsonb),
    (v_sdr_ok, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.ok.teste.negocia@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR OK Teste Negocia"}'::jsonb),
    (v_closer_ok, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.ok.teste.negocia@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer OK Teste Negocia"}'::jsonb),
    (v_sdr_sem_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.sem.teste.negocia@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Sem Permissao Negocia"}'::jsonb),
    (v_sdr_outro_funil, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.outro.teste.negocia@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Outro Funil Negocia"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Negocia A', false) returning id into v_funil_a;
  insert into public.funis (nome, padrao) values ('Teste Negocia B', false) returning id into v_funil_b;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_a, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_etapa_a;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_b, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_etapa_b;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_ok, v_funil_a, null, null, null, v_gerente),
    (v_sdr_ok, v_funil_a, v_etapa_a, true, true, v_gerente),
    (v_closer_ok, v_funil_a, null, null, null, v_gerente),
    (v_closer_ok, v_funil_a, v_etapa_a, true, true, v_gerente),
    (v_sdr_outro_funil, v_funil_b, null, null, null, v_gerente),
    (v_sdr_outro_funil, v_funil_b, v_etapa_b, true, true, v_gerente);

  -- Cliente cujo DONO é o SDR sem permissão — prova que owner_id não basta mais.
  insert into public.clientes (tipo_cliente, nome, owner_id) values ('pessoa_fisica', 'Cliente Negocia', v_sdr_sem_permissao) returning id into v_cliente;

  insert into public.clientes (tipo_cliente, nome, owner_id, deleted_at) values ('pessoa_fisica', 'Cliente Excluido Negocia', v_gerente, now()) returning id into v_cliente_excluido;

  execute 'set local role authenticated';

  -- =====================================================================
  -- 1. GERENTE cria pra cliente de outro dono, sem nenhuma permissão.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente, v_funil_a) into v_neg;
  assert v_neg is not null, 'GERENTE deveria conseguir criar a negociação';
  raise notice 'ok 1  GERENTE cria negociação pra cliente de outro dono, sem permissão configurada';

  -- =====================================================================
  -- 2. SDR com pode_mover no funil/etapa certos cria pra cliente de OUTRO dono.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_ok, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente, v_funil_a) into v_neg;
  assert (select cliente_id from public.negociacoes where id = v_neg) = v_cliente
     and (select funil_id from public.negociacoes where id = v_neg) = v_funil_a
     and (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_a,
    'negociação deveria estar vinculada ao cliente/funil/etapa certos';
  raise notice 'ok 2/6  SDR com pode_mover cria negociação pra cliente que não é dono, vínculo certo';

  -- =====================================================================
  -- 3. CLOSER com a mesma permissão também consegue.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_ok, 'role', 'authenticated')::text, true);
  perform public.criar_negociacao(v_cliente, v_funil_a);
  raise notice 'ok 3  CLOSER com pode_mover também consegue';

  -- =====================================================================
  -- 4. owner_id sem NENHUMA permissão é bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_sem_permissao, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_negociacao(v_cliente, v_funil_a);
    assert false, 'owner_id sozinho não deveria bastar';
  exception when insufficient_privilege then
    raise notice 'ok 4  owner_id sem permissão é bloqueado (42501) — owner_id não é mais bypass';
  end;

  -- =====================================================================
  -- 5. SDR com permissão só em OUTRO funil é bloqueado neste.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_outro_funil, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_negociacao(v_cliente, v_funil_a);
    assert false, 'permissão em outro funil não deveria autorizar aqui';
  exception when insufficient_privilege then
    raise notice 'ok 5  permissão em outro funil não autoriza neste';
  end;

  -- =====================================================================
  -- 7. Cliente excluído (soft delete) → P0002.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_negociacao(v_cliente_excluido, v_funil_a);
    assert false, 'cliente excluído não deveria aceitar negociação nova';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    assert v_erro like '%Cliente não encontrado%', format('mensagem inesperada: %s', v_erro);
    raise notice 'ok 7  cliente excluído: P0002 "Cliente não encontrado"';
  end;

  -- =====================================================================
  -- 8. Funil inativo → P0002.
  -- =====================================================================
  update public.funis set ativo = false where id = v_funil_b;
  begin
    perform public.criar_negociacao(v_cliente, v_funil_b);
    assert false, 'funil inativo não deveria aceitar negociação nova';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    assert v_erro like '%Funil não encontrado ou desativado%', format('mensagem inesperada: %s', v_erro);
    raise notice 'ok 8  funil inativo: P0002 "Funil não encontrado ou desativado"';
  end;

  raise notice 'criar_negociacao_protege_por_permissao_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
