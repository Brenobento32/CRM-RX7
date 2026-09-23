-- ===========================================================================
-- Teste de fumaça da RLS do Scorpion CRM.
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--   Ele cria três usuários de teste, faz as asserções e dá ROLLBACK no final:
--   nada é gravado. Se alguma asserção falhar, a execução para com erro.
--
-- O QUE ELE PROVA
--   Que a regra "closer vê apenas o que é dele" está no banco, e não apenas
--   na aplicação. Cada bloco se passa por um usuário via request.jwt.claims,
--   que é exatamente o mecanismo que o Supabase usa em produção.
--
-- SE O INSERT EM auth.users FALHAR
--   O schema de auth pertence ao Supabase e muda entre versões. Nesse caso,
--   crie três usuários pelo Dashboard (Authentication -> Add user), marque um
--   deles como gerente, e substitua os UUIDs no bloco DECLARE abaixo,
--   removendo a seção "massa de teste".
-- ===========================================================================

begin;

do $$
declare
  v_gerente   uuid := '11111111-1111-1111-1111-111111111111';
  v_closer_a  uuid := '22222222-2222-2222-2222-222222222222';
  v_closer_b  uuid := '33333333-3333-3333-3333-333333333333';

  v_cliente_a uuid;
  v_cliente_b uuid;
  v_negoc_a   uuid;
  v_negoc_b   uuid;
  v_evento    uuid;

  v_total     integer;
  v_papel     public.user_role;
  v_erro      text;
begin
  -- -------------------------------------------------------------------
  -- Massa de teste (criada como postgres, que ignora a RLS).
  -- -------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    (v_gerente,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste"}'::jsonb),
    (v_closer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.a@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer A"}'::jsonb),
    (v_closer_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.b@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer B"}'::jsonb);

  -- 1. O trigger on_auth_user_created criou os profiles?
  select count(*) into v_total
  from public.profiles
  where id in (v_gerente, v_closer_a, v_closer_b);
  assert v_total = 3, format('esperava 3 profiles criados pelo trigger, vieram %s', v_total);

  -- 2. O papel veio de raw_app_meta_data, e o default é closer?
  select role into v_papel from public.profiles where id = v_gerente;
  assert v_papel = 'gerente', 'o papel de gerente deveria vir de raw_app_meta_data';
  select role into v_papel from public.profiles where id = v_closer_a;
  assert v_papel = 'closer', 'sem role no app_metadata, o default precisa ser closer';
  raise notice 'ok  1-2  profiles criados automaticamente, papéis corretos';

  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente do A', 'Empresa A', v_closer_a)
  returning id into v_cliente_a;

  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente do B', 'Empresa B', v_closer_b)
  returning id into v_cliente_b;

  insert into public.negociacoes (cliente_id, owner_id, titulo, valor_estimado)
  values (v_cliente_a, v_closer_a, 'Proposta A', 10000.00)
  returning id into v_negoc_a;

  insert into public.negociacoes (cliente_id, owner_id, titulo, valor_estimado)
  values (v_cliente_b, v_closer_b, 'Proposta B', 20000.00)
  returning id into v_negoc_b;

  -- -------------------------------------------------------------------
  -- A partir daqui, tudo roda como usuário autenticado comum.
  -- -------------------------------------------------------------------
  execute 'set local role authenticated';

  -- ===================================================================
  -- CLOSER A
  -- ===================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);

  -- 3. Enxerga apenas o próprio cliente.
  select count(*) into v_total from public.clientes;
  assert v_total = 1, format('closer A deveria ver 1 cliente, viu %s', v_total);
  raise notice 'ok  3    closer A vê somente a própria carteira';

  -- 4. Enxerga apenas a própria negociação.
  select count(*) into v_total from public.negociacoes;
  assert v_total = 1, format('closer A deveria ver 1 negociação, viu %s', v_total);
  raise notice 'ok  4    closer A vê somente as próprias negociações';

  -- 5. Não consegue editar cliente alheio: a linha é invisível, 0 afetadas.
  update public.clientes set empresa = 'invadido' where id = v_cliente_b;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer A não pode editar cliente do closer B';
  raise notice 'ok  5    UPDATE em cliente alheio não afeta nenhuma linha';

  -- 6. Não consegue mover negociação alheia.
  update public.negociacoes set etapa = 'proposta_enviada' where id = v_negoc_b;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer A não pode mover negociação do closer B';
  raise notice 'ok  6    closer A não move negociação alheia';

  -- 7. Não consegue cadastrar cliente em nome de outro.
  begin
    insert into public.clientes (nome, owner_id) values ('Fraude', v_closer_b);
    assert false, 'closer A não deveria conseguir criar cliente para o closer B';
  exception when insufficient_privilege or check_violation then
    raise notice 'ok  7    INSERT com owner_id alheio barrado pela policy';
  end;

  -- 8. Não consegue se promover a gerente.
  begin
    update public.profiles set role = 'gerente' where id = v_closer_a;
    assert false, 'closer A não deveria conseguir alterar o próprio papel';
  exception when insufficient_privilege then
    raise notice 'ok  8    escalada de privilégio bloqueada pelo trigger';
  end;

  -- 9. Consegue, sim, editar o próprio cliente.
  update public.clientes set empresa = 'Empresa A Ltda' where id = v_cliente_a;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'closer A precisa conseguir editar o próprio cliente';
  raise notice 'ok  9    closer A edita o próprio cliente normalmente';

  -- 10. Fechar sem registro de fechamento é impossível.
  execute 'set constraints all immediate';
  begin
    update public.negociacoes set etapa = 'fechado' where id = v_negoc_a;
    assert false, 'fechar sem registro de fechamento deveria falhar';
  exception when check_violation then
    raise notice 'ok  10   etapa "fechado" exige registro de fechamento';
  end;

  -- 11. Perder sem motivo é impossível.
  begin
    update public.negociacoes set etapa = 'perdido' where id = v_negoc_a;
    assert false, 'perder sem motivo deveria falhar';
  exception when check_violation then
    raise notice 'ok  11   etapa "perdido" exige motivo_perda';
  end;

  -- 12. Com o fechamento preenchido, fechar funciona.
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, status_pagamento, status_onboarding, fechado_por
  )
  values (v_negoc_a, 9500.00, current_date, true, true, 'pendente', 'nao_iniciado', v_closer_a);

  update public.negociacoes set etapa = 'fechado' where id = v_negoc_a;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'com fechamento registrado, a negociação precisa fechar';
  raise notice 'ok  12   fechamento completo permite mover para "fechado"';

  execute 'set constraints all deferred';

  -- ===================================================================
  -- CLOSER B
  -- ===================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);

  -- 13. Não enxerga o fechamento do closer A.
  select count(*) into v_total from public.fechamentos;
  assert v_total = 0, format('closer B não deveria ver fechamento algum, viu %s', v_total);
  raise notice 'ok  13   fechamento alheio invisível para o closer B';

  -- 14. Não consegue pendurar um evento no cliente do closer A.
  begin
    insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
    values ('Reunião indevida', now(), now() + interval '1 hour', v_cliente_a, v_closer_b);
    assert false, 'evento em cliente alheio deveria ser barrado';
  exception when insufficient_privilege or check_violation then
    raise notice 'ok  14   evento vinculado a cliente alheio barrado';
  end;

  -- ===================================================================
  -- GERENTE
  -- ===================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  -- 15. Enxerga os dois clientes.
  select count(*) into v_total from public.clientes;
  assert v_total = 2, format('gerente deveria ver 2 clientes, viu %s', v_total);
  raise notice 'ok  15   gerente vê a carteira inteira';

  -- 16. Edita cliente de qualquer closer.
  update public.clientes set observacoes = 'revisado pelo gerente' where id = v_cliente_b;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'gerente precisa conseguir editar cliente de qualquer closer';
  raise notice 'ok  16   gerente edita cliente de qualquer closer';

  -- 17. Move negociação de qualquer closer.
  update public.negociacoes set etapa = 'proposta_enviada' where id = v_negoc_b;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'gerente precisa conseguir mover qualquer negociação';
  raise notice 'ok  17   gerente move negociação de qualquer closer';

  -- 18. Transferir a carteira leva as negociações junto.
  update public.clientes set owner_id = v_closer_a where id = v_cliente_b;
  select count(*) into v_total
  from public.negociacoes
  where id = v_negoc_b and owner_id = v_closer_a;
  assert v_total = 1, 'a negociação deveria acompanhar a transferência de carteira';
  raise notice 'ok  18   transferência de carteira propaga para as negociações';

  -- ===================================================================
  -- criar_cliente (Fase 3)
  -- ===================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);

  -- 19. Cria o cliente na carteira do closer, com negociação inicial.
  v_cliente_a := public.criar_cliente(
    p_tipo_cliente => 'empresa', p_nome => 'Contato Novo',
    p_empresa => 'Empresa Nova', p_email => 'contato@nova.local');
  select count(*) into v_total
  from public.negociacoes
  where cliente_id = v_cliente_a
    and etapa = 'reuniao_agendada'
    and owner_id = v_closer_a;
  assert v_total = 1, 'criar_cliente deveria abrir uma negociação em reuniao_agendada';
  raise notice 'ok  19   criar_cliente abre a negociação inicial na carteira do closer';

  -- 20. Closer não cria cliente na carteira de outra pessoa.
  begin
    perform public.criar_cliente(
      p_tipo_cliente => 'pessoa_fisica', p_nome => 'Fraude',
      p_owner_id => v_closer_b);
    raise exception 'closer A conseguiu criar cliente na carteira do B';
  exception
    when insufficient_privilege then
      raise notice 'ok  20   closer não cria cliente em carteira alheia';
  end;

  -- ===================================================================
  -- Funil (Fase 4)
  -- ===================================================================

  -- 21. A view do funil respeita a RLS (security_invoker).
  select count(*) into v_total from public.funil_cards;
  assert v_total = (select count(*) from public.negociacoes),
    format('closer A deveria ver no funil só as próprias negociações, viu %s', v_total);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  select count(*) into v_total from public.funil_cards;
  assert v_total = 0,
    format('closer B (carteira transferida no passo 18) não deveria ver cards, viu %s', v_total);
  raise notice 'ok  21   funil_cards respeita a RLS';

  -- 22. Closer não fecha negociação alheia.
  begin
    perform public.fechar_negociacao(
      p_negociacao_id => v_negoc_a, p_posicao => 1000, p_valor_vendido => 100,
      p_data_fechamento => current_date, p_contrato_enviado => true,
      p_contrato_assinado => false, p_status_pagamento => 'pendente',
      p_status_onboarding => 'nao_iniciado');
    raise exception 'closer B conseguiu fechar negociação do closer A';
  exception
    when no_data_found then
      raise notice 'ok  22   closer não fecha negociação alheia';
  end;

  -- 23. fechar_negociacao move a etapa e grava o fechamento juntos.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select id into v_negoc_b from public.negociacoes where cliente_id = v_cliente_a;
  perform public.fechar_negociacao(
    p_negociacao_id => v_negoc_b, p_posicao => 1000, p_valor_vendido => 5000,
    p_data_fechamento => current_date, p_contrato_enviado => true,
    p_contrato_assinado => true, p_status_pagamento => 'cancelado',
    p_status_onboarding => 'em_andamento',
    p_link_contrato => 'https://contratos.local/123');
  select count(*) into v_total
  from public.negociacoes n
  join public.fechamentos f on f.negociacao_id = n.id
  where n.id = v_negoc_b and n.etapa = 'fechado' and f.valor_vendido = 5000;
  assert v_total = 1, 'fechar_negociacao deveria mover a etapa e gravar o fechamento';
  raise notice 'ok  23   fechar_negociacao grava etapa e fechamento juntos';

  -- ===================================================================
  -- Atividades e próximas ações (Fase 5A) — ainda como closer A.
  -- ===================================================================

  -- 24. Atividade não aponta para negociação de outro cliente.
  begin
    insert into public.atividades (cliente_id, negociacao_id, tipo, descricao)
    values (
      v_cliente_a,
      (select id from public.negociacoes where cliente_id = v_cliente_b limit 1),
      'ligacao', 'vínculo cruzado');
    raise exception 'atividade aceitou negociação de outro cliente';
  exception
    when check_violation then
      raise notice 'ok  24   atividade só se vincula a negociação do próprio cliente';
  end;

  -- 25. Registro do closer aparece para ele e fica invisível para o B.
  insert into public.atividades (cliente_id, tipo, descricao)
  values (v_cliente_a, 'whatsapp', 'mandou áudio');
  insert into public.proximas_acoes (cliente_id, titulo, data)
  values (v_cliente_a, 'ligar de novo', current_date + 1);

  select count(*) into v_total
  from public.funil_cards
  where cliente_id = v_cliente_a
    and ultima_atividade_tipo = 'whatsapp'
    and proxima_acao_titulo = 'ligar de novo';
  assert v_total >= 1, 'o card deveria mostrar a última atividade e a próxima ação';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  select count(*) into v_total from public.atividades;
  assert v_total = 0, format('closer B não deveria ver atividades, viu %s', v_total);
  select count(*) into v_total from public.proximas_acoes;
  assert v_total = 0, format('closer B não deveria ver próximas ações, viu %s', v_total);
  raise notice 'ok  25   atividades e próximas ações seguem a carteira do cliente';

  -- 26. Closer não registra atividade em cliente alheio.
  begin
    insert into public.atividades (cliente_id, tipo, descricao)
    values (v_cliente_a, 'nota', 'invasão');
    raise exception 'closer B registrou atividade no cliente do A';
  exception
    when insufficient_privilege then
      raise notice 'ok  26   closer não registra atividade em cliente alheio';
  end;

  -- ===================================================================
  -- Agenda (Fase 5B)
  -- ===================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);

  -- 27. Marcar como realizado registra a atividade na timeline.
  insert into public.eventos (titulo, tipo, inicio, fim, cliente_id)
  values ('Apresentação da proposta', 'apresentacao',
          now() - interval '2 hours', now() - interval '1 hour', v_cliente_a)
  returning id into v_evento;

  perform public.alterar_status_evento(v_evento, 'realizado');

  select count(*) into v_total
  from public.eventos
  where id = v_evento and status = 'realizado';
  assert v_total = 1, 'o status do evento deveria ser realizado';

  select count(*) into v_total
  from public.atividades
  where cliente_id = v_cliente_a
    and tipo = 'reuniao'
    and descricao like 'Realizado: Apresentação da proposta%';
  assert v_total = 1, 'marcar realizado deveria registrar a atividade na timeline';
  raise notice 'ok  27   evento realizado vira atividade na timeline';

  -- 28. Closer B não vê nem altera o evento do A.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  select count(*) into v_total from public.eventos;
  assert v_total = 0, format('closer B não deveria ver eventos, viu %s', v_total);

  begin
    perform public.alterar_status_evento(v_evento, 'cancelado');
    raise exception 'closer B alterou o status de evento do closer A';
  exception
    when no_data_found then
      raise notice 'ok  28   closer não vê nem altera evento alheio';
  end;

  reset role;
  raise notice '';
  raise notice 'TODAS AS ASSERÇÕES PASSARAM.';
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    reset role;
    raise exception 'FALHOU: %', v_erro;
end;
$$;

rollback;
