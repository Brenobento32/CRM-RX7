-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) PONTA-A-PONTA das proteções
-- dos dados operacionais do card — combina as duas migrations pendentes:
--
--   20261016160000_negociacoes_rpc_dados_operacionais.sql
--     RPC atualizar_dados_operacionais_negociacao (GERENTE ou pode_mover_
--     etapa, nunca owner_id) + salvar_negociacao delegando pra ela.
--   20261016170000_negociacoes_protecoes_operacionais.sql
--     origem imutável, lifecycle dos 8 campos (nicho_id incluso) e
--     negociacao_servicos por pode_mover_etapa — os backstops de banco pra
--     qualquer caminho que não passe pela RPC.
--
-- Não repete aqui as propriedades estáticas da RPC em si (SECURITY DEFINER,
-- search_path, grants) — isso está em
-- supabase/tests/negociacoes_rpc_dados_operacionais_test.sql. Este arquivo
-- prova o COMPORTAMENTO ponta-a-ponta das 16 regras pedidas.
--
-- SUBSTITUI de vez a versão anterior deste arquivo (que testava a proposta
-- de trigger sobre negociacoes_update, abandonada em favor da RPC).
--
-- SET ROLE authenticated de verdade em toda chamada mutante — sessão de
-- teste é postgres (superusuário), que bypassa RLS; sem o ROLE trocado um
-- teste de permissão passaria mesmo quebrado.
--
-- MAPA DOS 16 ITENS PEDIDOS
--   1   SDR NÃO-owner + pode_mover edita os 8 campos pela RPC.
--   2   CLOSER NÃO-owner + pode_mover edita.
--   3   SDR owner + só pode_ver bloqueado.
--   4   CLOSER owner + só pode_ver bloqueado.
--   5   Owner sem permissão bloqueado.
--   6   origem não pode ser alterada nem por gerente.
--   7   Negociação encerrada bloqueia os 8 campos.
--   8   Gerente edita negociação aberta de qualquer owner.
--   9   etapa_id continua protegido.
--   10  owner_id continua protegido.
--   11  funil_id continua protegido.
--   12  fechamento continua intocado.
--   13  Serviços: NÃO-owner + pode_mover consegue.
--   14  Serviços: só pode_ver não consegue.
--   15  Observação continua funcionando pra NÃO-owner + pode_mover.
--   16  Nenhuma operação altera etapa/owner/funil involuntariamente.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária — cópia exata das duas migrations pendentes.
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_dados_operacionais_negociacao(
  p_negociacao_id          uuid,
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
security definer
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_etapa_id uuid;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_id
    from public.negociacoes n
   where n.id = p_negociacao_id
     for update;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if public.etapa_tipo(v_etapa_id) <> 'aberta' then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  if not public.is_gerente() and not public.pode_mover_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para editar esta negociação.' using errcode = '42501';
  end if;

  update public.negociacoes
     set nicho_id              = p_nicho_id,
         temperatura            = p_temperatura,
         valor_estimado         = p_valor_estimado,
         data_primeira_reuniao  = p_data_primeira_reuniao,
         data_proposta          = p_data_proposta,
         objecao_principal      = p_objecao_principal,
         valor_proposta         = p_valor_proposta,
         forma_pagamento        = p_forma_pagamento
   where id = p_negociacao_id;
end;
$$;

revoke all on function public.atualizar_dados_operacionais_negociacao(
  uuid, uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) from public, anon;
grant execute on function public.atualizar_dados_operacionais_negociacao(
  uuid, uuid, public.temperatura_negociacao, numeric, date, date, text, numeric, public.forma_pagamento
) to authenticated;

create or replace function public.salvar_negociacao(
  p_negociacao_id          uuid,
  p_valor_estimado         numeric,
  p_temperatura            public.temperatura_negociacao,
  p_data_primeira_reuniao  date,
  p_data_proposta          date,
  p_objecao_principal      text,
  p_valor_proposta         numeric,
  p_forma_pagamento        public.forma_pagamento,
  p_servico_ids            uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_nicho_id uuid;
begin
  select n.nicho_id into v_nicho_id from public.negociacoes n where n.id = p_negociacao_id;

  perform public.atualizar_dados_operacionais_negociacao(
    p_negociacao_id, v_nicho_id, p_temperatura, p_valor_estimado,
    p_data_primeira_reuniao, p_data_proposta, p_objecao_principal,
    p_valor_proposta, p_forma_pagamento
  );

  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id from public.negociacao_servicos ns where ns.negociacao_id = p_negociacao_id
    ) novo;
end;
$$;

create or replace function public.negociacoes_origem_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origem is distinct from old.origem then
    raise exception 'A origem da negociação não pode ser alterada — é um registro histórico de como o lead entrou no CRM.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists negociacoes_origem_imutavel on public.negociacoes;
create trigger negociacoes_origem_imutavel
  before update of origem
  on public.negociacoes
  for each row
  execute function public.negociacoes_origem_imutavel();

create or replace function public.negociacoes_encerrada_somente_leitura()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.etapa_tipo(new.etapa_id) <> 'aberta'
     and (
       new.nicho_id, new.valor_estimado, new.temperatura, new.data_primeira_reuniao,
       new.data_proposta, new.objecao_principal, new.valor_proposta,
       new.forma_pagamento
     ) is distinct from (
       old.nicho_id, old.valor_estimado, old.temperatura, old.data_primeira_reuniao,
       old.data_proposta, old.objecao_principal, old.valor_proposta,
       old.forma_pagamento
     )
  then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists negociacoes_encerrada_somente_leitura on public.negociacoes;
create trigger negociacoes_encerrada_somente_leitura
  before update of nicho_id, valor_estimado, temperatura, data_primeira_reuniao, data_proposta,
                   objecao_principal, valor_proposta, forma_pagamento
  on public.negociacoes
  for each row
  execute function public.negociacoes_encerrada_somente_leitura();

drop policy if exists negociacao_servicos_insert on public.negociacao_servicos;
create policy negociacao_servicos_insert on public.negociacao_servicos
  for insert
  to authenticated
  with check (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = negociacao_servicos.negociacao_id
        and public.pode_mover_etapa(n.funil_id, n.etapa_id)
    )
  );

drop policy if exists negociacao_servicos_delete on public.negociacao_servicos;
create policy negociacao_servicos_delete on public.negociacao_servicos
  for delete
  to authenticated
  using (
    public.is_gerente()
    or exists (
      select 1 from public.negociacoes n
      where n.id = negociacao_servicos.negociacao_id
        and public.pode_mover_etapa(n.funil_id, n.etapa_id)
    )
  );

-- ===========================================================================
-- Fixtures + asserts.
-- ===========================================================================
create temp table _log (id serial primary key, passo text);

do $$
declare
  v_gerente              uuid := 'd0000000-0000-0000-0000-000000000001';
  v_dono_generico        uuid := 'd0000000-0000-0000-0000-000000000002'; -- só é owner_id, nunca loga
  v_sdr_nao_owner        uuid := 'd0000000-0000-0000-0000-000000000003'; -- pode_mover, NÃO é owner
  v_closer_nao_owner     uuid := 'd0000000-0000-0000-0000-000000000004'; -- pode_mover, NÃO é owner
  v_sdr_owner_so_ve      uuid := 'd0000000-0000-0000-0000-000000000005'; -- owner + só pode_ver
  v_closer_owner_so_ve   uuid := 'd0000000-0000-0000-0000-000000000006'; -- owner + só pode_ver
  v_owner_sem_permissao  uuid := 'd0000000-0000-0000-0000-000000000007'; -- owner, zero linhas

  v_funil_id     uuid;
  v_etapa_aberta uuid;
  v_etapa_ganha  uuid;

  v_nicho_id    uuid;
  v_servico_id  uuid;

  v_cliente_1 uuid; v_neg_1 uuid; -- sdr não-owner edita (1, 6, 9, 10, 11, 13, 15, 16)
  v_cliente_2 uuid; v_neg_2 uuid; -- closer não-owner edita (2)
  v_cliente_3 uuid; v_neg_3 uuid; -- sdr owner só pode_ver (3, 14)
  v_cliente_4 uuid; v_neg_4 uuid; -- closer owner só pode_ver (4)
  v_cliente_5 uuid; v_neg_5 uuid; -- owner sem permissão (5)
  v_cliente_6 uuid; v_neg_6 uuid; -- gerente edita negociação de outro owner (8)
  v_cliente_7 uuid; v_neg_7 uuid; -- nasce em etapa ganha (7)

  v_erro text;
  v_total integer;
begin
  -- -------------------------------------------------------------------
  -- 0. Massa de teste.
  -- -------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Protecoes"}'::jsonb),
    (v_dono_generico, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dono.generico.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Dono Generico Protecoes"}'::jsonb),
    (v_sdr_nao_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.nao.owner.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Nao Owner Protecoes"}'::jsonb),
    (v_closer_nao_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.nao.owner.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer Nao Owner Protecoes"}'::jsonb),
    (v_sdr_owner_so_ve, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.owner.so.ve.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Owner So Ve Protecoes"}'::jsonb),
    (v_closer_owner_so_ve, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'closer.owner.so.ve.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Closer Owner So Ve Protecoes"}'::jsonb),
    (v_owner_sem_permissao, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner.sem.permissao.protecoes@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"Owner Sem Permissao Protecoes"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Protecoes Operacionais', false) returning id into v_funil_id;

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Aberta Protecoes', 'azul', 1000, 'aberta') returning id into v_etapa_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Ganha Protecoes', 'verde', 100000, 'ganha') returning id into v_etapa_ganha;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Perdida Protecoes', 'vermelho', 100001, 'perdida');

  insert into public.nichos (nome, slug, cor) values ('Nicho Teste Protecoes', 'nicho-teste-protecoes', 'azul')
    returning id into v_nicho_id;
  insert into public.servicos (nome) values ('Servico Teste Protecoes') returning id into v_servico_id;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_nao_owner,       v_funil_id, null,           null, null,  v_gerente),
    (v_sdr_nao_owner,       v_funil_id, v_etapa_aberta, true, true,  v_gerente),
    (v_closer_nao_owner,    v_funil_id, null,           null, null,  v_gerente),
    (v_closer_nao_owner,    v_funil_id, v_etapa_aberta, true, true,  v_gerente),
    (v_sdr_owner_so_ve,     v_funil_id, null,           null, null,  v_gerente),
    (v_sdr_owner_so_ve,     v_funil_id, v_etapa_aberta, true, false, v_gerente),
    (v_closer_owner_so_ve,  v_funil_id, null,           null, null,  v_gerente),
    (v_closer_owner_so_ve,  v_funil_id, v_etapa_aberta, true, false, v_gerente),
    -- Só pode_ver (nunca pode_mover): dá visibilidade a v_dono_generico pra
    -- ele alcançar o próprio UPDATE de origem (negociacoes_update: owner_id
    -- OR gerente — não é tocada por esta mudança).
    (v_dono_generico,       v_funil_id, null,           null, null,  v_gerente),
    (v_dono_generico,       v_funil_id, v_etapa_aberta, true, false, v_gerente);
  -- v_owner_sem_permissao: deliberadamente ZERO linhas.

  -- -------------------------------------------------------------------
  -- Clientes/negociações.
  -- -------------------------------------------------------------------
  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 1', '11900000031', v_dono_generico) returning id into v_cliente_1;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_1, v_etapa_aberta, 'manual') returning id into v_neg_1;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 2', '11900000032', v_dono_generico) returning id into v_cliente_2;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_2, v_etapa_aberta, 'manual') returning id into v_neg_2;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 3', '11900000033', v_sdr_owner_so_ve) returning id into v_cliente_3;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_3, v_etapa_aberta, 'manual') returning id into v_neg_3;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 4', '11900000034', v_closer_owner_so_ve) returning id into v_cliente_4;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_4, v_etapa_aberta, 'manual') returning id into v_neg_4;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 5', '11900000035', v_owner_sem_permissao) returning id into v_cliente_5;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_5, v_etapa_aberta, 'manual') returning id into v_neg_5;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 6', '11900000036', v_dono_generico) returning id into v_cliente_6;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_6, v_etapa_aberta, 'manual') returning id into v_neg_6;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Protecoes 7', '11900000037', v_dono_generico) returning id into v_cliente_7;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_7, v_etapa_ganha, 'manual') returning id into v_neg_7;

  -- -------------------------------------------------------------------
  -- 1. SDR NÃO owner, com pode_mover, edita os 8 campos pela RPC.
  -- -------------------------------------------------------------------
  assert (select owner_id from public.negociacoes where id = v_neg_1) <> v_sdr_nao_owner,
    'pré-condição: v_sdr_nao_owner não deveria ser owner de v_neg_1';

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.atualizar_dados_operacionais_negociacao(
    v_neg_1, v_nicho_id, 'quente', 5000, '2026-10-20', '2026-10-25', 'Preço alto', 4500, 'avista'
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);

  assert (select (nicho_id, temperatura, valor_estimado, data_primeira_reuniao, data_proposta,
                  objecao_principal, valor_proposta, forma_pagamento)
          from public.negociacoes where id = v_neg_1)
         = (v_nicho_id, 'quente'::public.temperatura_negociacao, 5000::numeric, '2026-10-20'::date,
            '2026-10-25'::date, 'Preço alto'::text, 4500::numeric, 'avista'::public.forma_pagamento),
    'os 8 campos deveriam ter sido salvos';
  insert into _log (passo) values ('ok  1  SDR NAO-owner + pode_mover edita os 8 campos pela RPC');

  -- -------------------------------------------------------------------
  -- 2. CLOSER NÃO owner, com pode_mover, edita.
  -- -------------------------------------------------------------------
  assert (select owner_id from public.negociacoes where id = v_neg_2) <> v_closer_nao_owner,
    'pré-condição: v_closer_nao_owner não deveria ser owner de v_neg_2';

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.atualizar_dados_operacionais_negociacao(
    v_neg_2, null, 'morno', 3000, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);

  assert (select temperatura from public.negociacoes where id = v_neg_2) = 'morno',
    'CLOSER NAO-owner deveria conseguir editar';
  insert into _log (passo) values ('ok  2  CLOSER NAO-owner + pode_mover edita');

  -- -------------------------------------------------------------------
  -- 3. SDR owner + só pode_ver bloqueado.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_owner_so_ve, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_3, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception 'deveria ter bloqueado: SDR owner só com pode_ver';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nicho_id from public.negociacoes where id = v_neg_3) is null, 'nicho_id não deveria ter sido salvo';
  insert into _log (passo) values ('ok  3  SDR owner + só pode_ver bloqueado (42501)');

  -- -------------------------------------------------------------------
  -- 4. CLOSER owner + só pode_ver bloqueado.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_owner_so_ve, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_4, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception 'deveria ter bloqueado: CLOSER owner só com pode_ver';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  4  CLOSER owner + só pode_ver bloqueado (42501)');

  -- -------------------------------------------------------------------
  -- 5. Owner sem NENHUMA permissão bloqueado.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_sem_permissao, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_5, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception 'deveria ter bloqueado: owner sem nenhuma permissão';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nicho_id from public.negociacoes where id = v_neg_5) is null, 'nicho_id não deveria ter sido salvo';
  insert into _log (passo) values ('ok  5  owner sem nenhuma permissão bloqueado (42501)');

  -- -------------------------------------------------------------------
  -- 6. origem não pode ser alterada nem pelo próprio owner, nem pelo
  -- gerente. v_dono_generico tem pode_ver (visibilidade) mas não pode_mover
  -- — alcança a RLS de UPDATE normal (owner_id), e ainda assim a trigger
  -- de origem recusa.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono_generico, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    update public.negociacoes set origem = 'whatsapp' where id = v_neg_1;
    reset role;
    raise exception 'deveria ter bloqueado: origem é imutável (owner)';
  exception
    when sqlstate '23514' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    update public.negociacoes set origem = 'formulario' where id = v_neg_1;
    reset role;
    raise exception 'deveria ter bloqueado: origem é imutável (gerente)';
  exception
    when sqlstate '23514' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select origem from public.negociacoes where id = v_neg_1) = 'manual', 'origem não deveria ter mudado';
  insert into _log (passo) values ('ok  6  origem imutável — nem o próprio owner nem o gerente conseguem alterar');

  -- -------------------------------------------------------------------
  -- 7. Negociação encerrada (ganha) bloqueia os 8 campos — SDR e gerente.
  -- -------------------------------------------------------------------
  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr_nao_owner, v_funil_id, v_etapa_ganha, true, true, v_gerente);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_7, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception 'deveria ter bloqueado: negociação encerrada (ganha), mesmo com pode_mover';
  exception
    when sqlstate '23514' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_7, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception 'deveria ter bloqueado: lifecycle não isenta gerente';
  exception
    when sqlstate '23514' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nicho_id from public.negociacoes where id = v_neg_7) is null, 'nicho_id não deveria ter sido salvo';
  insert into _log (passo) values ('ok  7  negociação encerrada bloqueia os 8 campos — SDR com pode_mover E gerente');

  -- -------------------------------------------------------------------
  -- 8. Gerente edita negociação aberta de QUALQUER owner.
  -- -------------------------------------------------------------------
  assert (select owner_id from public.negociacoes where id = v_neg_6) <> v_gerente,
    'pré-condição: gerente não é owner de v_neg_6';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.atualizar_dados_operacionais_negociacao(
    v_neg_6, v_nicho_id, 'frio', 7000, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert (select temperatura from public.negociacoes where id = v_neg_6) = 'frio',
    'gerente deveria conseguir editar negociação de qualquer owner';
  insert into _log (passo) values ('ok  8  gerente edita negociação aberta de qualquer owner, sem permissoes_colaborador');

  -- -------------------------------------------------------------------
  -- 9/10/11. etapa_id, owner_id e funil_id continuam protegidos.
  -- -------------------------------------------------------------------
  assert (select etapa_id from public.negociacoes where id = v_neg_1) = v_etapa_aberta, 'etapa_id não deveria ter mudado';
  assert (select owner_id from public.negociacoes where id = v_neg_1) = v_dono_generico, 'owner_id não deveria ter mudado';
  assert (select funil_id from public.negociacoes where id = v_neg_1) = v_funil_id, 'funil_id não deveria ter mudado';
  insert into _log (passo) values ('ok  9/10/11  etapa_id, owner_id e funil_id continuam protegidos');

  -- -------------------------------------------------------------------
  -- 12. fechamentos continua intocado.
  -- -------------------------------------------------------------------
  select count(*) into v_total
    from public.fechamentos
   where negociacao_id in (v_neg_1, v_neg_2, v_neg_3, v_neg_4, v_neg_5, v_neg_6, v_neg_7);
  assert v_total = 0, 'nenhum destes caminhos deveria ter criado linha em fechamentos';
  insert into _log (passo) values ('ok  12  fechamentos continua intocado');

  -- -------------------------------------------------------------------
  -- 13/14. Serviços: NÃO-owner + pode_mover consegue; só pode_ver não.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  insert into public.negociacao_servicos (negociacao_id, servico_id) values (v_neg_1, v_servico_id);
  delete from public.negociacao_servicos where negociacao_id = v_neg_1 and servico_id = v_servico_id;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  13  serviços: closer NAO-owner + pode_mover vincula E desvincula');

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_owner_so_ve, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    insert into public.negociacao_servicos (negociacao_id, servico_id) values (v_neg_3, v_servico_id);
    reset role;
    raise exception 'deveria ter bloqueado: só pode_ver, sem pode_mover, em serviços';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  14  serviços: owner só com pode_ver bloqueado (42501)');

  -- -------------------------------------------------------------------
  -- 15. Observação (atividades) continua funcionando pra NÃO-owner +
  -- pode_mover.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr_nao_owner, 'role', 'authenticated')::text, true);
  set role authenticated;
  insert into public.atividades (cliente_id, negociacao_id, tipo, descricao, data)
    values (v_cliente_1, v_neg_1, 'nota', 'Observação de teste protecoes', now());
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert exists (select 1 from public.atividades where negociacao_id = v_neg_1 and descricao = 'Observação de teste protecoes'),
    'SDR NAO-owner com pode_mover deveria continuar conseguindo registrar observação';
  insert into _log (passo) values ('ok  15  observação continua funcionando pra NAO-owner + pode_mover');

  -- -------------------------------------------------------------------
  -- 16. Nenhuma operação acima alterou etapa/owner/funil involuntariamente
  -- — verificação cruzada final nas 7 negociações usadas neste teste.
  -- -------------------------------------------------------------------
  assert (select etapa_id from public.negociacoes where id = v_neg_2) = v_etapa_aberta, 'v_neg_2: etapa_id não deveria ter mudado';
  assert (select owner_id from public.negociacoes where id = v_neg_2) = v_dono_generico, 'v_neg_2: owner_id não deveria ter mudado';
  assert (select funil_id from public.negociacoes where id = v_neg_2) = v_funil_id, 'v_neg_2: funil_id não deveria ter mudado';
  assert (select etapa_id from public.negociacoes where id = v_neg_6) = v_etapa_aberta, 'v_neg_6: etapa_id não deveria ter mudado';
  assert (select owner_id from public.negociacoes where id = v_neg_6) = v_dono_generico, 'v_neg_6: owner_id não deveria ter mudado';
  assert (select etapa_id from public.negociacoes where id = v_neg_7) = v_etapa_ganha, 'v_neg_7: etapa_id deveria continuar ganha (nenhuma tentativa bloqueada mudou etapa)';
  insert into _log (passo) values ('ok  16  nenhuma operação alterou etapa/owner/funil involuntariamente, em nenhuma das 7 negociações');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - protecoes operacionais (RPC 160000 + 170000).');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
