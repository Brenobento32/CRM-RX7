-- ===========================================================================
-- Teste de fumaça (transacional, begin/rollback) FOCADO NA RPC
-- `atualizar_dados_operacionais_negociacao` (migration 20261016160000_
-- negociacoes_rpc_dados_operacionais.sql) — propriedades da função em si,
-- separado do teste de comportamento ponta-a-ponta (que cobre as triggers
-- de 20261016170000 junto, em
-- supabase/tests/negociacoes_protecoes_operacionais_test.sql). Não repete
-- aqui a matriz completa de owner/permissão — só uma prova mínima de cada
-- propriedade pedida.
--
-- AUTO-INSTALAÇÃO TRANSACIONAL: a RPC ainda não foi aplicada no banco real
-- (migration pendente) — instalada aqui como cópia exata, rollback no fim.
--
-- SET ROLE authenticated de verdade em toda chamada mutante — sessão de
-- teste é postgres (superusuário), que bypassa RLS; sem o ROLE trocado um
-- teste de permissão passaria mesmo quebrado.
--
-- CHECKLIST PEDIDO
--   1  SECURITY DEFINER
--   2  search_path vazio
--   3  EXECUTE só para authenticated (nunca public/anon)
--   4  decide por auth.uid() da sessão (não um id fixo)
--   5  GERENTE OU pode_mover_etapa autoriza
--   6  owner_id é ignorado (não é consultado na autorização)
--   7  só escreve os 8 campos operacionais (assinatura: 1 id + 8 campos)
--   8  exige negociação aberta
--   9  lifecycle: recusa fora de etapa aberta
--   10 nenhum campo protegido (etapa_id/funil_id/owner_id) é alterado
-- ===========================================================================

begin;

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

create temp table _log (id serial primary key, passo text);

do $$
declare
  v_oid        oid;
  v_prosecdef  boolean;
  v_proconfig  text[];
  v_nargs      int;

  v_gerente   uuid := 'f0000000-0000-0000-0000-000000000001';
  v_sdr       uuid := 'f0000000-0000-0000-0000-000000000002'; -- pode_mover, NÃO é owner
  v_dono      uuid := 'f0000000-0000-0000-0000-000000000003'; -- só owner_id, zero permissões

  v_funil_id     uuid;
  v_etapa_aberta uuid;
  v_etapa_ganha  uuid;
  v_nicho_id     uuid;

  v_cliente_aberta uuid; v_neg_aberta uuid;
  v_cliente_ganha  uuid; v_neg_ganha  uuid;

  v_erro text;
begin
  -- -----------------------------------------------------------------------
  -- 1/2/3/7. Propriedades estáticas — direto do catálogo, sem fixture.
  -- -----------------------------------------------------------------------
  select p.oid, p.prosecdef, p.proconfig, p.pronargs
    into v_oid, v_prosecdef, v_proconfig, v_nargs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'atualizar_dados_operacionais_negociacao';

  assert v_prosecdef, '1  deveria ser SECURITY DEFINER';
  insert into _log (passo) values ('ok  1  SECURITY DEFINER confirmado (pg_proc.prosecdef = true)');

  assert v_proconfig is not null and 'search_path=""' = any (v_proconfig), '2  search_path deveria estar vazio (set search_path = '''')';
  insert into _log (passo) values ('ok  2  search_path vazio confirmado (pg_proc.proconfig contém search_path=)');

  assert v_nargs = 9, format('7  esperava 9 argumentos (1 id + 8 campos operacionais), achou %s', v_nargs);
  insert into _log (passo) values ('ok  7  assinatura tem exatamente 9 argumentos (p_negociacao_id + 8 campos operacionais)');

  assert not has_function_privilege('anon', v_oid, 'EXECUTE'), '3  anon não deveria ter EXECUTE';
  assert not has_function_privilege('public', v_oid, 'EXECUTE'), '3  public não deveria ter EXECUTE';
  assert has_function_privilege('authenticated', v_oid, 'EXECUTE'), '3  authenticated deveria ter EXECUTE';
  insert into _log (passo) values ('ok  3  EXECUTE só para authenticated (anon e public sem acesso)');

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gerente.rpc.props@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente RPC"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sdr.rpc.props@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR RPC"}'::jsonb),
    (v_dono, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dono.rpc.props@teste.local', '', now(), now(), now(),
     '{"role":"closer"}'::jsonb, '{"nome":"Dono RPC"}'::jsonb);

  insert into public.funis (nome, padrao) values ('Teste Propriedades RPC', false) returning id into v_funil_id;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Aberta Props', 'azul', 1000, 'aberta') returning id into v_etapa_aberta;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Ganha Props', 'verde', 100000, 'ganha') returning id into v_etapa_ganha;
  insert into public.nichos (nome, slug, cor) values ('Nicho Props RPC', 'nicho-props-rpc', 'azul') returning id into v_nicho_id;

  insert into public.permissoes_colaborador (usuario_id, funil_id, etapa_id, pode_ver, pode_mover, criado_por) values
    (v_sdr, v_funil_id, null,           null, null, v_gerente),
    (v_sdr, v_funil_id, v_etapa_aberta, true, true, v_gerente);
  -- v_dono: zero linhas (owner puro).

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Props Aberta', '11900000021', v_dono) returning id into v_cliente_aberta;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_aberta, v_etapa_aberta, 'manual') returning id into v_neg_aberta;

  insert into public.clientes (tipo_cliente, nome, telefone, owner_id) values
    ('pessoa_fisica', 'Cliente Props Ganha', '11900000022', v_dono) returning id into v_cliente_ganha;
  insert into public.negociacoes (cliente_id, etapa_id, origem) values
    (v_cliente_ganha, v_etapa_ganha, 'manual') returning id into v_neg_ganha;

  -- -----------------------------------------------------------------------
  -- 4. Decide pelo auth.uid() da SESSÃO, não um id fixo — o MESMO SDR, SEM
  -- trocar nada no código, autoriza numa negociação (tem pode_mover) e é
  -- recusado na outra simulação de identidade (achado abaixo, item 6).
  -- Aqui provamos que mudar o `sub` do JWT muda o resultado (comportamento
  -- amarrado à sessão, não a um valor hardcoded na função).
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.atualizar_dados_operacionais_negociacao(
    v_neg_aberta, v_nicho_id, 'quente', 1000, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert (select temperatura from public.negociacoes where id = v_neg_aberta) = 'quente',
    '4  SDR autorizado (auth.uid() = v_sdr) deveria ter editado';
  insert into _log (passo) values ('ok  4  decide por auth.uid() da sessão (SDR autorizado edita)');

  -- 6. owner_id é ignorado: v_sdr editou v_neg_aberta sem ser owner (owner é v_dono).
  assert (select owner_id from public.negociacoes where id = v_neg_aberta) = v_dono,
    '6  owner_id deveria continuar sendo v_dono, nunca consultado pela RPC';
  insert into _log (passo) values ('ok  6  owner_id ignorado na autorização (SDR não-owner editou mesmo assim)');

  -- -----------------------------------------------------------------------
  -- 5. GERENTE OU pode_mover_etapa — prova o lado GERENTE (SDR já provado
  -- acima via pode_mover_etapa).
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  perform public.atualizar_dados_operacionais_negociacao(
    v_neg_aberta, v_nicho_id, 'frio', 2000, null, null, null, null, null
  );
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert (select temperatura from public.negociacoes where id = v_neg_aberta) = 'frio',
    '5  gerente deveria autorizar por si só, sem permissoes_colaborador';
  insert into _log (passo) values ('ok  5  GERENTE autoriza por si só (sem pode_mover_etapa nenhuma)');

  -- Dono puro (zero permissões, não gerente) é recusado — reforça que nem
  -- owner_id nem "ausência de erro" bastam; só gerente ou pode_mover.
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_aberta, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception '5  deveria ter recusado: dono puro não é gerente nem tem pode_mover';
  exception
    when sqlstate '42501' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into _log (passo) values ('ok  5b  nem gerente nem pode_mover -> 42501 (owner_id sozinho não é nenhum dos dois)');

  -- -----------------------------------------------------------------------
  -- 8/9. Exige negociação aberta — recusa explícita fora de etapa aberta,
  -- mesmo pro gerente.
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  set role authenticated;
  begin
    perform public.atualizar_dados_operacionais_negociacao(
      v_neg_ganha, v_nicho_id, null, null, null, null, null, null, null
    );
    reset role;
    raise exception '8/9  deveria ter recusado: negociação não está aberta (etapa ganha)';
  exception
    when sqlstate '23514' then
      reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  assert (select nicho_id from public.negociacoes where id = v_neg_ganha) is null,
    'nicho_id não deveria ter sido salvo numa negociação encerrada';
  insert into _log (passo) values ('ok  8/9  exige etapa aberta — recusa explícita (23514) mesmo pro gerente, fora disso');

  -- -----------------------------------------------------------------------
  -- 10. Nenhum campo protegido (etapa_id/funil_id/owner_id) é alterado —
  -- as chamadas bem-sucedidas acima (4, 5) não tocaram nenhum dos três.
  -- -----------------------------------------------------------------------
  assert (select etapa_id from public.negociacoes where id = v_neg_aberta) = v_etapa_aberta, 'etapa_id não deveria ter mudado';
  assert (select funil_id from public.negociacoes where id = v_neg_aberta) = v_funil_id, 'funil_id não deveria ter mudado';
  assert (select owner_id from public.negociacoes where id = v_neg_aberta) = v_dono, 'owner_id não deveria ter mudado';
  insert into _log (passo) values ('ok  10  etapa_id/funil_id/owner_id continuam intocados pela RPC');

  insert into _log (passo) values ('');
  insert into _log (passo) values ('TODAS AS ASSERCOES PASSARAM - propriedades de atualizar_dados_operacionais_negociacao.');
exception
  when others then
    get stacked diagnostics v_erro = message_text;
    insert into _log (passo) values ('FALHOU: ' || v_erro);
    raise exception 'FALHOU: %', v_erro;
end;
$$;

select passo from _log order by id;

rollback;
