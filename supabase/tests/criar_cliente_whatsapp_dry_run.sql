-- ===========================================================================
-- Dry-run da migration "Criação automática de lead a partir do WhatsApp"
-- (20261001110000_criar_cliente_whatsapp.sql, redefinida em
-- 20261008100000_leads_multinicho.sql — origem='whatsapp' explícita — este
-- arquivo estava reinstalando a versão de 20261001110000, sem o parâmetro
-- de origem, e por isso nunca pegou a regressão abaixo).
--
-- ATUALIZADO em 2026-10-16 (auditoria "corrigir-cliente-leads-definitivo"):
-- 1. A função reinstalada no passo 1 agora é a versão REAL em produção
--    (20261008100000, com `origem = 'whatsapp'` explícito).
-- 2. Passo 1-B instala temporariamente (mesmo padrão transacional de
--    `criacao_manual_sdr_e_integridade_cliente_test.sql`) a correção de
--    `criar_negociacao()` em `20261016140000_criar_negociacao_permite_
--    automacao.sql` — SEM ela, este teste FALHA contra o banco real com
--    "Você não tem permissão para criar uma negociação para esse cliente.":
--    `criar_cliente_whatsapp` (service_role, `auth.uid()` nulo) chama
--    `criar_negociacao()`, que desde 20261015140000 exige
--    `is_gerente() OR pode_mover_etapa(...)` SEM isentar automação — ambos
--    são estruturalmente `false` quando `auth.uid()` é nulo. Resultado real
--    encontrado em produção: todo contato novo de WhatsApp parou de criar
--    cliente/negociação (a transação inteira reverte, sem deixar cliente
--    órfão, mas perdendo o lead). Rode este arquivo SEM o passo 1-B pra
--    reproduzir a falha original.
-- 3. Passo F13 novo: confirma `origem = 'whatsapp'` na negociação criada
--    (nunca testado antes).
-- 4. Passo F14 novo: um usuário autenticado comum, sem `pode_mover_etapa`
--    nem gerente, continua BLOQUEADO ao chamar `criar_negociacao()`
--    diretamente — a correção isenta só `auth.uid()` nulo (automação), não
--    afrouxa a regra pra usuário real nenhum.
--
-- ATUALIZADO em 2026-10-16 (segunda rodada, mesma auditoria) — VULNERABILIDADE
-- encontrada ao verificar grants depois de aplicar 20261016140000: `anon`
-- (e `public`) tinham EXECUTE em `criar_negociacao()`. Como `auth.uid()`
-- nulo passou a significar "automação, sempre autorizada", e a chave `anon`
-- TAMBÉM produz `auth.uid()` nulo (sem `sub` no JWT), uma chamada não
-- autenticada passava pela mesma isenção. Corrigido em
-- `20261016150000_criar_negociacao_restringe_grants.sql` (só GRANT/REVOKE,
-- nenhuma linha do corpo da função). Passo 1-C instala essa correção
-- temporariamente; G1-G6 provam o antes/depois.
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute (ou
--   `supabase db query --linked -f supabase/tests/criar_cliente_whatsapp_dry_run.sql`).
--   Ele:
--     1. Aplica a função inteira (idêntica a
--        supabase/migrations/20261001110000_criar_cliente_whatsapp.sql — se
--        um dos dois arquivos mudar, atualize o outro).
--     2. Confirma a assinatura final `(text, text, uuid)` e os grants de
--        EXECUTE: só `service_role`, nem `authenticated` nem `anon`.
--     3. Cria fixtures descartáveis (perfil, funil com 2 etapas abertas +
--        ganha + perdida, conversa sem cliente) e aponta a linha única de
--        `whatsapp_conexoes` pra elas.
--     4. Chama `criar_cliente_whatsapp()` e confere cliente, owner_id,
--        negociação, funil, primeira etapa aberta, vínculo da conversa e
--        histórico.
--     5. Chama de novo pra MESMA conversa e confere idempotência: mesmos
--        ids de volta, nenhum cliente/negociação/histórico novo.
--     6. `ROLLBACK` no final: nada disso fica gravado, nem em sucesso nem em
--        falha — inclusive a função em si (ainda não está na migration real
--        até o `db push`).
--
--   Os resultados ficam numa tabela temporária `_log` e aparecem no SELECT
--   final (antes do ROLLBACK) — `supabase db query` não propaga `RAISE
--   NOTICE` pro terminal, por isso o log vai por linhas de resultado em vez
--   de notice. Se `TODAS AS ASSERCOES PASSARAM` aparecer na última linha, a
--   migration real pode ser aplicada com `supabase db push`.
--
-- PRÉ-REQUISITO
--   Pressupõe que `whatsapp_conexoes` já tem a linha única (criada pelo
--   whatsapp-service na primeira conexão) — se a tabela estiver vazia, o
--   teste falha na própria função com uma mensagem clara ("Configuração do
--   WhatsApp... não encontrada"), não silenciosamente.
-- ===========================================================================

begin;

create temp table _log (id serial primary key, passo text);

-- ---------------------------------------------------------------------------
-- 1. A função, na íntegra — cópia de
--    supabase/migrations/20261001110000_criar_cliente_whatsapp.sql.
-- ---------------------------------------------------------------------------
create or replace function public.criar_cliente_whatsapp(
  p_telefone     text,
  p_nome         text,
  p_conversa_id  uuid
)
returns table (cliente_id uuid, negociacao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa               public.conversas%rowtype;
  v_funil_id               uuid;
  v_responsavel_padrao_id  uuid;
  v_cliente_id             uuid;
  v_negociacao_id          uuid;
begin
  select * into v_conversa
    from public.conversas
   where id = p_conversa_id
     for update;

  if v_conversa.id is null then
    raise exception 'Conversa % não encontrada.', p_conversa_id using errcode = 'P0002';
  end if;

  if v_conversa.telefone <> p_telefone then
    raise exception 'Telefone informado não corresponde à conversa %.', p_conversa_id
      using errcode = '22023';
  end if;

  if v_conversa.cliente_id is not null then
    select n.id into v_negociacao_id
      from public.negociacoes n
     where n.cliente_id = v_conversa.cliente_id
     order by n.created_at
     limit 1;

    return query select v_conversa.cliente_id, v_negociacao_id;
    return;
  end if;

  select c.funil_id, c.responsavel_padrao_id
    into v_funil_id, v_responsavel_padrao_id
    from public.whatsapp_conexoes c
   where c.id = '00000000-0000-0000-0000-000000000001';

  if v_funil_id is null or v_responsavel_padrao_id is null then
    raise exception 'Configuração do WhatsApp (funil/responsável padrão) não encontrada.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.funis f
     where f.id = v_funil_id and f.ativo and f.whatsapp_habilitado
  ) then
    raise exception 'Funil % não está ativo ou não tem WhatsApp habilitado.', v_funil_id
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_responsavel_padrao_id and p.ativo) then
    raise exception 'Responsável padrão % inválido ou inativo.', v_responsavel_padrao_id
      using errcode = '23514';
  end if;

  insert into public.clientes (tipo_cliente, nome, telefone, whatsapp, owner_id)
  values ('pessoa_fisica', p_nome, p_telefone, p_telefone, v_responsavel_padrao_id)
  returning id into v_cliente_id;

  v_negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'whatsapp');

  update public.conversas
     set cliente_id = v_cliente_id
   where id = p_conversa_id;

  return query select v_cliente_id, v_negociacao_id;
end;
$$;

comment on function public.criar_cliente_whatsapp is
  'Cria cliente + negociação (primeira etapa aberta do funil configurado em '
  'whatsapp_conexoes) a partir de uma conversa de WhatsApp sem cliente '
  'vinculado, e faz o vínculo — atômico. Funil/responsável lidos direto da '
  'config, nunca recebidos como parâmetro. Só o whatsapp-service chama '
  '(service_role); idempotente por conversa_id.';

revoke all on function public.criar_cliente_whatsapp(text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.criar_cliente_whatsapp(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 1-B. Correção de criar_negociacao() — cópia EXATA de
-- 20261016140000_criar_negociacao_permite_automacao.sql. Instalação
-- transacional: some no ROLLBACK final, igual todo o resto deste arquivo.
-- ---------------------------------------------------------------------------
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

  if (select auth.uid()) is not null
     and not public.is_gerente()
     and not public.pode_mover_etapa(p_funil_id, v_etapa_id)
  then
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

-- ---------------------------------------------------------------------------
-- 1-C. Correção de grants de criar_negociacao() — cópia EXATA de
-- 20261016150000_criar_negociacao_restringe_grants.sql. Só GRANT/REVOKE,
-- nenhuma linha do corpo da função. Transacional como o resto: some no
-- ROLLBACK final.
-- ---------------------------------------------------------------------------
revoke all on function public.criar_negociacao(
  uuid, uuid, numeric, public.temperatura_negociacao, public.origem_negociacao
) from public, anon;

grant execute on function public.criar_negociacao(
  uuid, uuid, numeric, public.temperatura_negociacao, public.origem_negociacao
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Assinatura final e EXECUTE restrito.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn regprocedure := 'public.criar_cliente_whatsapp(text,text,uuid)'::regprocedure;
begin
  insert into _log (passo) values ('ok  S1  criar_cliente_whatsapp existe com assinatura (text, text, uuid)');

  assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'),
    'authenticated não deveria ter EXECUTE em criar_cliente_whatsapp';
  insert into _log (passo) values ('ok  S2  authenticated sem EXECUTE');

  assert not has_function_privilege('anon', v_fn, 'EXECUTE'),
    'anon não deveria ter EXECUTE em criar_cliente_whatsapp';
  insert into _log (passo) values ('ok  S3  anon sem EXECUTE');

  assert has_function_privilege('service_role', v_fn, 'EXECUTE'),
    'service_role deveria ter EXECUTE em criar_cliente_whatsapp';
  insert into _log (passo) values ('ok  S4  service_role com EXECUTE');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fluxo completo com fixtures descartáveis.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente            uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_sdr_sem_permissao  uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_sdr_com_permissao  uuid := 'bbbbbbbb-0000-0000-0000-000000000003';
  v_telefone         text := '5599999999999';

  v_funil_id         uuid;
  v_etapa_1          uuid;
  v_etapa_2          uuid;
  v_conversa_id      uuid;

  v_cliente_id       uuid;
  v_negociacao_id    uuid;
  v_cliente_id_2     uuid;
  v_negociacao_id_2  uuid;

  v_etapa_da_negociacao  uuid;
  v_clientes_antes       integer;
  v_negociacoes_antes    integer;
  v_historico_antes      integer;
  v_total                integer;
  v_erro                 text;
begin
  -- Perfil ativo pra ser o responsável padrão (profiles nasce via trigger
  -- handle_new_user a partir de auth.users).
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'gerente.whatsapp.dryrun@teste.local', '', now(), now(), now(),
    '{"role":"gerente"}'::jsonb, '{"nome":"Gerente WhatsApp Dry Run"}'::jsonb
  );

  -- Funil de teste com 2 etapas abertas, ganha e perdida — inserido direto
  -- (sem criar_funil()) porque este bloco não simula sessão autenticada.
  insert into public.funis (nome, ativo, whatsapp_habilitado)
  values ('Funil WhatsApp Dry Run', true, true)
  returning id into v_funil_id;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Lead Novo Dry Run', 'azul', 1000, 'aberta')
    returning id into v_etapa_1;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Segunda Etapa Dry Run', 'violeta', 2000, 'aberta')
    returning id into v_etapa_2;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Fechado Dry Run', 'verde', 100000, 'ganha');
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo)
    values (v_funil_id, 'Perdido Dry Run', 'vermelho', 100001, 'perdida');

  -- Conversa de teste: telefone desconhecido, sem cliente.
  insert into public.conversas (telefone, ultima_mensagem_em)
  values (v_telefone, now())
  returning id into v_conversa_id;

  -- Aponta a linha única de whatsapp_conexoes pro funil/responsável de
  -- teste — desfeito pelo ROLLBACK final, não precisa restaurar manualmente.
  update public.whatsapp_conexoes
     set funil_id = v_funil_id, responsavel_padrao_id = v_gerente;

  if not found then
    raise exception 'whatsapp_conexoes está vazia — rode o whatsapp-service ao menos uma vez antes deste dry-run.';
  end if;

  -- =========================================================================
  -- 4. Primeira chamada — cria cliente + negociação.
  -- =========================================================================
  select cliente_id, negociacao_id
    into v_cliente_id, v_negociacao_id
    from public.criar_cliente_whatsapp(v_telefone, 'Contato WhatsApp — ' || v_telefone, v_conversa_id);

  assert v_cliente_id is not null, 'deveria ter criado o cliente';
  assert v_negociacao_id is not null, 'deveria ter criado a negociação';
  insert into _log (passo) values (format('ok  F1  primeira chamada cria cliente %s e negociação %s', v_cliente_id, v_negociacao_id));

  assert (select owner_id from public.clientes where id = v_cliente_id) = v_gerente,
    'owner_id do cliente deveria ser o responsável padrão configurado';
  insert into _log (passo) values ('ok  F2  cliente.owner_id = responsavel_padrao_id configurado');

  assert (select owner_id from public.negociacoes where id = v_negociacao_id) = v_gerente,
    'owner_id da negociação deveria seguir o do cliente (trigger negociacoes_sincroniza_owner)';
  insert into _log (passo) values ('ok  F3  negociacao.owner_id = owner do cliente (via trigger, não um parâmetro)');

  assert (select funil_id from public.negociacoes where id = v_negociacao_id) = v_funil_id,
    'negociação deveria pertencer ao funil configurado em whatsapp_conexoes';
  insert into _log (passo) values ('ok  F4  negociação pertence ao funil configurado');

  select etapa_id into v_etapa_da_negociacao from public.negociacoes where id = v_negociacao_id;
  assert v_etapa_da_negociacao = v_etapa_1,
    format('negociação deveria entrar na 1a etapa aberta (%s), entrou em %s', v_etapa_1, v_etapa_da_negociacao);
  insert into _log (passo) values ('ok  F5  negociação entra na primeira etapa aberta do funil (menor ordem)');

  assert (select cliente_id from public.conversas where id = v_conversa_id) = v_cliente_id,
    'conversa deveria ter recebido o cliente_id criado';
  insert into _log (passo) values ('ok  F6  conversa vinculada ao cliente criado');

  select count(*) into v_total from public.historico_etapas where negociacao_id = v_negociacao_id;
  assert v_total = 1, format('historico_etapas deveria ter 1 linha pra negociação nova, tem %s', v_total);
  insert into _log (passo) values ('ok  F7  historico_etapas registrou a entrada na etapa (1 linha)');

  -- =========================================================================
  -- 5. Segunda chamada, mesma conversa — idempotência.
  -- =========================================================================
  select count(*) into v_clientes_antes from public.clientes;
  select count(*) into v_negociacoes_antes from public.negociacoes;
  select count(*) into v_historico_antes from public.historico_etapas;

  select cliente_id, negociacao_id
    into v_cliente_id_2, v_negociacao_id_2
    from public.criar_cliente_whatsapp(v_telefone, 'Contato WhatsApp — ' || v_telefone, v_conversa_id);

  assert v_cliente_id_2 = v_cliente_id, 'segunda chamada deveria devolver o MESMO cliente_id';
  assert v_negociacao_id_2 = v_negociacao_id, 'segunda chamada deveria devolver a MESMA negociacao_id';
  insert into _log (passo) values ('ok  F8  segunda chamada é idempotente: mesmos ids de volta');

  select count(*) into v_total from public.clientes;
  assert v_total = v_clientes_antes,
    format('segunda chamada não deveria criar outro cliente (antes=%s depois=%s)', v_clientes_antes, v_total);
  insert into _log (passo) values ('ok  F9  nenhum cliente novo na segunda chamada');

  select count(*) into v_total from public.negociacoes;
  assert v_total = v_negociacoes_antes,
    format('segunda chamada não deveria criar outra negociação (antes=%s depois=%s)', v_negociacoes_antes, v_total);
  insert into _log (passo) values ('ok  F10 nenhuma negociação nova na segunda chamada');

  select count(*) into v_total from public.historico_etapas;
  assert v_total = v_historico_antes, 'segunda chamada não deveria mexer no histórico';
  insert into _log (passo) values ('ok  F11 historico_etapas inalterado na segunda chamada');

  -- =========================================================================
  -- 6. Consistência: 1 cliente, 1 negociação, ligados corretamente.
  -- =========================================================================
  select count(*) into v_total from public.negociacoes where cliente_id = v_cliente_id;
  assert v_total = 1, format('cliente deveria ter exatamente 1 negociação, tem %s', v_total);
  insert into _log (passo) values ('ok  F12 cliente tem exatamente 1 negociação após as duas chamadas (sem duplicata)');

  assert (select origem from public.negociacoes where id = v_negociacao_id) = 'whatsapp',
    'negociação criada por criar_cliente_whatsapp deveria ter origem = whatsapp';
  insert into _log (passo) values ('ok  F13 negociacao.origem = ''whatsapp''');

  -- =========================================================================
  -- 7. A correção isenta só automação (auth.uid() nulo) — um usuário REAL
  -- autenticado, sem ser gerente e sem pode_mover_etapa neste funil,
  -- continua bloqueado ao chamar criar_negociacao() diretamente.
  -- =========================================================================
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_sdr_sem_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'sdr.sem.permissao.whatsapp.dryrun@teste.local', '', now(), now(), now(),
    '{"role":"sdr"}'::jsonb, '{"nome":"SDR Sem Permissão Dry Run"}'::jsonb
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_sem_permissao, 'role', 'authenticated')::text, true);
  begin
    perform public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'manual');
    raise exception 'deveria ter bloqueado: SDR sem permissoes_colaborador neste funil, nem gerente';
  exception
    when sqlstate '42501' then
      null; -- esperado
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  F14 usuário real sem permissão continua bloqueado — a isenção vale só pra auth.uid() nulo (automação)');

  -- =========================================================================
  -- 8. Grants de criar_negociacao() — a correção do passo 1-C.
  -- =========================================================================
  assert not has_function_privilege('anon', 'public.criar_negociacao(uuid,uuid,numeric,temperatura_negociacao,origem_negociacao)', 'EXECUTE'),
    'anon não deveria ter EXECUTE em criar_negociacao depois da correção';
  insert into _log (passo) values ('ok  G1  anon sem EXECUTE em criar_negociacao');

  assert has_function_privilege('authenticated', 'public.criar_negociacao(uuid,uuid,numeric,temperatura_negociacao,origem_negociacao)', 'EXECUTE'),
    'authenticated deveria continuar com EXECUTE em criar_negociacao';
  insert into _log (passo) values ('ok  G2  authenticated com EXECUTE em criar_negociacao');

  assert has_function_privilege('service_role', 'public.criar_negociacao(uuid,uuid,numeric,temperatura_negociacao,origem_negociacao)', 'EXECUTE'),
    'service_role deveria continuar com EXECUTE em criar_negociacao';
  insert into _log (passo) values ('ok  G3  service_role com EXECUTE em criar_negociacao');

  -- Teste de verdade no nível de GRANT (não só JWT/auth.uid()): troca o
  -- ROLE do Postgres de fato pra `anon` e tenta chamar a função — deve
  -- falhar por falta de privilégio, antes mesmo de qualquer lógica de
  -- auth.uid()/pode_mover_etapa rodar.
  set role anon;
  begin
    perform public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'manual');
    reset role;
    raise exception 'deveria ter negado por falta de privilégio (GRANT), não por regra de negócio';
  exception
    when insufficient_privilege then
      reset role;
      null; -- esperado: "permission denied for function criar_negociacao"
  end;
  insert into _log (passo) values ('ok  G4  anon não consegue chamar criar_negociacao (permission denied, nível de GRANT)');

  -- Usuário autenticado REAL, COM permissão, continua funcionando depois da
  -- correção de grants — a restrição é só pra anon/public, nunca pra quem
  -- tem auth.uid() preenchido e pode_mover_etapa configurado.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_sdr_com_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'sdr.com.permissao.whatsapp.dryrun@teste.local', '', now(), now(), now(),
    '{"role":"sdr"}'::jsonb, '{"nome":"SDR Com Permissão Dry Run"}'::jsonb
  );

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_com_permissao, v_funil_id, null, null, null, v_gerente),
    (v_sdr_com_permissao, v_funil_id, v_etapa_1, true, true, v_gerente);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_com_permissao, 'role', 'authenticated')::text, true);
  perform public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'manual');
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  G5  authenticated COM pode_mover_etapa continua conseguindo criar negociação');

  -- criar_cliente_whatsapp (automação, auth.uid() nulo) continua funcionando
  -- depois da correção de grants — já provado end-to-end em F1-F14 acima,
  -- que correram DEPOIS do passo 1-C nesta mesma transação.
  insert into _log (passo) values ('ok  G6  criar_cliente_whatsapp (F1-F14) já rodou depois da correção de grants — automação intacta');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - criar_cliente_whatsapp().');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
