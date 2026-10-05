-- ===========================================================================
-- Dry-run da migration "Envio de mensagens de texto pelo CRM"
-- (20261001130000_mensagens_envio.sql).
--
-- COMO RODAR
--   `supabase db query --linked -f supabase/tests/mensagens_envio_dry_run.sql`
--   (ou cole no SQL Editor). Ele:
--     1. Aplica a migration inteira (idêntica ao arquivo em
--        supabase/migrations/ — se um dos dois mudar, atualize o outro).
--     2. Cria fixtures descartáveis: gerente, closer A, closer B, cliente do
--        closer A, conversa vinculada.
--     3. Testa a RLS de INSERT: closer dono pode mandar saída de texto
--        pendente; closer alheio é barrado; gerente pode em qualquer
--        conversa; texto vazio é barrado pelo CHECK; `authenticated`
--        não consegue mudar o status (sem policy de UPDATE, mesmo já
--        tendo o grant de UPDATE que o Supabase concede por padrão).
--     4. Confere o índice parcial e o enum.
--     5. `ROLLBACK` no final — nada fica gravado, nem a migration em si.
--
--   Resultados ficam numa tabela temporária `_log`, mostrados no SELECT
--   final antes do ROLLBACK (`RAISE NOTICE` não aparece via `db query`).
-- ===========================================================================

begin;

create temp table _log (id serial primary key, passo text);
-- O bloco de fixtures faz `set local role authenticated` pra simular sessões
-- de closer/gerente — sem estes grants, o INSERT de log falha com "permission
-- denied for table _log" (ou para a sequence) assim que o role muda.
grant insert on _log to authenticated;
grant usage on _log_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 1. A migration, na íntegra.
-- ---------------------------------------------------------------------------
create type public.status_mensagem as enum ('pendente', 'enviando', 'enviado', 'falhou');

alter table public.mensagens
  add column status    public.status_mensagem,
  add column autor_id  uuid references public.profiles (id) on delete set null;

comment on column public.mensagens.status is
  'Ciclo de envio (pendente → enviando → enviado/falhou), só pra direcao=saida. Mensagens de entrada ficam null.';
comment on column public.mensagens.autor_id is
  'Quem escreveu a mensagem de saída pelo CRM. Mensagens de entrada (do cliente) ficam null.';

create index mensagens_pendentes_idx
  on public.mensagens (created_at)
  where status = 'pendente';

alter table public.mensagens
  add constraint mensagens_saida_texto_nao_vazio
  check (
    not (direcao = 'saida' and tipo = 'texto')
    or (conteudo is not null and length(btrim(conteudo)) > 0)
  );

create policy mensagens_insert on public.mensagens
  for insert to authenticated
  with check (
    direcao = 'saida'
    and tipo = 'texto'
    and status = 'pendente'
    and autor_id = (select auth.uid())
    and exists (
      select 1 from public.conversas cv
      where cv.id = mensagens.conversa_id
        and (
          public.is_gerente()
          or exists (
            select 1 from public.clientes c
            where c.id = cv.cliente_id
              and c.owner_id = (select auth.uid())
          )
        )
    )
  );

grant insert on table public.mensagens to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Schema: enum e índice.
-- ---------------------------------------------------------------------------
do $$
declare
  v_total integer;
begin
  select count(*) into v_total
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
   where t.typname = 'status_mensagem';
  assert v_total = 4, format('status_mensagem deveria ter 4 valores, tem %s', v_total);
  insert into _log (passo) values ('ok  S1  enum status_mensagem com 4 valores (pendente/enviando/enviado/falhou)');

  assert exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'mensagens' and indexname = 'mensagens_pendentes_idx'
  ), 'índice parcial mensagens_pendentes_idx deveria existir';
  insert into _log (passo) values ('ok  S2  índice parcial mensagens_pendentes_idx existe');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fixtures descartáveis.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente    uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_closer_a   uuid := 'cccccccc-0000-0000-0000-000000000002';
  v_closer_b   uuid := 'cccccccc-0000-0000-0000-000000000003';

  v_cliente_a  uuid;
  v_conversa_a uuid;
  v_msg_id     uuid;
  v_erro       text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    (v_gerente,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.envio@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Envio"}'::jsonb),
    (v_closer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.a.envio@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer A Envio"}'::jsonb),
    (v_closer_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.b.envio@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer B Envio"}'::jsonb);

  insert into public.clientes (nome, owner_id) values ('Cliente Envio Dry Run', v_closer_a)
    returning id into v_cliente_a;

  insert into public.conversas (telefone, cliente_id, ultima_mensagem_em)
  values ('5599888888888', v_cliente_a, now())
  returning id into v_conversa_a;

  execute 'set local role authenticated';

  -- =========================================================================
  -- Closer A (dono do cliente): pode mandar saída de texto pendente.
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);

  insert into public.mensagens (conversa_id, direcao, tipo, status, conteudo, autor_id)
  values (v_conversa_a, 'saida', 'texto', 'pendente', 'Olá, tudo bem?', v_closer_a)
  returning id into v_msg_id;

  assert v_msg_id is not null, 'closer dono deveria conseguir inserir mensagem de saída';
  assert (select status from public.mensagens where id = v_msg_id) = 'pendente',
    'mensagem nova deveria nascer pendente';
  insert into _log (passo) values ('ok  F1  closer dono insere mensagem de saída pendente na própria conversa');

  -- Texto vazio é barrado pelo CHECK, mesmo sendo o dono.
  begin
    insert into public.mensagens (conversa_id, direcao, tipo, status, conteudo, autor_id)
    values (v_conversa_a, 'saida', 'texto', 'pendente', '   ', v_closer_a);
    assert false, 'mensagem de saída com texto vazio não deveria ser aceita';
  exception when check_violation then
    insert into _log (passo) values ('ok  F2  texto vazio/só espaço é barrado pelo CHECK mensagens_saida_texto_nao_vazio');
  end;

  -- autor_id falso (não o próprio auth.uid()) é barrado pela RLS.
  begin
    insert into public.mensagens (conversa_id, direcao, tipo, status, conteudo, autor_id)
    values (v_conversa_a, 'saida', 'texto', 'pendente', 'Forjado', v_closer_b);
    assert false, 'autor_id diferente do auth.uid() não deveria ser aceito';
  exception when insufficient_privilege then
    insert into _log (passo) values ('ok  F3  autor_id != auth.uid() é barrado pela RLS (new row violates RLS)');
  end;

  -- =========================================================================
  -- Closer B (NÃO é dono do cliente da conversa A): barrado.
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_b, 'role', 'authenticated')::text, true);

  begin
    insert into public.mensagens (conversa_id, direcao, tipo, status, conteudo, autor_id)
    values (v_conversa_a, 'saida', 'texto', 'pendente', 'Invasão', v_closer_b);
    assert false, 'closer alheio não deveria conseguir mandar mensagem na conversa de outro closer';
  exception when insufficient_privilege then
    insert into _log (passo) values ('ok  F4  closer alheio é barrado pela RLS (não vê a conversa de outro closer)');
  end;

  -- UPDATE de status por authenticated: o Supabase já concede UPDATE a
  -- `authenticated` por padrão (grant de tabela não é o portão aqui, RLS é).
  -- Sem policy de UPDATE, a ausência de USING faz a linha não casar pra
  -- ninguém -> 0 linhas afetadas, sem exceção (checamos row_count, não um
  -- SELECT de volta: closer B também não tem SELECT nessa conversa, então
  -- ler o status aqui daria NULL por RLS, não pela transição ter sido
  -- bloqueada).
  declare
    v_count int;
  begin
    update public.mensagens set status = 'enviado' where id = v_msg_id;
    get diagnostics v_count = row_count;
    assert v_count = 0,
      'authenticated não deveria conseguir alterar o status (sem policy de UPDATE, RLS zera o USING)';
    insert into _log (passo) values ('ok  F5  authenticated não muda status em mensagens (sem policy de UPDATE, RLS zera as linhas)');
  end;

  -- =========================================================================
  -- Gerente: pode mandar mensagem em QUALQUER conversa, inclusive a do closer A.
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  insert into public.mensagens (conversa_id, direcao, tipo, status, conteudo, autor_id)
  values (v_conversa_a, 'saida', 'texto', 'pendente', 'Mensagem do gerente', v_gerente);
  insert into _log (passo) values ('ok  F6  gerente insere mensagem de saída em conversa de qualquer closer');

  reset role;

  -- =========================================================================
  -- service_role (via bypass de RLS, papel atual da sessão): pode mudar status.
  -- =========================================================================
  update public.mensagens set status = 'enviado', whatsapp_message_id = 'ABC123' where id = v_msg_id;
  assert (select status from public.mensagens where id = v_msg_id) = 'enviado',
    'a transição de status deveria funcionar fora do contexto authenticated (service_role/bypass RLS)';
  insert into _log (passo) values ('ok  F7  transição pendente -> enviado funciona fora de authenticated (service_role)');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - mensagens_envio.');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    reset role;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
