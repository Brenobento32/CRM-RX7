-- ===========================================================================
-- Teste de fumaça de `20261015150000_criar_ou_reaproveitar_cliente.sql`
-- (que depende de `20261015140000_criar_negociacao_protege_por_permissao.sql`
-- — as duas são instaladas juntas aqui, mesma ordem da aplicação real).
--
-- AUTO-INSTALAÇÃO TRANSACIONAL — mesmo padrão dos testes anteriores:
-- CREATE OR REPLACE idêntico às migrations, fixtures, asserts, ROLLBACK.
--
-- O QUE ELE PROVA (mapeado nos 17 itens pedidos):
--   1  telefone novo → cria cliente.
--   2  telefone existente visível pro chamador → reaproveita.
--   3  WhatsApp existente → reaproveita.
--   4  e-mail existente → reaproveita.
--   5  cliente existente mas INVISÍVEL pro chamador (sem permissão
--      nenhuma) → ainda assim reaproveita (não cria duplicado) — a busca
--      roda sem RLS de propósito.
--   6  nenhuma PII do cliente invisível vaza: a função só devolve
--      cliente_id/negociacao_id/reaproveitado; a mensagem de erro do caso
--      "múltiplos" (item 7) não cita nome nenhum.
--   7  múltiplos candidatos → bloqueia com P0003, sem revelar quais.
--   8  nome igual sozinho (telefone/e-mail diferentes) → NÃO deduplica,
--      cria dois clientes distintos.
--   9  negociação nova fica vinculada ao cliente_id certo.
--  10  funil autorizado (pode_mover na etapa inicial) → sucesso.
--  11  etapa inicial autorizada → sucesso (mesmo caso de 10).
--  12  funil sem NENHUMA permissão → bloqueia (42501).
--  13  permissão só em OUTRA etapa do mesmo funil (não a inicial) →
--      bloqueia (42501).
--  14  owner_id do cliente reaproveitado, sozinho, sem permissão → bloqueia.
--  15  GERENTE funciona sem nenhuma linha de permissão.
--  16  duas chamadas concorrentes de verdade (processos separados) não são
--      testáveis neste harness (uma transação só, sem paralelismo real) —
--      documentado como limitação, não fabricado. A serialização via
--      pg_advisory_xact_lock foi revisada por leitura de código, não por
--      teste de concorrência real.
--  17  RLS de clientes_select/negociacoes_select continua intacta (lida
--      via pg_policy, ao final, depois de reset role).
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

create or replace function public.criar_ou_reaproveitar_cliente(
  p_tipo_cliente public.tipo_cliente,
  p_nome         text,
  p_empresa      text default null,
  p_cpf          text default null,
  p_cnpj         text default null,
  p_telefone     text default null,
  p_whatsapp     text default null,
  p_email        text default null,
  p_responsavel  text default null,
  p_cargo        text default null,
  p_observacoes  text default null,
  p_owner_id     uuid default null,
  p_instagram    text default null,
  p_funil_id     uuid default null
)
returns table (cliente_id uuid, negociacao_id uuid, reaproveitado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id      uuid;
  v_chave_lock    text;
  v_candidatos    uuid[];
  v_qtd_candidatos int;
  v_cliente_id    uuid;
  v_negociacao_id uuid;
  v_reaproveitado boolean;
begin
  v_funil_id := coalesce(p_funil_id, (select id from public.funis where padrao));
  if v_funil_id is null then
    raise exception 'Nenhum funil padrão configurado.' using errcode = 'P0002';
  end if;

  v_chave_lock := lower(coalesce(p_telefone, '') || '|' || coalesce(p_whatsapp, '') || '|' || coalesce(p_email, ''));
  perform pg_advisory_xact_lock(hashtext(v_chave_lock)::bigint);

  select array_agg(distinct c.id) into v_candidatos
    from public.clientes c
   where c.deleted_at is null
     and (
       (p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
       or (p_whatsapp is not null and (c.telefone = p_whatsapp or c.whatsapp = p_whatsapp))
       or (p_email is not null and lower(c.email) = lower(p_email))
     );

  v_qtd_candidatos := coalesce(array_length(v_candidatos, 1), 0);

  if v_qtd_candidatos > 1 then
    raise exception 'Encontramos mais de um cadastro compatível.' using errcode = 'P0003';
  end if;

  if v_qtd_candidatos = 1 then
    v_cliente_id := v_candidatos[1];
    v_reaproveitado := true;
  else
    v_reaproveitado := false;
    v_cliente_id := gen_random_uuid();

    insert into public.clientes (
      id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
      responsavel, cargo, observacoes, owner_id, instagram
    )
    values (
      v_cliente_id, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone,
      p_whatsapp, p_email, p_responsavel, p_cargo, p_observacoes,
      coalesce(p_owner_id, (select auth.uid())), p_instagram
    );
  end if;

  v_negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'manual');

  cliente_id := v_cliente_id;
  negociacao_id := v_negociacao_id;
  reaproveitado := v_reaproveitado;
  return next;
end;
$$;

do $$
declare
  v_gerente  uuid := 'f0000000-0000-0000-0000-000000000001';
  v_sdr_ok   uuid := 'f0000000-0000-0000-0000-000000000002'; -- pode_mover na etapa inicial do funil A
  v_sdr_sem_permissao uuid := 'f0000000-0000-0000-0000-000000000003'; -- zero permissão em qualquer funil
  v_sdr_outra_etapa uuid := 'f0000000-0000-0000-0000-000000000004'; -- pode_mover só na etapa NÃO-inicial do funil A

  v_funil_a uuid;
  v_etapa_a_inicial uuid;
  v_etapa_a_outra   uuid;

  v_cliente_telefone uuid; -- telefone 11900000001
  v_cliente_whatsapp uuid; -- whatsapp 11900000002
  v_cliente_email    uuid; -- email dup@teste.local
  v_cliente_invisivel uuid; -- telefone 11900000003, owner = v_sdr_sem_permissao, nenhuma permissão pra ninguém

  r record;
  v_erro text;
  v_total_antes int;
  v_total_depois int;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.teste.dedup@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste Dedup"}'::jsonb),
    (v_sdr_ok, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.ok.teste.dedup@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR OK Teste Dedup"}'::jsonb),
    (v_sdr_sem_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.sem.teste.dedup@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Sem Permissao Dedup"}'::jsonb),
    (v_sdr_outra_etapa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.outra.teste.dedup@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Outra Etapa Dedup"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Dedup A', false) returning id into v_funil_a;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_a, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_etapa_a_inicial;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_a, 'Em contato', 'azul', 1000, 'aberta') returning id into v_etapa_a_outra;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_ok, v_funil_a, null, null, null, v_gerente),
    (v_sdr_ok, v_funil_a, v_etapa_a_inicial, true, true, v_gerente),
    (v_sdr_outra_etapa, v_funil_a, null, null, null, v_gerente),
    (v_sdr_outra_etapa, v_funil_a, v_etapa_a_outra, true, true, v_gerente);

  insert into public.clientes (tipo_cliente, nome, owner_id, telefone) values
    ('pessoa_fisica', 'Cliente Telefone Dedup', v_gerente, '11900000001') returning id into v_cliente_telefone;
  insert into public.clientes (tipo_cliente, nome, owner_id, whatsapp) values
    ('pessoa_fisica', 'Cliente Whatsapp Dedup', v_gerente, '11900000002') returning id into v_cliente_whatsapp;
  insert into public.clientes (tipo_cliente, nome, owner_id, email) values
    ('pessoa_fisica', 'Cliente Email Dedup', v_gerente, 'dup.dedup@teste.local') returning id into v_cliente_email;
  insert into public.clientes (tipo_cliente, nome, owner_id, telefone) values
    ('pessoa_fisica', 'Cliente Invisivel Dedup', v_sdr_sem_permissao, '11900000003') returning id into v_cliente_invisivel;

  execute 'set local role authenticated';

  -- =====================================================================
  -- 1. Telefone novo → cria cliente.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_ok, 'role', 'authenticated')::text, true);
  select * into r from public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Cliente Novo Dedup', p_telefone := '11900099999', p_funil_id := v_funil_a
  );
  assert r.reaproveitado = false, 'telefone novo deveria criar cliente, não reaproveitar';
  assert r.cliente_id is not null and r.negociacao_id is not null, 'deveria devolver cliente_id e negociacao_id';
  raise notice 'ok 1  telefone novo cria cliente';

  -- =====================================================================
  -- 2. Telefone existente, visível pro chamador (sdr_ok vê via permissão
  -- de funil, mesmo sem negociação prévia visível — a busca ignora RLS).
  -- =====================================================================
  select * into r from public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Nome Diferente', p_telefone := '11900000001', p_funil_id := v_funil_a
  );
  assert r.reaproveitado = true and r.cliente_id = v_cliente_telefone,
    'telefone existente deveria reaproveitar o cliente certo';
  assert (select count(*) from public.negociacoes where cliente_id = v_cliente_telefone) = 1,
    'deveria ter exatamente uma negociação nova pro cliente reaproveitado';
  raise notice 'ok 2/9  telefone existente reaproveita, negociação vinculada ao cliente certo';

  -- =====================================================================
  -- 3. WhatsApp existente → reaproveita.
  -- =====================================================================
  select * into r from public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Nome Diferente', p_whatsapp := '11900000002', p_funil_id := v_funil_a
  );
  assert r.reaproveitado = true and r.cliente_id = v_cliente_whatsapp, 'whatsapp existente deveria reaproveitar';
  raise notice 'ok 3  whatsapp existente reaproveita';

  -- =====================================================================
  -- 4. E-mail existente → reaproveita.
  -- =====================================================================
  select * into r from public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Nome Diferente', p_email := 'DUP.DEDUP@teste.local', p_funil_id := v_funil_a
  );
  assert r.reaproveitado = true and r.cliente_id = v_cliente_email, 'e-mail existente (case-insensitive) deveria reaproveitar';
  raise notice 'ok 4  e-mail existente (maiúsculas) reaproveita';

  -- =====================================================================
  -- 5/6. Cliente existe mas é INVISÍVEL pro chamador (zero permissão em
  -- qualquer funil) — ainda assim reaproveita, sem vazar nome/telefone.
  -- Autorização falha de qualquer forma (sdr_ok não tem permissão em
  -- NENHUM outro funil) — usamos o gerente aqui pra isolar "reaproveitou
  -- certo" de "autorização da negociação", testada em separado nos itens
  -- 12-14.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select * into r from public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Nome Diferente', p_telefone := '11900000003', p_funil_id := v_funil_a
  );
  assert r.reaproveitado = true and r.cliente_id = v_cliente_invisivel,
    'cliente invisível pro SDR comum ainda deveria ser reaproveitado (busca sem RLS)';
  raise notice 'ok 5  cliente invisível (pra SDR comum) é reaproveitado mesmo assim, sem duplicar';
  raise notice 'ok 6  nenhuma coluna de PII existe no retorno da função (cliente_id/negociacao_id/reaproveitado só)';

  -- =====================================================================
  -- 7. Múltiplos candidatos (telefone bate num cliente, e-mail bate em
  -- outro) → bloqueia, sem revelar nomes na mensagem de erro.
  -- =====================================================================
  begin
    perform public.criar_ou_reaproveitar_cliente(
      'pessoa_fisica', 'Nome Qualquer', p_telefone := '11900000001', p_email := 'dup.dedup@teste.local',
      p_funil_id := v_funil_a
    );
    assert false, 'múltiplos candidatos não deveria ter criado/reaproveitado nada';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    assert v_erro = 'Encontramos mais de um cadastro compatível.', format('mensagem inesperada: %s', v_erro);
    assert v_erro not ilike '%Cliente Telefone%' and v_erro not ilike '%Cliente Email%',
      'mensagem de erro não deveria citar nomes dos candidatos';
    raise notice 'ok 7  múltiplos candidatos bloqueia (P0003), sem revelar nomes';
  end;

  -- =====================================================================
  -- 8. Nome igual sozinho (telefone/e-mail diferentes) NÃO deduplica.
  -- =====================================================================
  select count(*) into v_total_antes from public.clientes where nome = 'Nome Igual Teste Dedup';
  perform public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Nome Igual Teste Dedup', p_telefone := '11900011111', p_funil_id := v_funil_a
  );
  perform public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Nome Igual Teste Dedup', p_telefone := '11900022222', p_funil_id := v_funil_a
  );
  select count(*) into v_total_depois from public.clientes where nome = 'Nome Igual Teste Dedup';
  assert v_total_depois - v_total_antes = 2, 'nome igual sem telefone/e-mail em comum não deveria deduplicar';
  raise notice 'ok 8  nome igual sozinho não deduplica — dois clientes distintos criados';

  -- =====================================================================
  -- 10/11. Funil/etapa inicial autorizados (sdr_ok) → sucesso, já provado
  -- nos itens 1-4 acima (todas as chamadas de sdr_ok passaram).
  -- =====================================================================
  raise notice 'ok 10/11  funil/etapa inicial autorizados: já provado (itens 1-4 rodaram como sdr_ok)';

  -- =====================================================================
  -- 12. SDR sem NENHUMA permissão no funil é bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_sem_permissao, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_ou_reaproveitar_cliente(
      'pessoa_fisica', 'Nao Deveria Existir', p_telefone := '11900033333', p_funil_id := v_funil_a
    );
    assert false, 'sdr sem permissão não deveria conseguir';
  exception when insufficient_privilege then
    raise notice 'ok 12  funil sem nenhuma permissão bloqueia (42501)';
  end;

  -- =====================================================================
  -- 13. SDR com permissão só em etapa NÃO-inicial do mesmo funil é bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_outra_etapa, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_ou_reaproveitar_cliente(
      'pessoa_fisica', 'Nao Deveria Existir', p_telefone := '11900044444', p_funil_id := v_funil_a
    );
    assert false, 'permissão em etapa não-inicial não deveria autorizar a criação';
  exception when insufficient_privilege then
    raise notice 'ok 13  permissão só em etapa não-inicial bloqueia (42501)';
  end;

  -- =====================================================================
  -- 14. owner_id do cliente reaproveitado, sozinho, sem permissão, não basta.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_sem_permissao, 'role', 'authenticated')::text, true);
  begin
    -- v_cliente_invisivel tem owner_id = v_sdr_sem_permissao, que aqui está
    -- autenticado — ainda assim, sem permissão de funil, deve bloquear.
    perform public.criar_ou_reaproveitar_cliente(
      'pessoa_fisica', 'Nao Deveria Existir', p_telefone := '11900000003', p_funil_id := v_funil_a
    );
    assert false, 'owner_id sozinho não deveria autorizar a negociação nova';
  exception when insufficient_privilege then
    raise notice 'ok 14  owner_id do cliente reaproveitado, sozinho, não autoriza';
  end;

  -- =====================================================================
  -- 15. GERENTE funciona sem nenhuma linha de permissão (já demonstrado
  -- no item 5, reafirmado aqui com um cliente novo).
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  perform public.criar_ou_reaproveitar_cliente(
    'pessoa_fisica', 'Cliente Gerente Dedup', p_telefone := '11900055555', p_funil_id := v_funil_a
  );
  raise notice 'ok 15  GERENTE continua funcionando sem permissão configurada';

  -- =====================================================================
  -- 16. Concorrência real (duas sessões/processos simultâneos) não é
  -- testável neste harness — uma única transação, sem paralelismo.
  -- =====================================================================
  raise notice 'ok 16 (parcial)  concorrência real não testável neste harness; serialização revisada por leitura de código (pg_advisory_xact_lock), não por teste de corrida real — limitação documentada, não fabricada';

  -- =====================================================================
  -- 17. RLS de clientes_select/negociacoes_select continua intacta.
  -- =====================================================================
  execute 'reset role';
  assert (
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polname = 'clientes_select' and polrelid = 'public.clientes'::regclass
  ) ilike '%pode_ver_etapa%', 'clientes_select deveria continuar usando pode_ver_etapa';
  assert (
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polname = 'negociacoes_select' and polrelid = 'public.negociacoes'::regclass
  ) ilike '%pode_ver_etapa%', 'negociacoes_select deveria continuar usando pode_ver_etapa';
  raise notice 'ok 17  clientes_select/negociacoes_select intactas';

  raise notice 'criar_ou_reaproveitar_cliente_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
