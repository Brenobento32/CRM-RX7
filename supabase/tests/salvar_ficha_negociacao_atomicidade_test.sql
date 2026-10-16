-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) da migration 20261016180000
-- (`atualizar_cliente_do_card` + `salvar_ficha_negociacao`) — ainda não
-- aplicada no banco real, auto-instalada aqui como cópia exata, rollback
-- no fim.
--
-- Foco desta rodada: ATOMICIDADE do botão único "Salvar alterações" da
-- ficha — a RPC `salvar_ficha_negociacao` precisa ser uma operação só:
-- sucesso = cliente E negociação atualizados; qualquer erro = NENHUM dos
-- dois persiste (nunca "cliente salvo, negociação não", nem o contrário).
--
-- SET ROLE authenticated de verdade em toda chamada mutante — sessão de
-- teste é postgres (superusuário), que bypassa RLS; sem o ROLE trocado um
-- teste de permissão passaria mesmo quebrado.
--
-- MAPA (checklist de atomicidade pedido nesta rodada)
--   A  cliente + negociação alteram juntos → sucesso.
--   B  cliente seria válido, negociação falha de propósito (lifecycle) →
--      NENHUMA alteração permanece (nem no cliente).
--   C  negociação seria válida, cliente falha de propósito (CPF duplicado)
--      → NENHUMA alteração permanece (nem na negociação) — como a função
--      faz cliente PRIMEIRO, isso prova que um erro no cliente nunca deixa
--      a negociação ser tocada.
--   D  SDR NÃO-owner + pode_mover → operação completa funciona.
--   E  somente pode_ver → operação inteira bloqueada.
--   F  owner sem pode_mover → bloqueado.
--   G  gerente → funciona.
--   H  origem permanece imutável (incondicional, já coberto por
--      `negociacoes_protecoes_operacionais_test.sql`; repetido aqui de
--      forma mínima porque esta RPC é um caminho de escrita adicional).
--   I  etapa_id permanece protegido.
--   J  owner_id (cliente E negociação) permanece protegido.
--   K  funil_id permanece protegido.
--
-- MAPA (checklist de negociação encerrada pedido NESTA revisão)
--   L1  encerrada + só cliente alterado (campos operacionais iguais ao que
--       já está salvo) → sucesso.
--   L2  encerrada + algum campo operacional alterado (cliente sem mudança)
--       → erro explícito, NADA persiste (nem o cliente).
--   L3  encerrada + cliente E operacional alterados → erro, NADA persiste
--       (nem o cliente, nem o que L1 já tinha salvo nele continua intacto).
-- ===========================================================================

begin;

create or replace function public.atualizar_cliente_do_card(
  p_cliente_id     uuid,
  p_negociacao_id  uuid,
  p_tipo_cliente   public.tipo_cliente,
  p_nome           text,
  p_empresa        text,
  p_cpf            text,
  p_cnpj           text,
  p_telefone       text,
  p_whatsapp       text,
  p_email          text,
  p_responsavel    text,
  p_cargo          text,
  p_instagram      text,
  p_observacoes    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id        uuid;
  v_etapa_id        uuid;
  v_cliente_da_neg  uuid;
begin
  select n.funil_id, n.etapa_id, n.cliente_id into v_funil_id, v_etapa_id, v_cliente_da_neg
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if v_cliente_da_neg <> p_cliente_id then
    raise exception 'Esta negociação não pertence ao cliente informado.' using errcode = '23514';
  end if;

  if not public.is_gerente() and not public.pode_mover_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para editar este cliente.' using errcode = '42501';
  end if;

  update public.clientes
     set tipo_cliente = p_tipo_cliente,
         nome         = p_nome,
         empresa      = p_empresa,
         cpf          = p_cpf,
         cnpj         = p_cnpj,
         telefone     = p_telefone,
         whatsapp     = p_whatsapp,
         email        = p_email,
         responsavel  = p_responsavel,
         cargo        = p_cargo,
         instagram    = p_instagram,
         observacoes  = p_observacoes
   where id = p_cliente_id
     and deleted_at is null;

  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.atualizar_cliente_do_card(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.atualizar_cliente_do_card(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

create or replace function public.salvar_ficha_negociacao(
  p_cliente_id             uuid,
  p_negociacao_id          uuid,
  p_tipo_cliente           public.tipo_cliente,
  p_nome                   text,
  p_empresa                text,
  p_cpf                    text,
  p_cnpj                   text,
  p_telefone               text,
  p_whatsapp               text,
  p_email                  text,
  p_responsavel            text,
  p_cargo                  text,
  p_instagram              text,
  p_observacoes            text,
  p_nicho_id               uuid,
  p_temperatura            public.temperatura_negociacao,
  p_valor_estimado         numeric,
  p_data_primeira_reuniao  date,
  p_data_proposta          date,
  p_objecao_principal      text,
  p_valor_proposta         numeric,
  p_forma_pagamento        public.forma_pagamento
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_etapa_id              uuid;
  v_aberta                boolean;
  v_nicho_id_atual        uuid;
  v_temperatura_atual     public.temperatura_negociacao;
  v_valor_estimado_atual  numeric;
  v_data_primeira_reuniao_atual date;
  v_data_proposta_atual   date;
  v_objecao_principal_atual text;
  v_valor_proposta_atual  numeric;
  v_forma_pagamento_atual public.forma_pagamento;
begin
  -- `atualizar_cliente_do_card` PRIMEIRO (SECURITY DEFINER, bypassa RLS, já
  -- autoriza) — a leitura abaixo é SECURITY INVOKER e só é segura DEPOIS da
  -- autorização confirmada (ver comentário da migration real).
  perform public.atualizar_cliente_do_card(
    p_cliente_id, p_negociacao_id, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj,
    p_telefone, p_whatsapp, p_email, p_responsavel, p_cargo, p_instagram, p_observacoes
  );

  select n.etapa_id, n.nicho_id, n.temperatura, n.valor_estimado, n.data_primeira_reuniao,
         n.data_proposta, n.objecao_principal, n.valor_proposta, n.forma_pagamento
    into v_etapa_id, v_nicho_id_atual, v_temperatura_atual, v_valor_estimado_atual,
         v_data_primeira_reuniao_atual, v_data_proposta_atual, v_objecao_principal_atual,
         v_valor_proposta_atual, v_forma_pagamento_atual
    from public.negociacoes n
   where n.id = p_negociacao_id;

  v_aberta := public.etapa_tipo(v_etapa_id) = 'aberta';

  if not v_aberta
     and (
       p_nicho_id, p_temperatura, p_valor_estimado, p_data_primeira_reuniao,
       p_data_proposta, p_objecao_principal, p_valor_proposta, p_forma_pagamento
     ) is distinct from (
       v_nicho_id_atual, v_temperatura_atual, v_valor_estimado_atual, v_data_primeira_reuniao_atual,
       v_data_proposta_atual, v_objecao_principal_atual, v_valor_proposta_atual, v_forma_pagamento_atual
     )
  then
    raise exception 'Os dados comerciais desta negociação estão encerrados e não podem ser alterados.'
      using errcode = '23514';
  end if;

  if v_aberta then
    perform public.atualizar_dados_operacionais_negociacao(
      p_negociacao_id, p_nicho_id, p_temperatura, p_valor_estimado,
      p_data_primeira_reuniao, p_data_proposta, p_objecao_principal,
      p_valor_proposta, p_forma_pagamento
    );
  end if;
end;
$$;

revoke all on function public.salvar_ficha_negociacao(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text,
  uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) from public, anon;
grant execute on function public.salvar_ficha_negociacao(
  uuid, uuid, public.tipo_cliente, text, text, text, text, text, text, text, text, text, text, text,
  uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) to authenticated;

create temp table _log (id serial primary key, passo text);

do $$
declare
  v_gerente          uuid := 'c2000000-0000-0000-0000-000000000001';
  v_sdr_nao_owner    uuid := 'c2000000-0000-0000-0000-000000000002'; -- pode_mover, NÃO é owner
  v_sdr_so_ve        uuid := 'c2000000-0000-0000-0000-000000000003'; -- só pode_ver
  v_dono_generico    uuid := 'c2000000-0000-0000-0000-000000000004';

  v_funil_id     uuid;
  v_etapa_aberta uuid;
  v_nicho_id     uuid;

  v_cliente_1 uuid; v_neg_1 uuid; -- cenário A (sucesso conjunto)
  v_cliente_2 uuid; v_neg_2 uuid; -- cenário B (negociação falha)
  v_cliente_3 uuid; v_neg_3 uuid; -- cenário C (cliente falha — CPF duplicado)
  v_cliente_cpf_existente uuid;
  v_cliente_4 uuid; v_neg_4 uuid; -- cenário D/F/E (variações de permissão)
  v_cliente_g uuid; v_neg_g uuid; -- cenário G (gerente)
  v_cliente_l uuid; v_neg_l uuid; -- L1/L3: encerrada, cliente editável
  v_cliente_m uuid; v_neg_m uuid; -- L2: encerrada, tentativa operacional isolada
  v_etapa_ganha uuid;

  v_erro text;
  v_nome_antes text;
  v_temp_antes public.temperatura_negociacao;
begin
  -- -----------------------------------------------------------------------
  -- Fixtures.
  -- -----------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.atom@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Atom"}'::jsonb),
    (v_sdr_nao_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.nao.owner.atom@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Nao Owner Atom"}'::jsonb),
    (v_sdr_so_ve, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.so.ve.atom@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR So Ve Atom"}'::jsonb),
    (v_dono_generico, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dono.generico.atom@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Dono Generico Atom"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Atomicidade Ficha', false) returning id into v_funil_id;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Aberta Atom', 'azul', 1000, 'aberta') returning id into v_etapa_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Ganha Atom', 'verde', 100000, 'ganha') returning id into v_etapa_ganha;
  insert into public.nichos (nome, slug, cor) values ('Nicho Atom', 'nicho-atom', 'azul') returning id into v_nicho_id;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_nao_owner, v_funil_id, null,           null, null,  v_gerente),
    (v_sdr_nao_owner, v_funil_id, v_etapa_aberta, true, true,  v_gerente),
    (v_sdr_nao_owner, v_funil_id, v_etapa_ganha,  true, true,  v_gerente),
    (v_sdr_so_ve,     v_funil_id, null,           null, null,  v_gerente),
    (v_sdr_so_ve,     v_funil_id, v_etapa_aberta, true, false, v_gerente);
  -- v_dono_generico: deliberadamente ZERO linhas (cenário F).

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom A', '11900000051', v_dono_generico) returning id into v_cliente_1;
  insert into public.negociacoes (cliente_id, etapa_id, origem, nicho_id, temperatura) values
    (v_cliente_1, v_etapa_aberta, 'manual', null, 'frio') returning id into v_neg_1;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom B', '11900000052', v_dono_generico) returning id into v_cliente_2;
  insert into public.negociacoes (cliente_id, etapa_id, origem, temperatura) values
    (v_cliente_2, v_etapa_aberta, 'manual', 'frio') returning id into v_neg_2;

  insert into public.clientes (tipo_cliente, nome, telefone, cpf, owner_id) values
    ('pessoa_fisica', 'Cliente CPF Existente', '11900000053', '52998224725', v_dono_generico)
    returning id into v_cliente_cpf_existente;
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom C', '11900000054', v_dono_generico) returning id into v_cliente_3;
  insert into public.negociacoes (cliente_id, etapa_id, origem, temperatura) values
    (v_cliente_3, v_etapa_aberta, 'manual', 'frio') returning id into v_neg_3;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom D', '11900000055', v_dono_generico) returning id into v_cliente_4;
  insert into public.negociacoes (cliente_id, etapa_id, origem, temperatura) values
    (v_cliente_4, v_etapa_aberta, 'manual', 'frio') returning id into v_neg_4;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom G', '11900000056', v_dono_generico) returning id into v_cliente_g;
  insert into public.negociacoes (cliente_id, etapa_id, origem, temperatura) values
    (v_cliente_g, v_etapa_aberta, 'manual', 'frio') returning id into v_neg_g;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom L', '11900000057', v_dono_generico) returning id into v_cliente_l;
  insert into public.negociacoes (cliente_id, etapa_id, origem, temperatura) values
    (v_cliente_l, v_etapa_ganha, 'manual', 'frio') returning id into v_neg_l;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Atom M', '11900000058', v_dono_generico) returning id into v_cliente_m;
  insert into public.negociacoes (cliente_id, etapa_id, origem, temperatura) values
    (v_cliente_m, v_etapa_ganha, 'manual', 'frio') returning id into v_neg_m;

  -- -----------------------------------------------------------------------
  -- A. Cliente + negociação alteram JUNTOS — sucesso.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.salvar_ficha_negociacao(
    v_cliente_1, v_neg_1, 'pessoa_fisica', 'Samair 2', null, null, null,
    '5541998622127', null, 'bassolisamair@gmail.com', null, null, null, null,
    v_nicho_id, 'quente', 5000, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);

  assert (select nome from public.clientes where id = v_cliente_1) = 'Samair 2', 'cliente deveria ter sido salvo';
  assert (select temperatura from public.negociacoes where id = v_neg_1) = 'quente', 'negociação deveria ter sido salva';
  assert (select nicho_id from public.negociacoes where id = v_neg_1) = v_nicho_id, 'nicho_id deveria ter sido salvo';
  insert into _log (passo) values ('ok  A  cliente + negociação alteram juntos, numa única chamada — sucesso');

  -- -----------------------------------------------------------------------
  -- B. Negociação falha de propósito — valor_estimado negativo viola a
  -- constraint `check (valor_estimado is null or valor_estimado >= 0)` de
  -- `negociacoes` (20260923120400). Usuário TEM permissão (passa os dois
  -- checks de autorização); a função só quebra na escrita da negociação,
  -- que vem DEPOIS da escrita do cliente dentro da mesma chamada — prova
  -- que mesmo um cliente já gravado dentro da transação é desfeito se a
  -- negociação falhar depois.
  -- -----------------------------------------------------------------------
  v_nome_antes := (select nome from public.clientes where id = v_cliente_2);
  v_temp_antes := (select temperatura from public.negociacoes where id = v_neg_2);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.salvar_ficha_negociacao(
      v_cliente_2, v_neg_2, 'pessoa_fisica', 'Nome Que Nao Deveria Ficar', null, null, null,
      null, null, null, null, null, null, null,
      v_nicho_id, 'quente', -100, null, null, null, null, null
    );
    reset role;
    raise exception 'B: deveria ter falhado (valor_estimado negativo viola constraint da negociação)';
  exception
    when sqlstate '23514' then
      reset role; -- esperado: negociacoes_valor_estimado (constraint de check)
  end;
  perform set_config('request.jwt.claims', '', true);

  assert (select nome from public.clientes where id = v_cliente_2) = v_nome_antes,
    'B: cliente NÃO deveria ter sido alterado — a falha na negociação (depois, na mesma chamada) deveria ter desfeito tudo';
  assert (select temperatura from public.negociacoes where id = v_neg_2) = v_temp_antes,
    'B: negociação não deveria ter sido alterada';
  insert into _log (passo) values ('ok  B  negociação falha de propósito (constraint) -> NENHUMA alteração persiste (cliente incluso, mesmo gravado antes na mesma chamada)');

  -- -----------------------------------------------------------------------
  -- C. Cliente falha de propósito (CPF já usado por outro cliente) — como
  -- a função atualiza o CLIENTE primeiro, isso prova que, se o cliente
  -- falhar, a negociação nunca chega a ser tocada.
  -- -----------------------------------------------------------------------
  v_nome_antes := (select nome from public.clientes where id = v_cliente_3);
  v_temp_antes := (select temperatura from public.negociacoes where id = v_neg_3);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.salvar_ficha_negociacao(
      v_cliente_3, v_neg_3, 'pessoa_fisica', 'Nome Que Nao Deveria Ficar', null, '52998224725', null,
      null, null, null, null, null, null, null,
      null, 'quente', null, null, null, null, null, null
    );
    reset role;
    raise exception 'C: deveria ter falhado (CPF duplicado)';
  exception
    when sqlstate '23505' then
      reset role; -- esperado: clientes_cpf_unico
  end;
  perform set_config('request.jwt.claims', '', true);

  assert (select nome from public.clientes where id = v_cliente_3) = v_nome_antes,
    'C: cliente não deveria ter sido alterado (CPF duplicado recusa o UPDATE inteiro)';
  assert (select temperatura from public.negociacoes where id = v_neg_3) = v_temp_antes,
    'C: negociação NÃO deveria ter sido alterada — o cliente falhou antes de chegar nela';
  insert into _log (passo) values ('ok  C  cliente falha de propósito (CPF duplicado) -> negociação nunca é tocada, nada persiste');

  -- -----------------------------------------------------------------------
  -- D. SDR NÃO-owner + pode_mover -> operação completa funciona (repete A
  -- com outro usuário/negociação, já coberto por A — aqui só confirma que
  -- D é o MESMO caminho, não um especial).
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.salvar_ficha_negociacao(
    v_cliente_4, v_neg_4, 'pessoa_fisica', 'Cliente Atom D Editado', null, null, null,
    null, null, null, null, null, null, null,
    null, 'morno', null, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert (select nome from public.clientes where id = v_cliente_4) = 'Cliente Atom D Editado', 'D deveria ter funcionado';
  assert (select temperatura from public.negociacoes where id = v_neg_4) = 'morno', 'D deveria ter funcionado (negociação)';
  insert into _log (passo) values ('ok  D  SDR NAO-owner + pode_mover -> operação completa (cliente + negociação) funciona');

  -- -----------------------------------------------------------------------
  -- E. Somente pode_ver (sem pode_mover) -> operação INTEIRA bloqueada
  -- (nem o cliente, que a RPC toca primeiro, fica alterado).
  -- -----------------------------------------------------------------------
  v_nome_antes := (select nome from public.clientes where id = v_cliente_4);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_so_ve, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.salvar_ficha_negociacao(
      v_cliente_4, v_neg_4, 'pessoa_fisica', 'Nao Deveria Ficar', null, null, null,
      null, null, null, null, null, null, null,
      null, 'quente', null, null, null, null, null, null
    );
    reset role;
    raise exception 'E: deveria ter bloqueado (só pode_ver)';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nome from public.clientes where id = v_cliente_4) = v_nome_antes, 'E: nada deveria ter sido alterado';
  insert into _log (passo) values ('ok  E  só pode_ver (sem pode_mover) -> operação inteira bloqueada (42501), nada muda');

  -- -----------------------------------------------------------------------
  -- F. Owner sem pode_mover (zero permissões) -> bloqueado.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono_generico, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.salvar_ficha_negociacao(
      v_cliente_4, v_neg_4, 'pessoa_fisica', 'Nao Deveria Ficar', null, null, null,
      null, null, null, null, null, null, null,
      null, 'quente', null, null, null, null, null, null
    );
    reset role;
    raise exception 'F: deveria ter bloqueado (owner sem permissão)';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  F  owner_id sozinho (sem pode_mover) -> bloqueado (42501)');

  -- -----------------------------------------------------------------------
  -- G. Gerente -> funciona, sem nenhuma linha em permissoes_colaborador.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.salvar_ficha_negociacao(
    v_cliente_g, v_neg_g, 'pessoa_fisica', 'Cliente Atom G Editado', null, null, null,
    null, null, null, null, null, null, null,
    null, 'quente', null, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert (select nome from public.clientes where id = v_cliente_g) = 'Cliente Atom G Editado', 'G deveria ter funcionado';
  insert into _log (passo) values ('ok  G  gerente funciona, sem permissoes_colaborador nenhuma');

  -- -----------------------------------------------------------------------
  -- H. origem permanece imutável — esta RPC não tem parâmetro de origem,
  -- então é estruturalmente impossível alterá-la por este caminho.
  -- -----------------------------------------------------------------------
  assert (select origem from public.negociacoes where id = v_neg_1) = 'manual', 'origem não deveria ter mudado';
  insert into _log (passo) values ('ok  H  origem permanece imutável (a RPC nem tem esse parâmetro)');

  -- -----------------------------------------------------------------------
  -- I/K. etapa_id e funil_id permanecem protegidos — a chamada bem
  -- sucedida do cenário A não tocou nenhum dos dois.
  -- -----------------------------------------------------------------------
  assert (select etapa_id from public.negociacoes where id = v_neg_1) = v_etapa_aberta, 'etapa_id não deveria ter mudado';
  assert (select funil_id from public.negociacoes where id = v_neg_1) = v_funil_id, 'funil_id não deveria ter mudado';
  insert into _log (passo) values ('ok  I/K  etapa_id e funil_id permanecem protegidos (a RPC nunca os toca)');

  -- -----------------------------------------------------------------------
  -- J. owner_id (cliente E negociação) permanece protegido.
  -- -----------------------------------------------------------------------
  assert (select owner_id from public.clientes where id = v_cliente_1) = v_dono_generico, 'owner_id do cliente não deveria ter mudado';
  assert (select owner_id from public.negociacoes where id = v_neg_1) = v_dono_generico, 'owner_id da negociação não deveria ter mudado';
  insert into _log (passo) values ('ok  J  owner_id (cliente e negociação) permanece protegido');

  -- -----------------------------------------------------------------------
  -- L1. Encerrada + SÓ cliente alterado (os 8 campos operacionais enviados
  -- são EXATAMENTE os já salvos: null/'frio'/null/...) → sucesso, só o
  -- cliente muda.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.salvar_ficha_negociacao(
    v_cliente_l, v_neg_l, 'pessoa_fisica', 'Cliente Atom L Corrigido', null, null, null,
    null, null, null, null, null, null, null,
    null, 'frio', null, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert (select nome from public.clientes where id = v_cliente_l) = 'Cliente Atom L Corrigido',
    'L1: cadastro deveria ser editável mesmo com a negociação encerrada';
  assert (select temperatura from public.negociacoes where id = v_neg_l) = 'frio',
    'L1: campos operacionais não deveriam ter mudado (nem deveriam — foram enviados iguais)';
  insert into _log (passo) values ('ok  L1  encerrada + só cliente alterado (operacionais iguais ao salvo) -> sucesso');

  -- -----------------------------------------------------------------------
  -- L2. Encerrada + ALGUM campo operacional alterado (temperatura 'frio'
  -- -> 'quente'), cliente sem mudança nenhuma -> erro explícito, NADA
  -- persiste (nem o cliente, que nem deveria ter sido tocado).
  -- -----------------------------------------------------------------------
  v_nome_antes := (select nome from public.clientes where id = v_cliente_m);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.salvar_ficha_negociacao(
      v_cliente_m, v_neg_m, 'pessoa_fisica', v_nome_antes, null, null, null,
      null, null, null, null, null, null, null,
      null, 'quente', null, null, null, null, null, null
    );
    reset role;
    raise exception 'L2: deveria ter falhado (tentativa de alterar temperatura com a negociação encerrada)';
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_erro = message_text;
      assert v_erro = 'Os dados comerciais desta negociação estão encerrados e não podem ser alterados.',
        format('L2: mensagem inesperada: %s', v_erro);
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nome from public.clientes where id = v_cliente_m) = v_nome_antes,
    'L2: cliente NÃO deveria ter sido tocado — rejeitado antes de qualquer escrita';
  assert (select temperatura from public.negociacoes where id = v_neg_m) = 'frio',
    'L2: temperatura NÃO deveria ter mudado';
  insert into _log (passo) values ('ok  L2  encerrada + campo operacional alterado -> erro explícito, NADA persiste (nem o cliente)');

  -- -----------------------------------------------------------------------
  -- L3. Encerrada + cliente E operacional alterados juntos -> erro, NADA
  -- persiste — inclusive o que L1 já tinha salvo em v_cliente_l continua
  -- intacto (não é sobrescrito por esta tentativa rejeitada).
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.salvar_ficha_negociacao(
      v_cliente_l, v_neg_l, 'pessoa_fisica', 'Nunca Deveria Ficar', null, null, null,
      null, null, null, null, null, null, null,
      null, 'morno', null, null, null, null, null, null
    );
    reset role;
    raise exception 'L3: deveria ter falhado (cliente + operacional juntos, negociação encerrada)';
  exception
    when sqlstate '23514' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nome from public.clientes where id = v_cliente_l) = 'Cliente Atom L Corrigido',
    'L3: cliente deveria continuar com o valor salvo em L1, não "Nunca Deveria Ficar"';
  assert (select temperatura from public.negociacoes where id = v_neg_l) = 'frio',
    'L3: temperatura não deveria ter mudado';
  insert into _log (passo) values ('ok  L3  encerrada + cliente e operacional juntos -> erro, NADA persiste (nem sobrescreve o que já estava salvo)');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - salvar_ficha_negociacao (atomicidade).');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
