-- ===========================================================================
-- Dry-run de "fecha o bypass de owner_id na mudança de etapa"
-- (supabase/migrations/20261014170000_protege_movimentacao_por_permissao.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. Pressupõe
--   que 20261014160000_permissoes_colaborador.sql JÁ ESTÁ aplicada (está, em
--   produção — confirmado por `npx supabase db query --linked` antes desta
--   migration) — só o trigger novo é instalado temporariamente aqui, tudo o
--   resto (permissoes_colaborador, pode_mover_etapa, is_gerente,
--   mover_negociacao, fechar_negociacao, o trigger de handoff) já existe de
--   verdade e é usado como está. ROLLBACK no fim desfaz tudo. Nada fica
--   gravado.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- O QUE ELE PROVA (numeração = lista de testes obrigatórios do pedido)
--   1  : GERENTE pode mudar etapa (UPDATE direto, sem RPC).
--   2  : CLOSER com pode_mover=true pode mudar etapa (UPDATE direto — só
--        permissão, nenhuma ligação com owner_id).
--   3  : CLOSER sem pode_mover não pode mudar etapa.
--   4  : SDR com pode_mover=true pode mudar dentro do limite do handoff.
--   5  : SDR sem pode_mover não pode mudar.
--   6  : SDR owner_id sem permissão NÃO pode mudar (UPDATE direto).
--   7  : CLOSER owner_id sem permissão NÃO pode mudar (UPDATE direto).
--   8  : chamada direta ao banco não consegue burlar — nem pelo UPDATE cru
--        (mesma via de uma chamada de API/REST ignorando a aplicação), nem
--        por OUTRO RPC não-security-definer que toque etapa_id
--        (`fechar_negociacao`, um dos 3 caminhos que motivaram esta
--        migration).
--   9  : RPC mover_negociacao continua funcionando (não quebrou com o
--        trigger novo).
--   10 : handoff SDR continua bloqueando além de "Reunião realizada", mesmo
--        com pode_mover liberado "por engano" nas duas pontas.
--   11 : owner_id não concede bypass mesmo combinado com pode_ver=true (sem
--        pode_mover) — ver nunca implica mover, e dono nunca basta.
--   12 : GERENTE continua sem precisar de nenhuma linha em
--        permissoes_colaborador.
--   13 : alterar OUTRO campo (não etapa_id) nunca é bloqueado, mesmo sem
--        nenhuma permissão configurada.
--   14 : UPDATE que repete o MESMO etapa_id (junto de outro campo) não
--        dispara bloqueio nenhum.
--   15 : nenhuma policy de escrita pré-existente (negociacoes,
--        permissoes_colaborador) foi removida ou alterada por esta
--        migration — só o trigger novo foi adicionado.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária — só o que 20261014170000 adiciona de fato.
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_protege_movimentacao_por_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.etapa_id is not distinct from old.etapa_id then
    return new;
  end if;

  if public.is_gerente() then
    return new;
  end if;

  if not public.pode_mover_etapa(new.funil_id, new.etapa_id) then
    raise exception 'Você não tem permissão para mover esta negociação.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists negociacoes_protege_movimentacao_por_permissao on public.negociacoes;
create trigger negociacoes_protege_movimentacao_por_permissao
  before update of etapa_id on public.negociacoes
  for each row
  execute function public.negociacoes_protege_movimentacao_por_permissao();

-- ===========================================================================
-- Testes.
-- ===========================================================================
do $$
declare
  v_gerente uuid := 'a1111111-1111-1111-1111-111111111111';
  v_closer  uuid := 'a2222222-2222-2222-2222-222222222222';
  v_sdr     uuid := 'a3333333-3333-3333-3333-333333333333';

  v_funil_a uuid;
  v_etapa_ag    uuid;  -- reuniao_agendada (origem padrão)
  v_etapa_re    uuid;  -- reuniao_realizada (limite do handoff)
  v_etapa_prop  uuid;  -- proposta_enviada (aberta, além do handoff)
  v_etapa_neg   uuid;  -- negociacao (aberta, outra etapa de teste)

  v_cliente_tmp uuid;
  v_neg uuid;
  v_etapa_antes uuid;
  v_valor_antes numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.protege.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run Protege"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.protege.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run Protege"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.protege.sdr@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Dry-Run Protege"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_a from public.funis where padrao;
  select id into v_etapa_ag   from public.etapas_funil where chave = 'reuniao_agendada';
  select id into v_etapa_re   from public.etapas_funil where chave = 'reuniao_realizada';
  select id into v_etapa_prop from public.etapas_funil where chave = 'proposta_enviada';
  select id into v_etapa_neg  from public.etapas_funil where chave = 'negociacao';

  -- =========================================================================
  -- 1: GERENTE pode mudar etapa — UPDATE direto, sem precisar do RPC.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 1', 'Empresa 1', v_gerente)
    returning id into v_cliente_tmp;
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;

  update public.negociacoes set etapa_id = v_etapa_prop where id = v_neg;
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_prop,
    '1 falhou: GERENTE deveria conseguir mudar etapa via UPDATE direto, sem nenhuma permissão configurada';
  raise notice 'ok  1  GERENTE muda etapa via UPDATE direto, sem RPC e sem nenhuma linha em permissoes_colaborador';

  -- =========================================================================
  -- 12: GERENTE continua sem precisar de NENHUMA linha em permissoes_colaborador.
  -- =========================================================================
  select count(*) into v_valor_antes from public.permissoes_colaborador where usuario_id = v_gerente;
  assert v_valor_antes = 0,
    '12 falhou: gerente não deveria ter (nem precisar de) nenhuma linha em permissoes_colaborador';
  raise notice 'ok  12  GERENTE moveu no teste 1 sem absolutamente nenhuma linha de permissão configurada';

  -- =========================================================================
  -- 2/9: CLOSER com pode_mover=true move — por UPDATE direto (2) e pelo RPC
  -- mover_negociacao (9).
  --
  -- Nota sobre "dono": a policy `negociacoes_update` (owner_id OR gerente)
  -- já é o PRIMEIRO portão pra qualquer UPDATE cru — ela é quem decide se a
  -- LINHA pode ser tocada, antes do trigger novo decidir se a COLUNA
  -- etapa_id pode mudar. Um CLOSER que NÃO é dono nunca conseguiria fazer
  -- nenhum UPDATE cru nesta linha (owner_id bloqueia ali, silenciosamente,
  -- 0 linhas afetadas) — com ou sem esta migration, isso nunca mudou, e não
  -- é o bug que ela corrige. Por isso o teste 2 usa um CLOSER que É dono
  -- (prova a combinação real: dono + permissão move via UPDATE cru); quem
  -- PRECISA mover sem ser dono usa o RPC `mover_negociacao` (teste 9, abaixo
  -- — SECURITY DEFINER, não passa pela RLS de owner_id).
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 2', 'Empresa 2', v_closer)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values
    (v_closer, v_funil_a, null, null, null),
    (v_closer, v_funil_a, v_etapa_ag, true, true),
    (v_closer, v_funil_a, v_etapa_prop, true, true),
    (v_closer, v_funil_a, v_etapa_neg, true, true)
  on conflict (usuario_id, funil_id, etapa_id) do update set pode_ver = true, pode_mover = true;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_prop where id = v_neg;
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_prop,
    '2 falhou: CLOSER dono, com pode_mover configurado, deveria conseguir mudar etapa via UPDATE direto';
  raise notice 'ok  2  CLOSER dono, com permissão configurada, muda etapa via UPDATE direto';

  -- 9: agora SEM ser dono (negociação de outro dono, o gerente) — só o RPC
  -- (SECURITY DEFINER) consegue, exatamente a diferença explicada acima.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 9', 'Empresa 9', v_gerente)
    returning id into v_cliente_tmp;
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  perform public.mover_negociacao(v_neg, v_etapa_neg, 1);
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_neg,
    '9 falhou: RPC mover_negociacao deveria continuar funcionando normalmente pra quem tem permissão, mesmo sem ser dono, com o trigger novo';
  raise notice 'ok  9  RPC mover_negociacao continua funcionando mesmo SEM ser dono — SECURITY DEFINER, não passa pela RLS de owner_id, e o trigger novo não quebrou esse caminho';

  -- =========================================================================
  -- 3: CLOSER sem pode_mover (mas podendo ver) não pode mudar etapa.
  --
  -- CLOSER precisa ser dono aqui (mesma nota do teste 2) — senão a RLS de
  -- owner_id já bloquearia o UPDATE sozinha, silenciosamente, e o teste
  -- "passaria" pelo motivo errado (não por causa do trigger novo).
  --
  -- Toda negociação nasce em "Lead Novo" (a etapa_inicial real do funil,
  -- não "Reunião agendada" — descoberto durante este dry-run). Como
  -- `negociacoes_select` não tem mais atalho de owner_id (20261014160000),
  -- um UPDATE só "acha" a própria linha se o ator também conseguir
  -- SELECIONÁ-la — por isso o gerente tira a negociação de "Lead Novo" e
  -- põe numa etapa onde o CLOSER já tem pode_ver (a mesma do teste 2) antes
  -- de qualquer tentativa: sem isso, o UPDATE afeta 0 linhas silenciosamente
  -- (sem erro) e o teste "passaria" pelo motivo errado.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 3', 'Empresa 3', v_closer)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select etapa_id into v_etapa_antes from public.negociacoes where id = v_neg;
  -- v_etapa_re, de propósito: CLOSER já tem pode_mover em ag/prop/neg (teste
  -- 2), mas NENHUMA linha ainda em "Reunião realizada" — alvo limpo pra
  -- provar "sem permissão NESTA etapa", não só "sem permissão alguma".
  begin
    update public.negociacoes set etapa_id = v_etapa_re where id = v_neg;
    assert false, '3 falhou: CLOSER sem pode_mover na etapa de destino não deveria conseguir mudar etapa, mesmo sendo dono e vendo a origem';
  exception when others then
    raise notice 'ok  3  CLOSER dono, vendo a etapa de origem (pode_ver) mas sem pode_mover no destino, é bloqueado pelo trigger ao tentar UPDATE direto';
  end;
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_antes,
    '3 falhou: a tentativa bloqueada não deveria ter mudado a etapa';

  -- =========================================================================
  -- 4/10: SDR com pode_mover move dentro do limite do handoff (4), mas o
  -- teto continua bloqueando ALÉM dele mesmo com pode_mover liberado "por
  -- engano" nas duas pontas (10). SDR precisa ser dono aqui (mesma nota do
  -- teste 2/3) pra exercitar o UPDATE cru de verdade.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 4', 'Empresa 4', v_sdr)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  -- Sai de "Lead Novo" (onde o SDR ainda não tem pode_ver) antes de
  -- configurar qualquer permissão — mesma nota do teste 3.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values
    (v_sdr, v_funil_a, null, null, null),
    (v_sdr, v_funil_a, v_etapa_ag, true, true),
    (v_sdr, v_funil_a, v_etapa_re, true, true),
    (v_sdr, v_funil_a, v_etapa_prop, true, true)  -- liberado "por engano" além do handoff
  on conflict (usuario_id, funil_id, etapa_id) do update set pode_ver = true, pode_mover = true;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_re where id = v_neg;
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_re,
    '4 falhou: SDR dono, com pode_mover, deveria conseguir entrar em "Reunião realizada" (dentro do limite do handoff)';
  raise notice 'ok  4  SDR dono, com permissão, move dentro do limite do handoff via UPDATE direto';

  begin
    update public.negociacoes set etapa_id = v_etapa_prop where id = v_neg;
    assert false,
      '10 falhou: SDR não deveria passar de "Reunião realizada" mesmo com pode_mover=true configurado nas duas pontas';
  exception when others then
    raise notice 'ok  10  handoff SDR continua bloqueando além de "Reunião realizada", mesmo com pode_mover liberado por engano — trigger de handoff e trigger de permissão coexistem, cada um com seu próprio motivo';
  end;
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_re,
    '10 falhou: a tentativa bloqueada pelo handoff não deveria ter mudado a etapa';

  -- =========================================================================
  -- 5: SDR sem pode_mover não pode mudar. SDR precisa ser dono aqui também
  -- (mesma nota acima) — a etapa de destino (v_etapa_neg) nunca recebeu
  -- permissão pra este SDR (só ag/re/prop, no teste 4).
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 5', 'Empresa 5', v_sdr)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  -- Sai de "Lead Novo" pra onde o SDR já tem pode_ver (ag, do teste 4) —
  -- mesma nota do teste 3/4.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  begin
    update public.negociacoes set etapa_id = v_etapa_neg where id = v_neg;
    assert false, '5 falhou: SDR sem nenhuma permissão não deveria conseguir mudar a etapa desta negociação (de outro dono)';
  exception when others then
    raise notice 'ok  5  SDR sem permissão configurada é bloqueado ao tentar mudar etapa';
  end;

  -- =========================================================================
  -- 6/8: SDR é owner_id da negociação, sem nenhuma permissão — owner_id não
  -- basta; nem UPDATE direto (6) nem ir por OUTRO caminho não-RPC-seguro, o
  -- próprio fechar_negociacao (8), conseguem burlar.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 6', 'Empresa 6', v_sdr)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  -- Sai de "Lead Novo" pra onde o SDR já tem pode_ver (ag, do teste 4) —
  -- mesma nota do teste 3/4/5: sem isso, nem o SDR (dono) conseguiria
  -- SELECIONAR a própria linha, e o UPDATE abaixo "passaria" com 0 linhas
  -- afetadas em vez de ser bloqueado pelo motivo certo.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select etapa_id into v_etapa_antes from public.negociacoes where id = v_neg;
  -- SDR é owner_id — RLS (negociacoes_update: owner_id OR gerente) deixaria passar;
  -- só o trigger novo pode bloquear aqui.
  begin
    update public.negociacoes set etapa_id = v_etapa_neg where id = v_neg;
    assert false, '6 falhou: SDR é owner_id desta negociação, mas sem permissão configurada não deveria conseguir mudar a etapa';
  exception when others then
    raise notice 'ok  6  owner_id (SDR) NÃO é bypass — UPDATE direto bloqueado pelo trigger mesmo sendo o próprio dono';
  end;

  begin
    perform public.fechar_negociacao(v_neg, 1, 5000.00, current_date, true, true, 'pago', 'concluido');
    assert false, '8 falhou: fechar_negociacao (RPC não security definer, um dos 3 caminhos que motivaram esta migration) não deveria conseguir burlar o trigger';
  exception when others then
    raise notice 'ok  8  chamada direta ao banco não burla a proteção — nem UPDATE cru (teste 6), nem outro RPC não-security-definer que toque etapa_id (fechar_negociacao, aqui), passam sem pode_mover_etapa';
  end;
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_antes,
    '8 falhou: a tentativa via fechar_negociacao não deveria ter alterado a etapa';

  -- =========================================================================
  -- 7: CLOSER é owner_id da negociação, sem nenhuma permissão.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 7', 'Empresa 7', v_closer)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  -- v_closer TEM permissão em v_etapa_ag/prop/neg (do teste 2) mas NENHUMA em v_etapa_re.
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  -- Sai de "Lead Novo" (onde o closer ainda não tem pode_ver) pra v_etapa_ag
  -- — mesma nota dos testes anteriores.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_ag, posicao = 1 where id = v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  begin
    update public.negociacoes set etapa_id = v_etapa_re where id = v_neg;
    assert false, '7 falhou: CLOSER é owner_id desta negociação, mas sem pode_mover em "Reunião realizada" não deveria conseguir mudar pra lá';
  exception when others then
    raise notice 'ok  7  owner_id (CLOSER) também NÃO é bypass — bloqueado na etapa específica onde não tem permissão, mesmo tendo permissão em OUTRAS etapas';
  end;

  -- =========================================================================
  -- 11: pode_ver sem pode_mover + owner_id juntos ainda não bastam.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover)
  values (v_closer, v_funil_a, v_etapa_re, true, false)
  on conflict (usuario_id, funil_id, etapa_id) do update set pode_ver = true, pode_mover = false;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  begin
    update public.negociacoes set etapa_id = v_etapa_re where id = v_neg;
    assert false, '11 falhou: CLOSER é owner_id E tem pode_ver em "Reunião realizada", mas sem pode_mover ainda não deveria conseguir mudar';
  exception when others then
    raise notice 'ok  11  owner_id + pode_ver=true (sem pode_mover) continuam insuficientes — ver nunca implica mover, dono nunca basta';
  end;

  -- =========================================================================
  -- 13/14: outro campo nunca é bloqueado; etapa_id repetindo o mesmo valor
  -- (junto de outro campo) também não dispara bloqueio nenhum — mesmo
  -- numa etapa onde o ator tem pode_ver mas NÃO tem pode_mover (reaproveita
  -- v_etapa_re/CLOSER do teste 11: pode_ver=true, pode_mover=false) — prova
  -- que é mesmo o guard `new.etapa_id is not distinct from old.etapa_id`
  -- fazendo o trabalho, não uma permissão de mover que por acaso existisse.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Protege 13', 'Empresa 13', v_closer)
    returning id into v_cliente_tmp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_tmp, v_funil_a, 1000.00, 'morno') into v_neg;

  -- Sai de "Lead Novo" direto pra v_etapa_re — onde o CLOSER tem pode_ver
  -- mas NÃO pode_mover (configurado no teste 11) — sem isso, o CLOSER (dono)
  -- nem conseguiria SELECIONAR a própria linha.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_re, posicao = 1 where id = v_neg;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select etapa_id into v_etapa_antes from public.negociacoes where id = v_neg;

  update public.negociacoes set valor_estimado = 9999.00 where id = v_neg;
  assert (select valor_estimado from public.negociacoes where id = v_neg) = 9999.00,
    '13 falhou: alterar valor_estimado (não etapa_id) não deveria ser bloqueado, mesmo numa etapa onde o CLOSER só tem pode_ver (sem pode_mover)';
  raise notice 'ok  13  UPDATE de outro campo (valor_estimado), sem tocar etapa_id, nunca é bloqueado pelo trigger novo — mesmo sem pode_mover na etapa atual';

  update public.negociacoes set etapa_id = v_etapa_antes, valor_estimado = 1234.00 where id = v_neg;
  assert (select valor_estimado from public.negociacoes where id = v_neg) = 1234.00,
    '14 falhou: UPDATE que repete o MESMO etapa_id (junto de outro campo) não deveria ser bloqueado, mesmo sem pode_mover nessa etapa';
  assert (select etapa_id from public.negociacoes where id = v_neg) = v_etapa_antes,
    '14 falhou: a etapa não deveria ter mudado (valor repetido)';
  raise notice 'ok  14  UPDATE que repete o mesmo etapa_id (new = old), mesmo listado no SET junto de outro campo e sem pode_mover nessa etapa, não dispara checagem de permissão nenhuma — é o guard de igualdade, não uma permissão que por acaso existisse';

  -- =========================================================================
  -- 15: nenhuma policy de escrita pré-existente foi removida/alterada.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select count(*) into v_valor_antes
    from pg_policies
   where schemaname = 'public' and tablename = 'negociacoes' and cmd in ('INSERT', 'UPDATE', 'DELETE');
  assert v_valor_antes = 3,
    format('15 falhou: esperava 3 policies de escrita em negociacoes (insert/update/delete), encontrou %s', v_valor_antes);

  select count(*) into v_valor_antes
    from pg_policies
   where schemaname = 'public' and tablename = 'permissoes_colaborador' and cmd in ('INSERT', 'UPDATE', 'DELETE');
  assert v_valor_antes = 3,
    format('15 falhou: esperava 3 policies de escrita em permissoes_colaborador (insert/update/delete), encontrou %s', v_valor_antes);

  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'negociacoes' and policyname = 'negociacoes_update'
  ), '15 falhou: a policy negociacoes_update deveria continuar existindo — esta migration protege a coluna etapa_id pelo trigger, nunca removendo a policy';
  raise notice 'ok  15  nenhuma policy de escrita pré-existente foi removida ou substituída — só o trigger novo foi adicionado';

  raise notice 'TODOS OS TESTES DE PROTECAO DE MOVIMENTACAO POR PERMISSAO PASSARAM (1-15)';
end $$;

select 'OK — TODOS OS TESTES DE PROTECAO DE MOVIMENTACAO POR PERMISSAO PASSARAM' as resultado;

rollback;
