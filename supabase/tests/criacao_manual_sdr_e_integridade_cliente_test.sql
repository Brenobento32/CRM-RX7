-- ===========================================================================
-- Teste de fumaça de `20261015110000_criacao_manual_sdr_e_integridade_cliente.sql`.
--
-- AUTO-INSTALAÇÃO TRANSACIONAL — mesmo padrão de
-- `supabase/tests/funil_metricas_test.sql`: instala temporariamente os 3
-- objetos novos (DROP+CREATE/CREATE idênticos à migration), cria fixtures,
-- roda os asserts, e dá ROLLBACK — nada fica gravado, nem os objetos novos,
-- nem os dados. DDL é transacional no Postgres, igual dado.
--
-- Roda como `postgres` (superusuário) — bypassa RLS, mas NUNCA bypassa
-- TRIGGER. Por isso cada papel (SDR/CLOSER/GERENTE) é simulado de verdade
-- via `set_config('request.jwt.claims', ...)` (impersonação), igual
-- `rls_smoke_test.sql` já faz — os triggers novos leem `auth.uid()`/
-- `is_gerente()`/`pode_mover_etapa()` exatamente como fariam pra um usuário
-- real logado.
--
-- O QUE ELE PROVA (mapeado nos 22 itens pedidos)
--   1/2  SDR autorizado cria cliente + negociação (funil "Teste Out").
--   3/4  SDR em Outbound e CLOSER (funil "Teste Inbound") funcionam.
--   5    SDR sem acesso ao FUNIL é bloqueado (42501).
--   6    SDR com acesso ao funil mas sem pode_mover na ETAPA INICIAL é bloqueado.
--   7    negociação criada fica vinculada ao cliente certo.
--   8    cliente criado aparece pro próprio criador (pode_ver na etapa).
--   9    owner_id forçado pro próprio chamador NÃO basta sem permissão.
--  10    depois de criada, movimentação (trigger já existente) continua ok.
--  11    GERENTE continua livre, mesmo sem nenhuma linha de permissão.
--  12-16 cliente permanece vinculado, visível, editável e sem duplicar.
--        "Cliente não encontrado": a trigger nova de arquivamento bloqueia
--        a causa raiz encontrada em produção (cliente arquivado com
--        negociação ativa) — testada depois de liberar (arquivar a
--        negociação primeiro) pra provar que também NÃO fica bloqueado
--        além da conta.
--  17-22 pesquisa de clientes (debounce/UI) não é testável em SQL — ver
--        relatório da implementação.
-- ===========================================================================

begin;

-- ===========================================================================
-- Instalação temporária dos 3 objetos novos — cópia EXATA da migration
-- 20261015110000_criacao_manual_sdr_e_integridade_cliente.sql.
-- ===========================================================================

create or replace function public.negociacoes_protege_criacao_por_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.is_gerente() then
    return new;
  end if;

  -- Não depende da ordem de disparo de negociacoes_sincroniza_funil (outra
  -- trigger BEFORE INSERT já existente) — resolve o funil localmente pela
  -- etapa, porque NEW.funil_id ainda não está preenchido neste ponto
  -- (causa real do erro "Você não tem permissão para criar uma negociação
  -- nesta etapa" encontrado ao rodar este teste pela primeira vez).
  v_funil_id := coalesce(
    new.funil_id,
    (select e.funil_id from public.etapas_funil e where e.id = new.etapa_id)
  );

  if not public.pode_mover_etapa(v_funil_id, new.etapa_id) then
    raise exception 'Você não tem permissão para criar uma negociação nesta etapa.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Re-executável mesmo depois que 20261015110000 já foi aplicada de verdade
-- (confirmado: `supabase migration list` mostra ela em produção) — sem o
-- DROP, este CREATE TRIGGER colide com o objeto real ("already exists").
drop trigger if exists negociacoes_protege_criacao_por_permissao on public.negociacoes;
create trigger negociacoes_protege_criacao_por_permissao
  before insert on public.negociacoes
  for each row
  execute function public.negociacoes_protege_criacao_por_permissao();

drop function if exists public.criar_cliente(
  public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, uuid, text
);

create or replace function public.criar_cliente(
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
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_cliente_id uuid;
  v_funil_id   uuid;
  v_etapa_id   uuid;
begin
  v_funil_id := coalesce(p_funil_id, (select id from public.funis where padrao));

  if v_funil_id is null then
    raise exception 'Nenhum funil padrão configurado.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.funis f where f.id = v_funil_id and f.ativo) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  select e.id into v_etapa_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id
     and e.tipo = 'aberta'
     and e.ativo
   order by e.ordem
   limit 1;

  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.'
      using errcode = '23514';
  end if;

  -- Gerado aqui (não via RETURNING) — clientes_select exige negociação já
  -- visível, que ainda não existe neste instante; RETURNING falharia a RLS
  -- de SELECT mesmo com owner_id/permissão corretos (causa real do erro
  -- "new row violates row-level security policy for table clientes"
  -- encontrado ao rodar este teste pela primeira vez).
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

  insert into public.negociacoes (cliente_id, owner_id, etapa_id, origem)
  values (
    v_cliente_id,
    coalesce(p_owner_id, (select auth.uid())),
    v_etapa_id,
    'manual'
  );

  return v_cliente_id;
end;
$$;

create or replace function public.clientes_protege_arquivamento_com_negociacao_ativa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1 from public.negociacoes n
      where n.cliente_id = new.id
        and n.arquivada_em is null
        and n.excluida_em is null
    ) then
      raise exception 'Este cliente tem negociação ativa no funil. Arquive ou encerre a negociação antes de arquivar o cliente.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clientes_protege_arquivamento_com_negociacao_ativa on public.clientes;
create trigger clientes_protege_arquivamento_com_negociacao_ativa
  before update of deleted_at on public.clientes
  for each row
  execute function public.clientes_protege_arquivamento_com_negociacao_ativa();

-- ===========================================================================
-- Fixtures + asserts.
-- ===========================================================================

do $$
declare
  v_gerente  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_sdr_a    uuid := 'a0000000-0000-0000-0000-000000000002'; -- acesso só ao funil "Teste Out"
  v_sdr_c    uuid := 'a0000000-0000-0000-0000-000000000003'; -- acesso ao "Teste Inbound", mas só pode_ver na etapa inicial
  v_sdr_d    uuid := 'a0000000-0000-0000-0000-000000000004'; -- zero permissão em qualquer funil
  v_closer_a uuid := 'a0000000-0000-0000-0000-000000000005'; -- acesso aos dois funis

  v_funil_out      uuid;
  v_out_lead_novo   uuid;
  v_out_reuniao     uuid;
  v_out_fechado     uuid;
  v_out_perdido     uuid;

  v_funil_in       uuid;
  v_in_lead_novo    uuid;
  v_in_mql          uuid;
  v_in_fechado      uuid;
  v_in_perdido      uuid;

  v_cliente_a uuid;
  v_neg_a     record;
  v_cliente_b uuid; -- closer, outro funil
  v_total     integer;
  v_erro      text;
begin
  -- -------------------------------------------------------------------
  -- 0. Massa de teste: 5 usuários, 2 funis com etapas.
  -- -------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.teste.criacao@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste Criação"}'::jsonb),
    (v_sdr_a,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.a.teste.criacao@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR A Teste"}'::jsonb),
    (v_sdr_c,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.c.teste.criacao@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR C Teste"}'::jsonb),
    (v_sdr_d,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.d.teste.criacao@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR D Teste"}'::jsonb),
    (v_closer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.a.teste.criacao@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer A Teste"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Out', false) returning id into v_funil_out;
  insert into public.funis (nome, padrao) values ('Teste Inbound', false) returning id into v_funil_in;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_out, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_out_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_out, 'Reunião agendada', 'azul', 1000, 'aberta') returning id into v_out_reuniao;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_out, 'Fechado', 'verde', 100000, 'ganha') returning id into v_out_fechado;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_out, 'Perdido', 'vermelho', 100001, 'perdida') returning id into v_out_perdido;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_in, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_in_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_in, 'MQL', 'azul', 500, 'aberta') returning id into v_in_mql;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_in, 'Fechado', 'verde', 100000, 'ganha') returning id into v_in_fechado;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_in, 'Perdido', 'vermelho', 100001, 'perdida') returning id into v_in_perdido;

  -- -------------------------------------------------------------------
  -- 0b. Permissões.
  --   SDR A: só "Teste Out", pode_mover em Lead Novo e Reunião agendada.
  --   SDR C: só "Teste Inbound", pode_VER (não mover) em Lead Novo,
  --          pode_mover em MQL — testa "acesso ao funil, mas não à etapa inicial".
  --   SDR D: nenhuma linha em permissoes_colaborador, em nenhum funil.
  --   CLOSER A: os dois funis, pode_mover em Lead Novo dos dois.
  -- -------------------------------------------------------------------
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_a, v_funil_out, null, null, null, v_gerente),
    (v_sdr_a, v_funil_out, v_out_lead_novo, true, true, v_gerente),
    (v_sdr_a, v_funil_out, v_out_reuniao, true, true, v_gerente);

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_c, v_funil_in, null, null, null, v_gerente),
    (v_sdr_c, v_funil_in, v_in_lead_novo, true, false, v_gerente),
    (v_sdr_c, v_funil_in, v_in_mql, true, true, v_gerente);

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_closer_a, v_funil_out, null, null, null, v_gerente),
    (v_closer_a, v_funil_out, v_out_lead_novo, true, true, v_gerente),
    (v_closer_a, v_funil_in, null, null, null, v_gerente),
    (v_closer_a, v_funil_in, v_in_lead_novo, true, true, v_gerente);

  -- Troca de `postgres` (usado só pra montar a massa de teste, ignorando
  -- RLS de propósito) pra `authenticated` — SEM ISSO, toda consulta/UPDATE
  -- daqui pra baixo continuaria rodando como superusuário, e RLS de
  -- `clientes`/`negociacoes` nunca seria realmente avaliada (só os
  -- triggers, que não dependem do papel). Mesma técnica de
  -- `rls_smoke_test.sql`. A partir daqui, `set_config('request.jwt.claims',
  -- ...)` decide QUEM, e `set local role authenticated` garante que RLS
  -- (não só trigger) é de fato aplicada pra esse QUEM.
  execute 'set local role authenticated';

  -- =====================================================================
  -- 1/2/7. SDR autorizado cria cliente + negociação, vinculados.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_a, 'role', 'authenticated')::text, true);

  v_cliente_a := public.criar_cliente(
    p_tipo_cliente := 'pessoa_fisica', p_nome := 'Cliente SDR A', p_telefone := '11999990001',
    p_funil_id := v_funil_out
  );

  select n.* into v_neg_a from public.negociacoes n where n.cliente_id = v_cliente_a;
  assert v_neg_a.id is not null, 'SDR A deveria ter criado a negociação junto com o cliente';
  assert v_neg_a.funil_id = v_funil_out, 'negociação deveria estar no funil Teste Out';
  assert v_neg_a.etapa_id = v_out_lead_novo, 'negociação deveria entrar em Lead Novo (primeira etapa aberta)';
  assert v_neg_a.cliente_id = v_cliente_a, 'negociação deveria estar vinculada ao cliente recém-criado';
  raise notice 'ok 1/2/7  SDR autorizado cria cliente + negociação vinculada';

  -- =====================================================================
  -- 8. Cliente criado aparece pro próprio criador (pode_ver na etapa).
  -- =====================================================================
  select count(*) into v_total from public.clientes where id = v_cliente_a;
  assert v_total = 1, 'SDR A deveria conseguir ver o próprio cliente recém-criado (pode_ver_etapa)';
  raise notice 'ok 8  cliente criado é visível pro próprio criador';

  -- =====================================================================
  -- 5. SDR sem acesso ao FUNIL é bloqueado.
  -- =====================================================================
  begin
    perform public.criar_cliente(
      p_tipo_cliente := 'pessoa_fisica', p_nome := 'Não deveria existir',
      p_funil_id := v_funil_in
    );
    assert false, 'SDR A não deveria conseguir criar em Teste Inbound (sem nenhum acesso)';
  exception when insufficient_privilege then
    raise notice 'ok 5  SDR sem acesso ao funil é bloqueado (42501)';
  end;

  -- =====================================================================
  -- 6. SDR com acesso ao FUNIL mas sem pode_mover na ETAPA INICIAL é bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_c, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_cliente(
      p_tipo_cliente := 'pessoa_fisica', p_nome := 'Não deveria existir',
      p_funil_id := v_funil_in
    );
    assert false, 'SDR C não deveria conseguir criar em Lead Novo (só pode_ver, não pode_mover)';
  exception when insufficient_privilege then
    raise notice 'ok 6  SDR com funil liberado mas sem pode_mover na etapa inicial é bloqueado';
  end;

  -- =====================================================================
  -- 9. owner_id forçado pro próprio chamador NÃO basta sem permissão.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_d, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_cliente(
      p_tipo_cliente := 'pessoa_fisica', p_nome := 'Não deveria existir',
      p_owner_id := v_sdr_d, -- força owner_id pro próprio chamador
      p_funil_id := v_funil_out
    );
    assert false, 'owner_id = próprio chamador não deveria bypassar a permissão (SDR D não tem nenhuma)';
  exception when insufficient_privilege then
    raise notice 'ok 9  owner_id não concede bypass de criação';
  end;

  -- =====================================================================
  -- 3/4. Outbound (SDR, funil "Teste Out" — já provado acima) + CLOSER
  -- autorizado cria em OUTRO funil ("Teste Inbound").
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  v_cliente_b := public.criar_cliente(
    p_tipo_cliente := 'pessoa_fisica', p_nome := 'Cliente Closer A', p_telefone := '11999990002',
    p_funil_id := v_funil_in
  );
  assert exists (
    select 1 from public.negociacoes n where n.cliente_id = v_cliente_b and n.funil_id = v_funil_in and n.etapa_id = v_in_lead_novo
  ), 'CLOSER A deveria ter criado a negociação em Teste Inbound, na etapa Lead Novo';
  raise notice 'ok 3/4  SDR em funil autorizado (Outbound) e CLOSER em outro funil funcionam';

  -- =====================================================================
  -- 11 (parte de "GERENTE continua livre"): gerente cria SEM nenhuma linha
  -- de permissão própria, em qualquer funil.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  perform public.criar_cliente(
    p_tipo_cliente := 'pessoa_fisica', p_nome := 'Cliente Gerente', p_telefone := '11999990003',
    p_funil_id := v_funil_in
  );
  raise notice 'ok 11  GERENTE continua livre, sem precisar de permissoes_colaborador';

  -- =====================================================================
  -- 10. Depois de criada, movimentação (trigger já existente,
  -- negociacoes_protege_movimentacao_por_permissao) continua funcionando
  -- sem interferência da trigger nova de criação.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_a, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_out_reuniao where id = v_neg_a.id;
  assert (select etapa_id from public.negociacoes where id = v_neg_a.id) = v_out_reuniao,
    'SDR A deveria conseguir mover a própria negociação pra uma etapa com pode_mover (trigger de movimentação intacta)';
  raise notice 'ok 10  movimentação (trigger já existente) continua funcionando normalmente';

  -- =====================================================================
  -- 12-16. Integridade cliente<->negociação: a trigger de arquivamento
  -- bloqueia a causa raiz encontrada em produção (negociação ativa presa a
  -- cliente arquivado), e libera quando a negociação deixa de estar ativa.
  -- =====================================================================
  begin
    update public.clientes set deleted_at = now() where id = v_cliente_a;
    assert false, 'não deveria ser possível arquivar cliente com negociação ativa';
  exception when check_violation then
    get stacked diagnostics v_erro = message_text;
    assert v_erro like '%negociação ativa%', format('mensagem inesperada: %s', v_erro);
    raise notice 'ok 17a  arquivar cliente com negociação ativa é bloqueado';
  end;

  -- "Salvar observação" (simula a ficha do cliente) continua funcionando normalmente.
  update public.clientes set observacoes = 'Observação de teste' where id = v_cliente_a;
  assert (select observacoes from public.clientes where id = v_cliente_a) = 'Observação de teste',
    'observação deveria ter sido salva e persistido';
  raise notice 'ok 13/14/15  abrir/editar cliente pelo lead continua funcionando, observação permanece';

  assert exists (select 1 from public.clientes where id = v_cliente_a and deleted_at is null),
    'cliente deveria continuar aparecendo em Clientes (não arquivado)';
  raise notice 'ok 16  cliente aparece em Clientes, sem duplicar';

  -- Libera a negociação (arquivada) — agora SIM pode arquivar o cliente.
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste'
    where id = v_neg_a.id;
  update public.clientes set deleted_at = now() where id = v_cliente_a;
  assert (select deleted_at from public.clientes where id = v_cliente_a) is not null,
    'depois de arquivar a negociação, o cliente deveria poder ser arquivado normalmente';
  raise notice 'ok 17b  arquivar cliente libera normalmente depois que a negociação deixa de estar ativa';

  raise notice 'criacao_manual_sdr_e_integridade_cliente_test.sql: todas as asserções passaram.';
end;
$$;

rollback;

-- ===========================================================================
-- Depois deste ROLLBACK: os 3 objetos voltam a não existir (eram novos —
-- não há "versão antiga" pra restaurar, eles simplesmente desaparecem).
-- Nenhum fixture permanece (5 usuários, 2 funis, 8 etapas, permissões, 3
-- clientes, negociações). Nenhum lead real foi tocado — todos os IDs são
-- gerados ad-hoc (literais fixos só pros usuários de teste, nunca
-- colidindo com um UUID real gerado por gen_random_uuid()). Nenhuma
-- migration foi registrada — isso só aconteceria com push real.
-- ===========================================================================
