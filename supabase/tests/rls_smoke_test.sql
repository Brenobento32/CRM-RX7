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
  v_etapa     uuid;

  v_total     integer;
  v_papel     public.user_role;
  v_erro      text;
  v_meta      uuid;
  v_valor     numeric;
  v_valor2    numeric;
  v_servico   uuid;
  v_servico2  uuid;
  v_negoc_s   uuid;
  v_serie     uuid;
  v_ev1       uuid;
  v_ev2       uuid;
  v_ev3       uuid;
  v_ev4       uuid;
  v_datas     date[];
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
  update public.negociacoes set etapa_id = public.etapa_id_por_chave('proposta_enviada') where id = v_negoc_b;
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
    update public.negociacoes set etapa_id = public.etapa_id_por_chave('fechado') where id = v_negoc_a;
    assert false, 'fechar sem registro de fechamento deveria falhar';
  exception when check_violation then
    raise notice 'ok  10   etapa "fechado" exige registro de fechamento';
  end;

  -- 11. Perder sem motivo é impossível.
  begin
    update public.negociacoes set etapa_id = public.etapa_id_por_chave('perdido') where id = v_negoc_a;
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

  update public.negociacoes set etapa_id = public.etapa_id_por_chave('fechado') where id = v_negoc_a;
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
  -- Só os clientes do teste: o banco pode ter dados reais, que o gerente
  -- também enxerga.
  select count(*) into v_total
  from public.clientes
  where id in (v_cliente_a, v_cliente_b);
  assert v_total = 2, format('gerente deveria ver os 2 clientes de teste, viu %s', v_total);
  raise notice 'ok  15   gerente vê a carteira inteira';

  -- 16. Edita cliente de qualquer closer.
  update public.clientes set observacoes = 'revisado pelo gerente' where id = v_cliente_b;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'gerente precisa conseguir editar cliente de qualquer closer';
  raise notice 'ok  16   gerente edita cliente de qualquer closer';

  -- 17. Move negociação de qualquer closer.
  update public.negociacoes set etapa_id = public.etapa_id_por_chave('proposta_enviada') where id = v_negoc_b;
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
    and etapa_id = public.etapa_id_por_chave('reuniao_agendada')
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
  where n.id = v_negoc_b and n.etapa_id = public.etapa_id_por_chave('fechado') and f.valor_vendido = 5000;
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

  -- ===================================================================
  -- Dashboard (Fase 6) — ainda como closer B, que ficou sem carteira.
  -- ===================================================================

  -- 29. Closer recebe só a própria linha e não vê histórico alheio.
  select count(*) into v_total
  from public.dashboard_por_usuario(current_date - 30, current_date);
  assert v_total = 1, format('closer B deveria receber 1 linha no dashboard, recebeu %s', v_total);

  select count(*) into v_total
  from public.dashboard_por_usuario(current_date - 30, current_date)
  where usuario_id = v_closer_b and abertas = 0 and vendido_valor = 0;
  assert v_total = 1, 'a linha do closer B deveria estar zerada (carteira transferida)';

  select count(*) into v_total from public.historico_etapas;
  assert v_total = 0, format('closer B não deveria ver histórico de etapas, viu %s', v_total);
  raise notice 'ok  29   dashboard e histórico respeitam a carteira';

  -- 30. Os números do closer A refletem o fechamento do passo 23, e o
  --     histórico registrou a mudança para "fechado".
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);

  select count(*) into v_total
  from public.dashboard_por_usuario(current_date - 30, current_date)
  where usuario_id = v_closer_a and ganhos >= 1 and vendido_valor >= 5000;
  assert v_total = 1, 'o dashboard do closer A deveria contar o fechamento do passo 23';

  select count(*) into v_total
  from public.historico_etapas
  where negociacao_id = v_negoc_b and etapa_nova_id = public.etapa_id_por_chave('fechado');
  assert v_total = 1, 'o histórico deveria registrar a ida para "fechado"';
  raise notice 'ok  30   dashboard soma o fechamento; histórico registra a etapa';

  -- ===================================================================
  -- Etapas do funil (Fase 8B) — começa como closer A.
  -- ===================================================================

  -- 31. Closer lê as etapas, mas não cria.
  select count(*) into v_total from public.etapas_funil where ativo;
  assert v_total >= 6, format('closer deveria ler as etapas, leu %s', v_total);
  begin
    insert into public.etapas_funil (nome, cor, ordem) values ('Do closer', 'cinza', 3600);
    raise exception 'closer criou etapa';
  exception
    when insufficient_privilege then
      raise notice 'ok  31   closer lê etapas mas não cria';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  -- 32. Gerente cria personalizada antes de Negociação; nasce aberta.
  insert into public.etapas_funil (nome, cor, ordem)
  values ('Follow-up teste', 'ciano', 3500)
  returning id into v_etapa;
  assert public.etapa_tipo(v_etapa) = 'aberta', 'personalizada deveria nascer aberta';
  raise notice 'ok  32   gerente cria etapa personalizada (aberta)';

  -- 33. Nem depois de Negociação, nem do tipo ganha, nem cor fora da paleta.
  begin
    insert into public.etapas_funil (nome, cor, ordem) values ('Depois', 'rosa', 5000);
    raise exception 'aceitou personalizada depois de Negociação';
  exception when check_violation then null;
  end;
  begin
    insert into public.etapas_funil (nome, cor, ordem, tipo) values ('Outro ganho', 'rosa', 3700, 'ganha');
    raise exception 'aceitou segunda etapa ganha';
  exception when check_violation or unique_violation then null;
  end;
  begin
    execute $sql$insert into public.etapas_funil (nome, cor, ordem) values ('Magenta', 'magenta', 3800)$sql$;
    raise exception 'aceitou cor fora da paleta';
  exception when invalid_text_representation then null;
  end;
  raise notice 'ok  33   posição, tipo e cor das personalizadas são validados';

  -- 34. Etapa de sistema: só a cor muda; não é excluída.
  begin
    update public.etapas_funil set nome = 'Renomeada' where chave = 'proposta_enviada';
    raise exception 'renomeou etapa de sistema';
  exception when check_violation then null;
  end;
  begin
    update public.etapas_funil set ordem = 3900 where chave = 'proposta_enviada';
    raise exception 'reordenou etapa de sistema';
  exception when check_violation then null;
  end;
  update public.etapas_funil set cor = 'rosa' where chave = 'proposta_enviada';
  get diagnostics v_total = row_count;
  assert v_total = 1, 'gerente deveria mudar a cor da etapa de sistema';
  delete from public.etapas_funil where chave = 'negociacao';
  get diagnostics v_total = row_count;
  assert v_total = 0, 'etapa de sistema não pode ser excluída';
  raise notice 'ok  34   etapa de sistema: só a cor muda, e não é excluída';

  -- 35. Com negociação dentro, a personalizada não é desativada nem excluída.
  update public.negociacoes set etapa_id = v_etapa where id = v_negoc_a;
  begin
    update public.etapas_funil set ativo = false where id = v_etapa;
    raise exception 'desativou etapa com negociação';
  exception when check_violation then null;
  end;
  begin
    delete from public.etapas_funil where id = v_etapa;
    raise exception 'excluiu etapa com negociação';
  exception when check_violation then null;
  end;
  raise notice 'ok  35   etapa com negociações não é desativada nem excluída';

  -- 36. Esvaziada mas com histórico: desativa, não exclui; e ninguém entra nela.
  update public.negociacoes set etapa_id = public.etapa_id_por_chave('proposta_enviada') where id = v_negoc_a;
  begin
    delete from public.etapas_funil where id = v_etapa;
    raise exception 'excluiu etapa com histórico';
  exception when check_violation then null;
  end;
  update public.etapas_funil set ativo = false where id = v_etapa;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'etapa com histórico e sem negociações deveria ser desativada';
  begin
    update public.negociacoes set etapa_id = v_etapa where id = v_negoc_a;
    raise exception 'moveu negociação para etapa desativada';
  exception when check_violation then null;
  end;
  raise notice 'ok  36   com histórico: só desativa; etapa desativada não recebe negociações';

  -- 37. Nunca usada: pode excluir.
  insert into public.etapas_funil (nome, cor, ordem) values ('Nunca usada', 'cinza', 3600)
  returning id into v_etapa;
  delete from public.etapas_funil where id = v_etapa;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'etapa nunca usada deveria ser excluída';
  raise notice 'ok  37   etapa nunca usada é excluída';

  -- 38. Etapa perdida exige motivo (agora por tipo, não pelo nome).
  begin
    update public.negociacoes set etapa_id = public.etapa_id_por_chave('perdido') where id = v_negoc_a;
    raise exception 'perdida sem motivo foi aceita';
  exception when check_violation then
    raise notice 'ok  38   etapa perdida exige motivo';
  end;

  -- ===================================================================
  -- Métricas do funil (Fase 9A)
  -- ===================================================================

  -- 39. Closer B (sem carteira) recebe métricas zeradas; closer A vê as suas.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  select coalesce(sum(quantidade + alcancaram + parados_7_dias), 0) into v_total
  from public.funil_metricas(current_date - 30, current_date);
  assert v_total = 0, format('closer B deveria ter métricas zeradas, somou %s', v_total);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select coalesce(sum(quantidade), 0) into v_total
  from public.funil_metricas(current_date - 30, current_date);
  assert v_total = (select count(*) from public.negociacoes n
                    join public.etapas_funil e on e.id = n.etapa_id
                    where e.tipo = 'aberta')
                 + (select count(*) from public.fechamentos f
                    join public.negociacoes n on n.id = f.negociacao_id
                    join public.etapas_funil e on e.id = n.etapa_id
                    where e.tipo = 'ganha' and f.data_fechamento between current_date - 30 and current_date),
    format('métricas do closer A não batem com as negociações dele (%s)', v_total);
  raise notice 'ok  39   métricas do funil respeitam a carteira';

  -- ===================================================================
  -- Metas (Fase 10)
  -- ===================================================================

  -- Mês fictício: o banco real pode já ter metas no mês corrente.

  -- 40. Gerente cria meta da empresa e metas individuais.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.metas (usuario_id, periodo_mes, valor_meta)
  values (null,       date '2099-01-01', 100000),
         (v_closer_a, date '2099-01-01', 40000),
         (v_closer_b, date '2099-01-01', 30000);
  select id into v_meta from public.metas
  where usuario_id = v_closer_a and periodo_mes = date '2099-01-01';
  raise notice 'ok  40   gerente cria meta da empresa e por closer';

  -- 41. Uma meta por alvo por mês — inclusive a da empresa (usuario_id nulo).
  begin
    insert into public.metas (usuario_id, periodo_mes, valor_meta)
    values (null, date '2099-01-01', 1);
    raise exception 'aceitou duas metas da empresa no mesmo mês';
  exception when unique_violation then
    raise notice 'ok  41   meta duplicada no mês é recusada';
  end;

  -- 42. Meta individual só para closer; mês só como dia 1; só o valor muda.
  begin
    insert into public.metas (usuario_id, periodo_mes, valor_meta)
    values (v_gerente, date '2099-01-01', 1);
    raise exception 'aceitou meta individual para gerente';
  exception when check_violation then null;
  end;
  begin
    insert into public.metas (usuario_id, periodo_mes, valor_meta)
    values (null, date '2099-01-01' + 1, 1);
    raise exception 'aceitou periodo_mes fora do dia 1';
  exception when check_violation then null;
  end;
  begin
    update public.metas set periodo_mes = periodo_mes - interval '1 month' where id = v_meta;
    raise exception 'permitiu mudar o mês de uma meta';
  exception when check_violation then null;
  end;
  raise notice 'ok  42   regras de meta: só closer, dia 1, só o valor muda';

  -- 43. Closer vê só a própria meta e não escreve em nenhuma.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select count(*) into v_total from public.metas;
  assert v_total = 1, format('closer A deveria ver 1 meta (a sua), viu %s', v_total);
  begin
    insert into public.metas (usuario_id, periodo_mes, valor_meta)
    values (v_closer_a, date '2098-12-01', 1);
    raise exception 'closer criou meta';
  exception when insufficient_privilege then null;
  end;
  update public.metas set valor_meta = 1 where id = v_meta;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer alterou a própria meta';
  delete from public.metas where id = v_meta;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer removeu a própria meta';
  raise notice 'ok  43   closer lê só a própria meta e não escreve';

  -- 44. metas_progresso: closer recebe só a própria linha, sem a da empresa.
  select count(*) into v_total from public.metas_progresso(current_date);
  assert v_total = 1, format('closer A deveria receber 1 linha de progresso, recebeu %s', v_total);
  select count(*) into v_total from public.metas_progresso(current_date) where usuario_id = v_closer_a;
  assert v_total = 1, 'a linha de progresso do closer A deveria ser a dele';
  raise notice 'ok  44   progresso do closer traz só a própria linha';

  -- 45. Gerente fecha a venda de um closer: fechado_por = gerente (auditoria),
  --     responsavel_id = closer, e a meta do closer recebe o valor.
  --     Depois, transferir a carteira não tira a venda de quem era o dono.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select realizado into v_valor from public.metas_progresso(current_date) where usuario_id = v_closer_a;
  select coalesce(sum(realizado), 0) into v_valor2 from public.metas_progresso(current_date)
  where usuario_id = v_gerente;

  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Meta', 'Empresa Meta', v_closer_a)
  returning id into v_cliente_a;
  insert into public.negociacoes (cliente_id, owner_id, titulo, valor_estimado)
  values (v_cliente_a, v_closer_a, 'Venda da meta', 777)
  returning id into v_negoc_a;
  perform public.fechar_negociacao(
    p_negociacao_id => v_negoc_a, p_posicao => 1000, p_valor_vendido => 777,
    p_data_fechamento => current_date, p_contrato_enviado => true,
    p_contrato_assinado => true, p_status_pagamento => 'pago',
    p_status_onboarding => 'nao_iniciado');

  select count(*) into v_total from public.fechamentos
  where negociacao_id = v_negoc_a and fechado_por = v_gerente and responsavel_id = v_closer_a;
  assert v_total = 1, 'fechamento deveria ter fechado_por = gerente e responsavel_id = closer A';

  assert (select realizado from public.metas_progresso(current_date) where usuario_id = v_closer_a) = v_valor + 777,
    'a venda fechada pelo gerente deveria entrar na meta do closer A';
  assert (select coalesce(sum(realizado), 0) from public.metas_progresso(current_date)
          where usuario_id = v_gerente) = v_valor2,
    'a venda do closer A não pode entrar na linha do gerente que clicou';

  -- Editar o fechamento (sem refechar) não troca o responsável, nem forjando.
  update public.fechamentos set responsavel_id = v_gerente, status_onboarding = 'em_andamento'
  where negociacao_id = v_negoc_a;
  select count(*) into v_total from public.fechamentos
  where negociacao_id = v_negoc_a and responsavel_id = v_closer_a;
  assert v_total = 1, 'responsavel_id não pode ser alterado pela aplicação';

  -- Transferência de carteira.
  select realizado into v_valor from public.metas_progresso(current_date) where usuario_id = v_closer_b;
  update public.clientes set owner_id = v_closer_b where id = v_cliente_a;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select realizado into v_valor2 from public.metas_progresso(current_date) where usuario_id = v_closer_a;
  assert v_valor2 >= 777, 'transferir a carteira tirou a venda da meta do responsável';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  select realizado into v_valor2 from public.metas_progresso(current_date) where usuario_id = v_closer_b;
  assert v_valor2 = v_valor, 'a venda transferida não pode entrar na meta do novo dono';
  raise notice 'ok  45   meta segue o responsável no fechamento, não quem clicou nem o dono atual';

  -- 46. Gerente: realizado da empresa = soma das linhas por pessoa.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select
    sum(realizado) filter (where usuario_id is null),
    sum(realizado) filter (where usuario_id is not null)
  into v_valor, v_valor2
  from public.metas_progresso(current_date);
  assert v_valor = v_valor2, format('empresa (%s) diferente da soma das pessoas (%s)', v_valor, v_valor2);
  raise notice 'ok  46   realizado da empresa bate com a soma da equipe';

  -- ===================================================================
  -- Serviços e propostas (Fase 11A)
  -- ===================================================================

  -- 47. Os 7 serviços iniciais existem e o closer enxerga o catálogo.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select count(*) into v_total from public.servicos
  where nome in ('Assessoria Comercial 1 mês', 'Assessoria Comercial 3 meses',
                 'Assessoria Comercial 6 meses', 'Treinamento e configuração de CRM',
                 'Landing Page', 'CRM + IA', 'Social Mídia');
  assert v_total = 7, format('closer deveria ver os 7 serviços iniciais, viu %s', v_total);
  raise notice 'ok  47   serviços iniciais visíveis para o closer';

  -- 48. Closer não cria, não altera e não exclui serviço.
  begin
    insert into public.servicos (nome) values ('Serviço do closer');
    raise exception 'closer criou serviço';
  exception when insufficient_privilege then null;
  end;
  update public.servicos set nome = 'Hackeado' where nome = 'Landing Page';
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer alterou serviço';
  delete from public.servicos where nome = 'Landing Page';
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer excluiu serviço';
  raise notice 'ok  48   closer só lê o catálogo de serviços';

  -- 49. Gerente cria serviço com categoria; nome único sem diferenciar
  --     maiúsculas/espaços; categoria em branco é recusada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.servicos (nome, categoria) values ('Serviço Teste', 'Testes')
  returning id into v_servico;
  insert into public.servicos (nome) values ('Serviço Teste 2')
  returning id into v_servico2;
  begin
    insert into public.servicos (nome) values ('  serviço teste ');
    raise exception 'aceitou serviço com nome duplicado';
  exception when unique_violation then null;
  end;
  begin
    insert into public.servicos (nome, categoria) values ('Serviço Categoria Vazia', '   ');
    raise exception 'aceitou categoria em branco';
  exception when check_violation then null;
  end;
  raise notice 'ok  49   gerente cria serviço; nome único; categoria válida';

  -- 50. Closer salva a própria negociação: qualificação, proposta e serviços.
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Serviços', 'Empresa Serviços', v_closer_a)
  returning id into v_cliente_a;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  insert into public.negociacoes (cliente_id, owner_id, titulo)
  values (v_cliente_a, v_closer_a, 'Negociação com serviços')
  returning id into v_negoc_s;
  perform public.salvar_negociacao(
    p_negociacao_id => v_negoc_s, p_valor_estimado => 10000, p_temperatura => 'quente',
    p_data_primeira_reuniao => current_date - 10, p_data_proposta => current_date - 3,
    p_objecao_principal => 'Preço', p_valor_proposta => 12000,
    p_forma_pagamento => 'boleto_3x', p_servico_ids => array[v_servico, v_servico2]);
  select count(*) into v_total from public.negociacoes
  where id = v_negoc_s and valor_proposta = 12000 and forma_pagamento = 'boleto_3x'
    and temperatura = 'quente' and valor_estimado = 10000;
  assert v_total = 1, 'salvar_negociacao não gravou os campos';
  select count(*) into v_total from public.negociacao_servicos where negociacao_id = v_negoc_s;
  assert v_total = 2, format('esperava 2 serviços vinculados, vieram %s', v_total);
  begin
    perform public.salvar_negociacao(
      p_negociacao_id => v_negoc_s, p_valor_estimado => 10000, p_temperatura => null,
      p_data_primeira_reuniao => current_date, p_data_proposta => current_date - 1,
      p_objecao_principal => null, p_valor_proposta => null,
      p_forma_pagamento => null, p_servico_ids => array[]::uuid[]);
    raise exception 'aceitou proposta anterior à primeira reunião';
  exception when check_violation then null;
  end;
  select count(*) into v_total from public.negociacao_servicos where negociacao_id = v_negoc_s;
  assert v_total = 2, 'salvamento recusado não pode ter mexido nos serviços';
  raise notice 'ok  50   closer salva a própria negociação em uma transação';

  -- 51. Closer B não salva, não vê e não vincula serviço na negociação do A.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);
  begin
    perform public.salvar_negociacao(
      p_negociacao_id => v_negoc_s, p_valor_estimado => 1, p_temperatura => null,
      p_data_primeira_reuniao => null, p_data_proposta => null,
      p_objecao_principal => null, p_valor_proposta => null,
      p_forma_pagamento => null, p_servico_ids => array[]::uuid[]);
    raise exception 'closer B salvou negociação do closer A';
  exception when no_data_found then null;
  end;
  select count(*) into v_total from public.negociacao_servicos where negociacao_id = v_negoc_s;
  assert v_total = 0, 'closer B enxergou serviços da negociação do closer A';
  begin
    insert into public.negociacao_servicos (negociacao_id, servico_id) values (v_negoc_s, v_servico);
    raise exception 'closer B vinculou serviço na negociação do closer A';
  exception when insufficient_privilege or unique_violation then null;
  end;
  delete from public.negociacao_servicos where negociacao_id = v_negoc_s;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'closer B removeu serviços da negociação do closer A';
  raise notice 'ok  51   serviços da negociação seguem a RLS da negociação';

  -- 52. Serviço desativado: continua onde já estava, não entra em outra.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.servicos set ativo = false where id = v_servico2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  perform public.salvar_negociacao(
    p_negociacao_id => v_negoc_s, p_valor_estimado => 10000, p_temperatura => 'morno',
    p_data_primeira_reuniao => null, p_data_proposta => null,
    p_objecao_principal => null, p_valor_proposta => null,
    p_forma_pagamento => null, p_servico_ids => array[v_servico, v_servico2]);
  select count(*) into v_total from public.negociacao_servicos where negociacao_id = v_negoc_s;
  assert v_total = 2, 'serviço desativado já vinculado deveria continuar na negociação';

  insert into public.negociacoes (cliente_id, owner_id, titulo)
  values (v_cliente_a, v_closer_a, 'Outra negociação')
  returning id into v_negoc_a;
  begin
    perform public.salvar_negociacao(
      p_negociacao_id => v_negoc_a, p_valor_estimado => null, p_temperatura => null,
      p_data_primeira_reuniao => null, p_data_proposta => null,
      p_objecao_principal => null, p_valor_proposta => null,
      p_forma_pagamento => null, p_servico_ids => array[v_servico2]);
    raise exception 'vinculou serviço desativado a uma negociação nova';
  exception when check_violation then null;
  end;
  raise notice 'ok  52   serviço desativado fica no histórico e não entra em negociação nova';

  -- 53. O array é o conjunto final: o serviço que sai dele é desvinculado.
  perform public.salvar_negociacao(
    p_negociacao_id => v_negoc_s, p_valor_estimado => 10000, p_temperatura => null,
    p_data_primeira_reuniao => null, p_data_proposta => null,
    p_objecao_principal => null, p_valor_proposta => null,
    p_forma_pagamento => null, p_servico_ids => array[v_servico]);
  select count(*) into v_total from public.negociacao_servicos where negociacao_id = v_negoc_s;
  assert v_total = 1, 'deveria restar só o serviço mantido';
  raise notice 'ok  53   o array de serviços é o conjunto final';

  -- 54. Serviço usado não é excluído (desativa); nunca usado é excluído.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  begin
    delete from public.servicos where id = v_servico;
    raise exception 'excluiu serviço em uso';
  exception when foreign_key_violation then null;
  end;
  insert into public.servicos (nome) values ('Nunca usado') returning id into v_servico2;
  delete from public.servicos where id = v_servico2;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'serviço nunca usado deveria ser excluído';
  raise notice 'ok  54   serviço usado não é excluído; nunca usado é';

  -- ===================================================================
  -- Negociação encerrada é somente leitura (ajuste da Fase 11C)
  -- ===================================================================

  -- 55. Ganha: salvar, UPDATE direto e mexer em serviços são recusados.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  insert into public.negociacoes (cliente_id, owner_id, titulo)
  values (v_cliente_a, v_closer_a, 'Negociação que será encerrada')
  returning id into v_negoc_s;
  perform public.salvar_negociacao(
    p_negociacao_id => v_negoc_s, p_valor_estimado => 5000, p_temperatura => 'quente',
    p_data_primeira_reuniao => null, p_data_proposta => null,
    p_objecao_principal => null, p_valor_proposta => 6000,
    p_forma_pagamento => 'avista', p_servico_ids => array[v_servico]);
  perform public.fechar_negociacao(
    p_negociacao_id => v_negoc_s, p_posicao => 1000, p_valor_vendido => 6000,
    p_data_fechamento => current_date, p_contrato_enviado => true,
    p_contrato_assinado => true, p_status_pagamento => 'pago',
    p_status_onboarding => 'nao_iniciado');

  begin
    perform public.salvar_negociacao(
      p_negociacao_id => v_negoc_s, p_valor_estimado => 5000, p_temperatura => 'quente',
      p_data_primeira_reuniao => null, p_data_proposta => null,
      p_objecao_principal => null, p_valor_proposta => 6000,
      p_forma_pagamento => 'avista', p_servico_ids => array[v_servico]);
    raise exception 'salvar_negociacao aceitou negociação ganha (mesmo sem mudanças)';
  exception when check_violation then null;
  end;
  begin
    update public.negociacoes set valor_proposta = 1 where id = v_negoc_s;
    raise exception 'UPDATE direto alterou proposta de negociação ganha';
  exception when check_violation then null;
  end;
  begin
    delete from public.negociacao_servicos where negociacao_id = v_negoc_s;
    raise exception 'removeu serviço de negociação ganha';
  exception when check_violation then null;
  end;
  begin
    insert into public.negociacao_servicos (negociacao_id, servico_id)
    select v_negoc_s, id from public.servicos where ativo and id <> v_servico limit 1;
    raise exception 'vinculou serviço a negociação ganha';
  exception when check_violation then null;
  end;
  select count(*) into v_total from public.negociacoes
  where id = v_negoc_s and valor_proposta = 6000 and forma_pagamento = 'avista';
  assert v_total = 1, 'a proposta da negociação ganha deveria continuar intacta';
  raise notice 'ok  55   negociação ganha: dados comerciais somente leitura';

  -- 56. Perdida também é somente leitura; reaberta volta a ser editável.
  update public.negociacoes
     set etapa_id = public.etapa_id_por_chave('proposta_enviada')
   where id = v_negoc_s;
  update public.negociacoes
     set etapa_id = public.etapa_id_por_chave('perdido'), motivo_perda = 'Sem orçamento'
   where id = v_negoc_s;
  begin
    update public.negociacoes set temperatura = 'frio' where id = v_negoc_s;
    raise exception 'UPDATE direto alterou negociação perdida';
  exception when check_violation then null;
  end;

  update public.negociacoes
     set etapa_id = public.etapa_id_por_chave('negociacao')
   where id = v_negoc_s;
  perform public.salvar_negociacao(
    p_negociacao_id => v_negoc_s, p_valor_estimado => 5500, p_temperatura => 'morno',
    p_data_primeira_reuniao => null, p_data_proposta => null,
    p_objecao_principal => null, p_valor_proposta => 7000,
    p_forma_pagamento => 'cartao_12x', p_servico_ids => array[]::uuid[]);
  select count(*) into v_total from public.negociacoes
  where id = v_negoc_s and valor_proposta = 7000 and forma_pagamento = 'cartao_12x';
  assert v_total = 1, 'negociação reaberta deveria voltar a ser editável';
  raise notice 'ok  56   perdida somente leitura; reaberta volta a ser editável';

  -- 57. Excluir negociação encerrada com serviços não é barrado pela regra
  --     (os vínculos saem em cascata).
  perform public.salvar_negociacao(
    p_negociacao_id => v_negoc_s, p_valor_estimado => 5500, p_temperatura => 'morno',
    p_data_primeira_reuniao => null, p_data_proposta => null,
    p_objecao_principal => null, p_valor_proposta => 7000,
    p_forma_pagamento => 'cartao_12x', p_servico_ids => array[v_servico]);
  update public.negociacoes
     set etapa_id = public.etapa_id_por_chave('perdido'), motivo_perda = 'Desistiu'
   where id = v_negoc_s;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  delete from public.negociacoes where id = v_negoc_s;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'gerente deveria conseguir excluir negociação encerrada';
  raise notice 'ok  57   excluir negociação encerrada leva os serviços em cascata';

  -- ===================================================================
  -- Agenda Google — conexão OAuth (Agenda 2.0, Fase A)
  -- ===================================================================

  -- 58. Conexão: closer não lê; gerente lê mas não escreve.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select count(*) into v_total from public.agenda_google_conexao;
  assert v_total = 0, 'closer não pode ler a conexão com o Google';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  perform count(*) from public.agenda_google_conexao;
  begin
    insert into public.agenda_google_conexao (conta_email, calendar_id, escopos, vault_secret_id)
    values ('x@teste.local', 'x@teste.local', '{}', gen_random_uuid());
    raise exception 'gerente gravou a conexão direto (só a Edge Function grava)';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  58   conexão Google: closer não lê; ninguém grava pela API';

  -- 59. Token: nenhuma função do Vault é executável por usuário logado.
  begin
    perform * from public.agenda_google_obter_credencial();
    raise exception 'gerente leu o refresh token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.agenda_google_salvar_conexao('x@teste.local', 'x', '{}', 'token', v_gerente);
    raise exception 'gerente gravou token pela função';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.agenda_google_remover_conexao();
    raise exception 'gerente removeu a conexão pela função';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  59   refresh token inacessível para usuários (só service_role)';

  -- 60. Estados do OAuth: fora do alcance de qualquer usuário.
  begin
    perform count(*) from public.agenda_google_oauth_estados;
    raise exception 'gerente leu os estados do OAuth';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  60   estados do OAuth só para a Edge Function';

  -- ===================================================================
  -- Agenda nativa (Agenda 2.0, N1)
  -- ===================================================================

  -- 61. Responsável precisa ter acesso ao cliente.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
  values ('Evento do A', now() + interval '30 days', now() + interval '30 days 1 hour', v_cliente_a, v_closer_a)
  returning id into v_evento;
  begin
    insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
    values ('Para o B', now() + interval '30 days', now() + interval '30 days 1 hour', v_cliente_a, v_closer_b);
    raise exception 'closer A criou evento com outro responsável';
  exception when insufficient_privilege or check_violation then null;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  begin
    insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
    values ('B sem acesso', now() + interval '30 days', now() + interval '30 days 1 hour', v_cliente_a, v_closer_b);
    raise exception 'gerente pôs como responsável um closer sem acesso ao cliente';
  exception when check_violation then null;
  end;
  insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
  values ('Gerente responsável', now() + interval '30 days', now() + interval '30 days 1 hour', v_cliente_a, v_gerente);
  raise notice 'ok  61   responsável precisa ter acesso ao cliente';

  -- 62. 'confirmado' conta como compromisso em aberto (funil e dashboard).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  insert into public.negociacoes (cliente_id, owner_id, titulo)
  values (v_cliente_a, v_closer_a, 'Negociação agenda')
  returning id into v_negoc_a;
  insert into public.eventos (titulo, status, inicio, fim, cliente_id, negociacao_id, usuario_id)
  values ('Reunião confirmada 62', 'confirmado', now() + interval '2 days',
          now() + interval '2 days 1 hour', v_cliente_a, v_negoc_a, v_closer_a)
  returning id into v_ev1;
  assert (select proxima_acao_titulo from public.funil_cards where id = v_negoc_a) = 'Reunião confirmada 62',
    'evento confirmado deveria ser a próxima ação no card do funil';
  assert (select reunioes_proximas from public.dashboard_por_usuario(current_date, current_date)
          where usuario_id = v_closer_a)
       = (select count(*) from public.eventos
          where usuario_id = v_closer_a and tipo in ('reuniao', 'apresentacao')
            and status in ('agendado', 'confirmado')
            and inicio >= now() and inicio < now() + interval '7 days'),
    'reuniões próximas do dashboard deveriam incluir as confirmadas';
  raise notice 'ok  62   confirmado aparece no funil e no dashboard';

  -- 63. Excluir só sem histórico; cancelar só em aberto.
  delete from public.eventos where id = v_ev1;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'evento confirmado deveria poder ser excluído';

  insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
  values ('Vai ser realizado', now() - interval '2 hours', now() - interval '1 hour', v_cliente_a, v_closer_a)
  returning id into v_ev1;
  perform public.alterar_status_evento(v_ev1, 'realizado');
  delete from public.eventos where id = v_ev1;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'evento realizado não pode ser excluído';
  begin
    perform public.cancelar_eventos(v_ev1, 'este');
    raise exception 'cancelou evento realizado';
  exception when check_violation then null;
  end;

  perform public.cancelar_eventos(v_evento, 'este');
  delete from public.eventos where id = v_evento;
  get diagnostics v_total = row_count;
  assert v_total = 0, 'evento cancelado não pode ser excluído';
  raise notice 'ok  63   excluir só sem histórico; realizado e cancelado permanecem';

  -- 64. Cor da agenda: só o gerente altera.
  begin
    update public.profiles set cor_agenda = 'rosa' where id = v_closer_a;
    raise exception 'closer alterou a própria cor da agenda';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.profiles set cor_agenda = 'azul' where id = v_closer_a;
  get diagnostics v_total = row_count;
  assert v_total = 1, 'gerente deveria definir a cor da agenda';
  assert (select responsavel_cor from public.agenda_eventos
          where usuario_id = v_closer_a limit 1) = 'azul',
    'agenda_eventos deveria trazer a cor do responsável';
  raise notice 'ok  64   cor da agenda: só gerente altera; aparece na agenda';

  -- 65. Série semanal (terça e quinta, 4 ocorrências, 10:00, 45 min).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  v_ev1 := public.criar_serie_eventos(
    p_titulo => 'Série 65', p_tipo => 'reuniao', p_status => 'agendado',
    p_cliente_id => v_cliente_a, p_negociacao_id => null, p_usuario_id => v_closer_a,
    p_descricao => null, p_data_inicio => date '2099-01-05', p_hora_inicio => time '10:00',
    p_duracao_minutos => 45, p_frequencia => 'semanal', p_intervalo => 1,
    p_dias_semana => array[2, 4]::smallint[], p_dia_mes => null,
    p_termina_em => null, p_ocorrencias => 4);
  select serie_id into v_serie from public.eventos where id = v_ev1;
  select count(*) into v_total from public.eventos
  where serie_id = v_serie
    and extract(isodow from inicio at time zone 'America/Sao_Paulo') in (2, 4)
    and to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00'
    and fim - inicio = interval '45 minutes'
    and (inicio at time zone 'America/Sao_Paulo')::date >= date '2099-01-05';
  assert v_total = 4, format('série semanal deveria ter 4 ocorrências ter/qui às 10:00, tem %s', v_total);
  raise notice 'ok  65   série semanal gera as ocorrências no horário de São Paulo';

  -- 66. Término obrigatório e limites (12 meses / 200).
  begin
    insert into public.eventos_series (titulo, cliente_id, usuario_id, data_inicio, hora_inicio,
                                       duracao, frequencia)
    values ('Sem fim', v_cliente_a, v_closer_a, date '2099-01-05', time '10:00', interval '30 minutes', 'diaria');
    raise exception 'aceitou série sem término';
  exception when check_violation then null;
  end;
  begin
    perform public.criar_serie_eventos('Longa', 'reuniao', 'agendado', v_cliente_a, null, v_closer_a, null,
      date '2099-01-05', time '10:00', 30, 'diaria', 1, null, null, date '2100-02-01', null);
    raise exception 'aceitou término além de 12 meses';
  exception when check_violation then null;
  end;
  begin
    perform public.criar_serie_eventos('Muitas', 'reuniao', 'agendado', v_cliente_a, null, v_closer_a, null,
      date '2099-01-05', time '10:00', 30, 'diaria', 1, null, null, null, 201);
    raise exception 'aceitou mais de 200 ocorrências';
  exception when check_violation then null;
  end;
  begin
    perform public.criar_serie_eventos('Semanal vazia', 'reuniao', 'agendado', v_cliente_a, null, v_closer_a, null,
      date '2099-01-05', time '10:00', 30, 'semanal', 1, null, null, null, 3);
    raise exception 'aceitou série semanal sem dias';
  exception when check_violation then null;
  end;
  raise notice 'ok  66   término obrigatório, até 12 meses ou 200 ocorrências';

  -- 67. Mensal no dia 31 cai no último dia dos meses curtos.
  v_ev2 := public.criar_serie_eventos('Mensal 31', 'followup', 'agendado', v_cliente_a, null, v_closer_a, null,
    date '2099-01-31', time '09:00', 30, 'mensal', 1, null, 31::smallint, null, 3);
  select array_agg((inicio at time zone 'America/Sao_Paulo')::date order by inicio) into v_datas
  from public.eventos where serie_id = (select serie_id from public.eventos where id = v_ev2);
  assert v_datas = array[date '2099-01-31', date '2099-02-28', date '2099-03-31'],
    format('mensal dia 31 gerou %s', v_datas);
  raise notice 'ok  67   mensal no dia 31 respeita meses curtos';

  -- 68. Editar série: 'seguintes' e 'todos' não reescrevem histórico.
  select id into v_ev1 from public.eventos where serie_id = v_serie order by ocorrencia_original offset 0 limit 1;
  select id into v_ev2 from public.eventos where serie_id = v_serie order by ocorrencia_original offset 1 limit 1;
  select id into v_ev3 from public.eventos where serie_id = v_serie order by ocorrencia_original offset 2 limit 1;
  select id into v_ev4 from public.eventos where serie_id = v_serie order by ocorrencia_original offset 3 limit 1;
  perform public.alterar_status_evento(v_ev1, 'realizado');

  v_total := public.alterar_eventos(v_ev2, 'seguintes', 'Série editada', 'reuniao', v_cliente_a, null,
    v_closer_a, null, date '2000-01-01', time '14:00', 60);
  assert v_total = 3, format('seguintes deveria alterar 3 ocorrências, alterou %s', v_total);
  assert (select titulo from public.eventos where id = v_ev1) = 'Série 65',
    'ocorrência realizada não pode mudar';
  select count(*) into v_total from public.eventos
  where id in (v_ev2, v_ev3, v_ev4) and titulo = 'Série editada'
    and to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') = '14:00'
    and fim - inicio = interval '1 hour'
    and extract(isodow from inicio at time zone 'America/Sao_Paulo') in (2, 4);
  assert v_total = 3, 'seguintes deveria mudar horário e manter a data de cada ocorrência';

  v_total := public.alterar_eventos(v_ev3, 'todos', 'Série toda', 'reuniao', v_cliente_a, null,
    v_closer_a, null, date '2000-01-01', time '09:00', 30);
  assert v_total = 3, format('todos deveria alterar só as 3 em aberto, alterou %s', v_total);
  assert (select titulo from public.eventos where id = v_ev1) = 'Série 65',
    'todos não pode reescrever ocorrência realizada';
  assert (select titulo from public.eventos_series where id = v_serie) = 'Série toda',
    'todos deveria atualizar o modelo da série';
  raise notice 'ok  68   editar série (seguintes/todos) preserva o histórico';

  -- 69. Cancelar série com escopo.
  v_total := public.cancelar_eventos(v_ev4, 'seguintes');
  assert v_total = 1, format('cancelar seguintes a partir da última deveria cancelar 1, cancelou %s', v_total);
  v_total := public.cancelar_eventos(v_ev2, 'todos');
  assert v_total = 2, format('cancelar todos deveria pegar as 2 ainda em aberto, pegou %s', v_total);
  assert (select status from public.eventos where id = v_ev1) = 'realizado',
    'cancelar todos não pode mexer na realizada';
  raise notice 'ok  69   cancelar série respeita escopo e histórico';

  -- 70. Transferir carteira leva só os compromissos futuros em aberto.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id)
  values ('Cliente Transferência', 'Empresa T', v_closer_a)
  returning id into v_cliente_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
  values ('Futuro', now() + interval '10 days', now() + interval '10 days 1 hour', v_cliente_b, v_closer_a)
  returning id into v_ev1;
  insert into public.eventos (titulo, inicio, fim, cliente_id, usuario_id)
  values ('Passado', now() - interval '10 days', now() - interval '10 days' + interval '1 hour', v_cliente_b, v_closer_a)
  returning id into v_ev2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.clientes set owner_id = v_closer_b where id = v_cliente_b;
  assert (select usuario_id from public.eventos where id = v_ev1) = v_closer_b,
    'compromisso futuro deveria ir para o novo dono';
  assert (select usuario_id from public.eventos where id = v_ev2) = v_closer_a,
    'compromisso passado deveria ficar com quem o tinha';
  raise notice 'ok  70   transferência leva só os compromissos futuros em aberto';

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
