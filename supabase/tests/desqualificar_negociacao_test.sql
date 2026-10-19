-- ===========================================================================
-- Teste de fumaça de
-- `20261019100000_desqualificar_negociacao_por_permissao.sql`.
--
-- AUTO-INSTALAÇÃO TRANSACIONAL — mesmo padrão dos testes anteriores
-- (`criar_negociacao_protege_por_permissao_test.sql`, `funil_metricas_test.sql`):
-- instala a função nova (CREATE OR REPLACE idêntico à migration, mesma
-- assinatura), cria fixtures como o papel atual (bypassa RLS), impersona cada
-- usuário via `set_config('request.jwt.claims', ...)` depois de
-- `set local role authenticated`, roda os asserts, dá ROLLBACK — nada fica
-- gravado, nem em sucesso nem em falha.
--
-- O QUE ELE PROVA:
--   1  SDR não-owner, pode_ver + pode_mover → consegue desqualificar.
--   2  SDR não-owner, pode_ver + SEM pode_mover → consegue (pode_mover NÃO
--      é requisito — o cerne do pedido).
--   3  CLOSER não-owner, pode_ver + pode_mover → consegue.
--   4  CLOSER não-owner, pode_ver + SEM pode_mover → consegue.
--   5  GERENTE → consegue, sem nenhuma linha de permissão.
--   6  SDR sem pode_ver → bloqueado (42501), mesmo existindo a negociação.
--   7  CLOSER sem pode_ver → bloqueado (42501).
--   8  owner_id sem NENHUMA permissão comercial → bloqueado (42501) —
--      owner_id não é bypass.
--   9-16  Lead Novo, MQL, Reunião agendada, Reunião realizada, Negociação,
--      Proposta enviada, GANHA e PERDIDA — todas funcionam igual (nenhuma
--      etapa, inclusive as encerradas, bloqueia a ação — opção A aprovada).
--   17 Só `arquivada_em`/`motivo_arquivamento` mudam — `etapa_id`, `funil_id`,
--      `owner_id`, `origem` e o `fechamento` vinculado (valor_vendido)
--      permanecem exatamente iguais, inclusive numa negociação GANHA.
--   18 (mesmo caso acima) — cobre explicitamente "não altera owner_id",
--      "não altera funil_id", "não altera origem", "não altera fechamento".
--   19 Motivo vazio/só espaço → bloqueado (23514), negociação permanece
--      não-arquivada.
--   20 Observações (`atividades`) continuam exigindo pode_MOVER (não só
--      pode_ver) — prova que esta migration não alterou `atividades_insert`.
--   21 Nenhuma policy global de UPDATE foi ampliada: o mesmo SDR que acabou
--      de desqualificar pela RPC continua bloqueado num `UPDATE` direto de
--      `negociacoes` fora da RPC (negociacoes_update continua owner_id OR
--      gerente, intacta).
-- ===========================================================================

begin;

create or replace function public.desqualificar_negociacao(
  p_negociacao_id uuid,
  p_motivo        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_etapa_id uuid;
  v_motivo   text;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_id
    from public.negociacoes n
   where n.id = p_negociacao_id
     and n.arquivada_em is null
     for update;

  if v_funil_id is null then
    raise exception 'Lead não encontrado ou já está arquivado.' using errcode = 'P0002';
  end if;

  if not public.is_gerente() and not public.pode_ver_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para esta operação.' using errcode = '42501';
  end if;

  v_motivo := btrim(p_motivo);
  if v_motivo is null or v_motivo = '' then
    raise exception 'Informe o motivo da desqualificação.' using errcode = '23514';
  end if;

  update public.negociacoes
     set arquivada_em = now(),
         motivo_arquivamento = v_motivo
   where id = p_negociacao_id;
end;
$$;

do $$
declare
  v_gerente          uuid := 'f0000000-0000-0000-0000-000000000001';
  v_sdr_full         uuid := 'f0000000-0000-0000-0000-000000000002'; -- pode_ver+pode_mover em todas as etapas
  v_closer_full      uuid := 'f0000000-0000-0000-0000-000000000003'; -- idem
  v_sdr_partial      uuid := 'f0000000-0000-0000-0000-000000000004'; -- pode_ver=true, pode_mover=FALSE
  v_closer_partial   uuid := 'f0000000-0000-0000-0000-000000000005'; -- idem
  v_sdr_sem_ver      uuid := 'f0000000-0000-0000-0000-000000000006'; -- zero permissão
  v_closer_sem_ver   uuid := 'f0000000-0000-0000-0000-000000000007'; -- zero permissão
  v_dono_sem_permissao uuid := 'f0000000-0000-0000-0000-000000000008'; -- owner_id de tudo, zero permissão

  v_funil uuid;
  v_etapa_lead_novo        uuid;
  v_etapa_mql               uuid;
  v_etapa_reuniao_agendada  uuid;
  v_etapa_reuniao_realizada uuid;
  v_etapa_negociacao        uuid;
  v_etapa_proposta          uuid;
  v_etapa_ganha             uuid;
  v_etapa_perdida           uuid;

  v_cliente uuid;

  v_neg_lead_novo   uuid; -- sdr_full  (testes 1, 9)
  v_neg_mql         uuid; -- sdr_full  (teste 10)
  v_neg_reuniao_ag  uuid; -- sdr_full  (teste 11)
  v_neg_reuniao_re  uuid; -- sdr_full  (teste 12)
  v_neg_negociacao  uuid; -- sdr_full  (teste 13)
  v_neg_proposta    uuid; -- sdr_full  (teste 14)
  v_neg_ganha       uuid; -- sdr_full  (testes 15, 17, 18)
  v_neg_perdida     uuid; -- sdr_full  (teste 16)
  v_neg_closer      uuid; -- closer_full (teste 3)
  v_neg_sdr_partial uuid; -- sdr_partial (testes 2, 20, 21)
  v_neg_closer_partial uuid; -- closer_partial (teste 4)
  v_neg_gerente     uuid; -- gerente   (teste 5)
  v_neg_probe       uuid; -- bloqueados (testes 6, 7, 8)
  v_neg_motivo      uuid; -- motivo vazio (teste 19)

  v_etapa_id_antes  uuid;
  v_funil_id_antes  uuid;
  v_owner_id_antes  uuid;
  v_origem_antes    public.origem_negociacao;
  v_valor_vendido_antes numeric;

  v_erro text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste Desq"}'::jsonb),
    (v_sdr_full, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.full.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Full Teste Desq"}'::jsonb),
    (v_closer_full, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.full.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer Full Teste Desq"}'::jsonb),
    (v_sdr_partial, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.partial.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Partial Teste Desq"}'::jsonb),
    (v_closer_partial, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.partial.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer Partial Teste Desq"}'::jsonb),
    (v_sdr_sem_ver, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.semver.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Sem Ver Teste Desq"}'::jsonb),
    (v_closer_sem_ver, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.semver.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer Sem Ver Teste Desq"}'::jsonb),
    (v_dono_sem_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dono.sempermissao.teste.desq@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"Dono Sem Permissao Teste Desq"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Desqualificar', false) returning id into v_funil;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Lead Novo', 'turquesa', 0, 'aberta') returning id into v_etapa_lead_novo;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'MQL', 'azul', 1, 'aberta') returning id into v_etapa_mql;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Reunião agendada', 'amarelo', 2, 'aberta') returning id into v_etapa_reuniao_agendada;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Reunião realizada', 'laranja', 3, 'aberta') returning id into v_etapa_reuniao_realizada;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Negociação', 'violeta', 4, 'aberta') returning id into v_etapa_negociacao;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Proposta enviada', 'rosa', 5, 'aberta') returning id into v_etapa_proposta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Ganha', 'verde', 6, 'ganha') returning id into v_etapa_ganha;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil, 'Perdida', 'vermelho', 7, 'perdida') returning id into v_etapa_perdida;

  -- Acesso ao funil (etapa_id null) + pode_ver/pode_mover em TODAS as etapas,
  -- para os dois usuários "full".
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  select u, v_funil, null, null, null, v_gerente
    from unnest(array[v_sdr_full, v_closer_full]) as u;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por)
  select u, v_funil, e, true, true, v_gerente
    from unnest(array[v_sdr_full, v_closer_full]) as u,
         unnest(array[
           v_etapa_lead_novo, v_etapa_mql, v_etapa_reuniao_agendada, v_etapa_reuniao_realizada,
           v_etapa_negociacao, v_etapa_proposta, v_etapa_ganha, v_etapa_perdida
         ]) as e;

  -- "Partial": pode_ver=true, pode_mover=FALSE — só na etapa que cada um usa.
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_partial, v_funil, null, null, null, v_gerente),
    (v_sdr_partial, v_funil, v_etapa_mql, true, false, v_gerente),
    (v_closer_partial, v_funil, null, null, null, v_gerente),
    (v_closer_partial, v_funil, v_etapa_proposta, true, false, v_gerente);

  -- v_sdr_sem_ver, v_closer_sem_ver, v_dono_sem_permissao: NENHUMA linha —
  -- de propósito (zero permissão, inclusive sem acesso ao funil).

  -- Um único cliente para todas as negociações, cujo dono (derivado pelo
  -- trigger negociacoes_owner_do_cliente) é v_dono_sem_permissao — nenhum dos
  -- testadores é owner_id de nada, provando que owner_id nunca entra na
  -- decisão.
  insert into public.clientes (tipo_cliente, nome, owner_id)
    values ('pessoa_fisica', 'Cliente Teste Desqualificar', v_dono_sem_permissao)
    returning id into v_cliente;

  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_lead_novo) returning id into v_neg_lead_novo;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_mql) returning id into v_neg_mql;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_reuniao_agendada) returning id into v_neg_reuniao_ag;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_reuniao_realizada) returning id into v_neg_reuniao_re;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_negociacao) returning id into v_neg_negociacao;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_proposta) returning id into v_neg_proposta;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_negociacao) returning id into v_neg_closer;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_mql) returning id into v_neg_sdr_partial;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_proposta) returning id into v_neg_closer_partial;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_lead_novo) returning id into v_neg_gerente;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_mql) returning id into v_neg_probe;
  insert into public.negociacoes (cliente_id, etapa_id) values (v_cliente, v_etapa_mql) returning id into v_neg_motivo;

  -- GANHA exige fechamento (constraint trigger, verificada no COMMIT — não
  -- dispara com o ROLLBACK final, mas o fechamento é criado de verdade pra
  -- validar o "fechamento não muda" do teste 17/18 com dado real).
  insert into public.negociacoes (cliente_id, etapa_id, valor_estimado) values (v_cliente, v_etapa_ganha, 5000) returning id into v_neg_ganha;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_ganha, 4800, current_date, true, true, 'pago', 'concluido', v_gerente, 'tcv'
  );

  insert into public.negociacoes (cliente_id, etapa_id, motivo_perda) values (v_cliente, v_etapa_perdida, 'teste: motivo de perda') returning id into v_neg_perdida;

  execute 'set local role authenticated';

  -- =====================================================================
  -- 1/9. SDR não-owner, pode_ver+pode_mover, etapa Lead Novo.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_full, 'role', 'authenticated')::text, true);
  perform public.desqualificar_negociacao(v_neg_lead_novo, 'teste: fora do perfil');
  assert (select arquivada_em is not null and motivo_arquivamento = 'teste: fora do perfil'
          from public.negociacoes where id = v_neg_lead_novo),
    'SDR com pode_ver+pode_mover deveria desqualificar em Lead Novo';
  raise notice 'ok 1/9  SDR pode_ver+pode_mover desqualifica em Lead Novo';

  -- =====================================================================
  -- 10. MQL.
  -- =====================================================================
  perform public.desqualificar_negociacao(v_neg_mql, 'teste: sem orçamento');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_mql),
    'deveria desqualificar em MQL';
  raise notice 'ok 10  desqualifica em MQL';

  -- =====================================================================
  -- 11. Reunião agendada.
  -- =====================================================================
  perform public.desqualificar_negociacao(v_neg_reuniao_ag, 'teste: não compareceu');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_reuniao_ag),
    'deveria desqualificar em Reunião agendada';
  raise notice 'ok 11  desqualifica em Reunião agendada';

  -- =====================================================================
  -- 12. Reunião realizada.
  -- =====================================================================
  perform public.desqualificar_negociacao(v_neg_reuniao_re, 'teste: número errado');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_reuniao_re),
    'deveria desqualificar em Reunião realizada';
  raise notice 'ok 12  desqualifica em Reunião realizada';

  -- =====================================================================
  -- 13. Negociação.
  -- =====================================================================
  perform public.desqualificar_negociacao(v_neg_negociacao, 'teste: desistiu');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_negociacao),
    'deveria desqualificar em Negociação';
  raise notice 'ok 13  desqualifica em Negociação';

  -- =====================================================================
  -- 14. Proposta enviada.
  -- =====================================================================
  perform public.desqualificar_negociacao(v_neg_proposta, 'teste: foi com concorrente');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_proposta),
    'deveria desqualificar em Proposta enviada';
  raise notice 'ok 14  desqualifica em Proposta enviada';

  -- =====================================================================
  -- 15/17/18. GANHA — funciona (opção A), e só as duas colunas mudam.
  -- =====================================================================
  select etapa_id, funil_id, owner_id, origem into v_etapa_id_antes, v_funil_id_antes, v_owner_id_antes, v_origem_antes
    from public.negociacoes where id = v_neg_ganha;
  select valor_vendido into v_valor_vendido_antes from public.fechamentos where negociacao_id = v_neg_ganha;

  perform public.desqualificar_negociacao(v_neg_ganha, 'teste: cancelado após a venda');

  assert (select arquivada_em is not null and motivo_arquivamento = 'teste: cancelado após a venda'
          from public.negociacoes where id = v_neg_ganha),
    'deveria desqualificar negociação GANHA (opção A aprovada)';
  assert (select etapa_id = v_etapa_id_antes and funil_id = v_funil_id_antes
                 and owner_id = v_owner_id_antes and origem = v_origem_antes
          from public.negociacoes where id = v_neg_ganha),
    'etapa_id/funil_id/owner_id/origem não deveriam mudar';
  assert (select valor_vendido = v_valor_vendido_antes from public.fechamentos where negociacao_id = v_neg_ganha),
    'o fechamento vinculado não deveria mudar';
  raise notice 'ok 15/17/18  desqualifica GANHA; etapa/funil/owner/origem/fechamento intactos';

  -- =====================================================================
  -- 16. PERDIDA — funciona (opção A).
  -- =====================================================================
  perform public.desqualificar_negociacao(v_neg_perdida, 'teste: reaberto por engano');
  assert (select arquivada_em is not null and motivo_perda = 'teste: motivo de perda'
          from public.negociacoes where id = v_neg_perdida),
    'deveria desqualificar PERDIDA, preservando motivo_perda';
  raise notice 'ok 16  desqualifica PERDIDA, motivo_perda preservado';

  -- =====================================================================
  -- 3. CLOSER não-owner, pode_ver+pode_mover.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_full, 'role', 'authenticated')::text, true);
  perform public.desqualificar_negociacao(v_neg_closer, 'teste: closer com permissão plena');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_closer),
    'CLOSER com pode_ver+pode_mover deveria desqualificar';
  raise notice 'ok 3  CLOSER pode_ver+pode_mover desqualifica';

  -- =====================================================================
  -- 2/20/21. SDR não-owner, pode_ver=true, pode_mover=FALSE.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_partial, 'role', 'authenticated')::text, true);

  -- 20: ainda bloqueado de registrar observação (atividades exige pode_MOVER,
  -- não pode_ver) — prova que esta migration não relaxou atividades_insert.
  begin
    insert into public.atividades (cliente_id, negociacao_id, descricao)
      values (v_cliente, v_neg_sdr_partial, 'tentativa de observação sem pode_mover');
    assert false, 'atividades_insert deveria continuar exigindo pode_mover_etapa';
  exception when insufficient_privilege then
    raise notice 'ok 20  atividades_insert continua exigindo pode_mover (não foi relaxada)';
  end;

  -- 21: UPDATE direto (fora da RPC) continua bloqueado — negociacoes_update
  -- (owner_id OR gerente) não foi ampliada por esta migration. RLS em UPDATE
  -- não lança erro quando a cláusula USING exclui a linha — ela só afeta
  -- zero linhas, silenciosamente. Por isso o teste confere o ESTADO (valor
  -- não mudou), não uma excepção.
  update public.negociacoes set valor_estimado = 999 where id = v_neg_sdr_partial;
  assert (select valor_estimado is distinct from 999 from public.negociacoes where id = v_neg_sdr_partial),
    'negociacoes_update não deveria aceitar UPDATE direto de quem só tem pode_ver (RLS deveria excluir a linha)';
  raise notice 'ok 21  UPDATE direto em negociacoes continua exigindo owner_id/gerente — policy não foi ampliada';

  -- 2: mas a RPC de desqualificar funciona, mesmo com pode_mover=false.
  perform public.desqualificar_negociacao(v_neg_sdr_partial, 'teste: sem pode_mover, mas com pode_ver');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_sdr_partial),
    'SDR com pode_ver=true e pode_mover=false deveria conseguir desqualificar';
  raise notice 'ok 2  SDR pode_ver=true/pode_mover=false desqualifica (pode_mover não é requisito)';

  -- =====================================================================
  -- 4. CLOSER não-owner, pode_ver=true, pode_mover=FALSE.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_partial, 'role', 'authenticated')::text, true);
  perform public.desqualificar_negociacao(v_neg_closer_partial, 'teste: closer sem pode_mover');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_closer_partial),
    'CLOSER com pode_ver=true e pode_mover=false deveria conseguir desqualificar';
  raise notice 'ok 4  CLOSER pode_ver=true/pode_mover=false desqualifica';

  -- =====================================================================
  -- 5. GERENTE — sem nenhuma linha de permissão.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  perform public.desqualificar_negociacao(v_neg_gerente, 'teste: gerente desqualifica direto');
  assert (select arquivada_em is not null from public.negociacoes where id = v_neg_gerente),
    'GERENTE deveria desqualificar sem nenhuma permissão configurada';
  raise notice 'ok 5  GERENTE desqualifica sem permissão configurada';

  -- =====================================================================
  -- 6. SDR sem pode_ver — bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_sem_ver, 'role', 'authenticated')::text, true);
  begin
    perform public.desqualificar_negociacao(v_neg_probe, 'teste: sdr sem acesso');
    assert false, 'SDR sem pode_ver não deveria conseguir desqualificar';
  exception when insufficient_privilege then
    raise notice 'ok 6  SDR sem pode_ver é bloqueado (42501)';
  end;

  -- =====================================================================
  -- 7. CLOSER sem pode_ver — bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_sem_ver, 'role', 'authenticated')::text, true);
  begin
    perform public.desqualificar_negociacao(v_neg_probe, 'teste: closer sem acesso');
    assert false, 'CLOSER sem pode_ver não deveria conseguir desqualificar';
  exception when insufficient_privilege then
    raise notice 'ok 7  CLOSER sem pode_ver é bloqueado (42501)';
  end;

  -- =====================================================================
  -- 8. owner_id sem NENHUMA permissão comercial — bloqueado.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono_sem_permissao, 'role', 'authenticated')::text, true);
  begin
    perform public.desqualificar_negociacao(v_neg_probe, 'teste: dono sem permissao');
    assert false, 'owner_id sozinho não deveria bastar';
  exception when insufficient_privilege then
    raise notice 'ok 8  owner_id sem permissão comercial é bloqueado — owner_id não é bypass';
  end;

  -- v_dono_sem_permissao não tem pode_ver_etapa — nem CONSEGUE ver v_neg_probe
  -- (negociacoes_select também não aceita owner_id como bypass). Troca para o
  -- GERENTE só para verificar o estado real da linha.
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  assert (select arquivada_em is null from public.negociacoes where id = v_neg_probe),
    'v_neg_probe não deveria ter sido alterada por nenhuma das 3 tentativas bloqueadas';

  -- =====================================================================
  -- 19. Motivo obrigatório — vazio/só espaço é bloqueado (23514).
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_full, 'role', 'authenticated')::text, true);
  begin
    perform public.desqualificar_negociacao(v_neg_motivo, '   ');
    assert false, 'motivo vazio não deveria ser aceito';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    assert v_erro like '%Informe o motivo%', format('mensagem inesperada: %s', v_erro);
    raise notice 'ok 19  motivo vazio é bloqueado (23514), mensagem correta';
  end;
  assert (select arquivada_em is null from public.negociacoes where id = v_neg_motivo),
    'v_neg_motivo não deveria ter sido arquivada pela tentativa com motivo vazio';

  raise notice 'desqualificar_negociacao_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
