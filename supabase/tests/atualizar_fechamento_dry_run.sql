-- ===========================================================================
-- Dry-run de "Editar fechamento já existente"
-- (supabase/migrations/20260930160000_atualizar_fechamento.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute. NÃO
--   depende da migration acima já ter sido aplicada: a própria transação
--   instala, temporariamente, o trigger relaxado de
--   `negociacao_servicos_encerrada_somente_leitura` e a função
--   `atualizar_fechamento()` — byte a byte idênticas à migration.
--   `fechar_negociacao()` já está em produção (migration anterior) e não é
--   tocada aqui. ROLLBACK no final desfaz tudo — trigger, função e dados de
--   teste. Nada fica gravado.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- O QUE ELE PROVA
--   E1: valor_vendido é atualizado.
--   E2: serviços são sincronizados (substituição, igual a fechar_negociacao).
--   E3: observações são atualizadas.
--   E4: data_fechamento é atualizada.
--   P1: fechado_em NUNCA muda ao editar.
--   P2: fechado_por NUNCA muda ao editar.
--   P3: responsavel_id (atribuição de meta/comissão) NUNCA muda ao editar —
--       nem depois de transferir a carteira do cliente pra outro closer.
--   P4: nenhuma linha nova em historico_etapas.
--   P5: negociacoes.etapa_id continua a mesma etapa ganha.
--   P6: negociacoes.posicao continua igual.
--   B1: negociação perdida continua com negociacao_servicos bloqueada.
--   B2: tentar editar fechamento de negociação aberta/perdida é recusado.
--   N1: o mesmo fluxo funciona num SEGUNDO funil.
--   X1: nenhuma negociação/card/fechamento duplicado.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Instalação temporária.
-- ---------------------------------------------------------------------------
create or replace function public.negociacao_servicos_encerrada_somente_leitura()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_negociacao_id uuid := case when tg_op = 'DELETE' then old.negociacao_id else new.negociacao_id end;
begin
  if exists (
    select 1
    from public.negociacoes n
    where n.id = v_negociacao_id
      and public.etapa_tipo(n.etapa_id) = 'perdida'
  ) then
    raise exception 'Negociação perdida: dados comerciais não podem ser alterados.'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.atualizar_fechamento(
  p_negociacao_id      uuid,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null,
  p_servico_ids        uuid[] default null,
  p_observacoes        text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tipo public.tipo_etapa;
begin
  select e.tipo into v_tipo
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id
   where n.id = p_negociacao_id;

  if v_tipo is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if v_tipo <> 'ganha' then
    raise exception 'Só é possível editar o fechamento de uma negociação fechada.'
      using errcode = '23514';
  end if;

  delete from public.negociacao_servicos
   where negociacao_id = p_negociacao_id
     and servico_id <> all (coalesce(p_servico_ids, '{}'));

  insert into public.negociacao_servicos (negociacao_id, servico_id)
  select p_negociacao_id, novo.id
    from (
      select distinct unnest(coalesce(p_servico_ids, '{}')) as id
      except
      select ns.servico_id
        from public.negociacao_servicos ns
       where ns.negociacao_id = p_negociacao_id
    ) novo;

  update public.fechamentos
     set valor_vendido      = p_valor_vendido,
         data_fechamento    = p_data_fechamento,
         contrato_enviado   = p_contrato_enviado,
         contrato_assinado  = p_contrato_assinado,
         link_contrato      = p_link_contrato,
         status_pagamento   = p_status_pagamento,
         status_onboarding  = p_status_onboarding,
         observacoes        = p_observacoes
   where negociacao_id = p_negociacao_id;

  if not found then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;
end;
$$;

-- Mesmos grants da migration — a função recém-criada só teria o EXECUTE
-- padrão do Postgres pra PUBLIC sem isto.
revoke all on function public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
) from public, anon;

grant execute on function public.atualizar_fechamento(
  uuid, numeric, date, boolean, boolean,
  public.status_pagamento, public.status_onboarding, text, uuid[], text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Testes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente  uuid := 'eeeeeeee-3333-3333-3333-333333333333';
  v_closer_a uuid := 'ffffffff-3333-3333-3333-333333333333';
  v_closer_b uuid := 'aaaaaaaa-4444-4444-4444-444444444444';

  v_funil_principal uuid;
  v_perdido_principal uuid;
  v_funil_novo  uuid;

  v_servico_1 uuid;
  v_servico_2 uuid;
  v_servico_3 uuid;

  v_cliente_a uuid;
  v_cliente_b uuid;
  v_cliente_perdida uuid;
  v_negociacao_a uuid; -- edição completa (E1-E4, P1-P6, X1)
  v_negociacao_b uuid; -- segundo funil (N1)
  v_negociacao_perdida uuid; -- B1
  v_negociacao_aberta uuid;  -- B2

  v_etapa_ganha_principal uuid;
  v_etapa_id_antes  uuid;
  v_posicao_antes   numeric;
  v_fechado_em_antes      timestamptz;
  v_fechado_por_antes     uuid;
  v_responsavel_antes     uuid;

  v_etapa_id_depois uuid;
  v_posicao_depois  numeric;

  v_neg_antes   integer;
  v_neg_depois  integer;
  v_fech_antes  integer;
  v_fech_depois integer;
  v_hist_antes  integer;
  v_hist_depois integer;
  v_qtd_servicos integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.atualfech.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run AtualFech"}'::jsonb),
    (v_closer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.atualfech.closerA@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer A Dry-Run AtualFech"}'::jsonb),
    (v_closer_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.atualfech.closerB@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer B Dry-Run AtualFech"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_principal from public.funis where padrao;
  select id into v_perdido_principal
    from public.etapas_funil where funil_id = v_funil_principal and tipo = 'perdida';
  select id into v_etapa_ganha_principal
    from public.etapas_funil where funil_id = v_funil_principal and tipo = 'ganha';

  select public.criar_funil(
    'Funil Dry-Run AtualFech Multi',
    'Fechado — dry-run atualfech', 'verde',
    'Perdido — dry-run atualfech', 'vermelho',
    '[{"nome":"Contato — dry-run atualfech","cor":"azul"}]'::jsonb
  ) into v_funil_novo;

  select id into v_servico_1 from public.servicos where ativo order by nome limit 1;
  select id into v_servico_2 from public.servicos where ativo order by nome offset 1 limit 1;
  select id into v_servico_3 from public.servicos where ativo order by nome offset 2 limit 1;
  assert v_servico_1 is not null and v_servico_2 is not null and v_servico_3 is not null,
    'precisa de pelo menos 3 serviços ativos cadastrados pra este dry-run (catálogo seed)';

  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run AtualFech A', 'Empresa A', v_closer_a) returning id into v_cliente_a;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run AtualFech B', 'Empresa B', v_closer_a) returning id into v_cliente_b;
  insert into public.clientes (nome, empresa, owner_id) values
    ('Cliente Dry-Run AtualFech Perdida', 'Empresa P', v_closer_a) returning id into v_cliente_perdida;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_closer_a, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_a, v_funil_principal, 5000.00, 'quente') into v_negociacao_a;
  select public.criar_negociacao(v_cliente_b, v_funil_novo,      7000.00, 'quente') into v_negociacao_b;
  select public.criar_negociacao(v_cliente_perdida, v_funil_principal, 2000.00, 'frio') into v_negociacao_perdida;
  select public.criar_negociacao(v_cliente_a, v_funil_principal, 3000.00, 'morno') into v_negociacao_aberta;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select count(*) into v_neg_antes  from public.negociacoes;

  -- =========================================================================
  -- Fecha v_negociacao_a e v_negociacao_b (fluxo já existente, produção).
  -- =========================================================================
  perform public.fechar_negociacao(
    v_negociacao_a, 1, 5500.00, current_date - 10,
    true, true, 'pago', 'concluido', null,
    array[v_servico_1, v_servico_2], 'Fechamento original.'
  );
  perform public.fechar_negociacao(
    v_negociacao_b, 1, 7700.00, current_date - 5,
    true, true, 'pago', 'concluido', null,
    array[v_servico_1], 'Fechamento original — funil novo.'
  );
  update public.negociacoes
     set etapa_id = v_perdido_principal, motivo_perda = 'Motivo dry-run atualfech', posicao = 1
   where id = v_negociacao_perdida;

  -- X1 compara a contagem de `fechamentos` a partir DAQUI (depois dos dois
  -- fechar_negociacao acima, que legitimamente criam 2 linhas novas) — não
  -- antes, senão a asserção final falharia por um motivo errado.
  select count(*) into v_fech_antes from public.fechamentos;

  -- "Fotografia" do que atualizar_fechamento NUNCA pode mudar.
  select etapa_id, posicao into v_etapa_id_antes, v_posicao_antes
    from public.negociacoes where id = v_negociacao_a;
  select fechado_em, fechado_por, responsavel_id
    into v_fechado_em_antes, v_fechado_por_antes, v_responsavel_antes
    from public.fechamentos where negociacao_id = v_negociacao_a;
  select count(*) into v_hist_antes from public.historico_etapas where negociacao_id = v_negociacao_a;

  assert v_responsavel_antes = v_closer_a, 'responsavel_id do fechamento original deveria ser closer A';

  -- Transfere a carteira do cliente A pro closer B — simula o cenário real
  -- de risco: se atualizar_fechamento regravasse fechado_em (como
  -- fechar_negociacao faria), responsavel_id seria reatribuído pro dono
  -- ATUAL (closer B) na próxima edição. Isso NÃO pode acontecer aqui.
  update public.clientes set owner_id = v_closer_b where id = v_cliente_a;
  assert (select owner_id from public.negociacoes where id = v_negociacao_a) = v_closer_b,
    'owner_id da negociação deveria seguir o cliente (trigger existente, não desta migration)';

  -- =========================================================================
  -- E1-E4: edita valor, data, serviços (substitui 1+2 por 2+3) e observações.
  -- =========================================================================
  perform public.atualizar_fechamento(
    v_negociacao_a, 6600.00, current_date - 2,
    true, true, 'pago', 'concluido', null,
    array[v_servico_2, v_servico_3], 'Correção: valor renegociado.'
  );

  assert (select valor_vendido from public.fechamentos where negociacao_id = v_negociacao_a) = 6600.00,
    'E1: valor_vendido deveria ter sido atualizado';
  raise notice 'ok  E1  valor_vendido atualizado';

  select count(*) into v_qtd_servicos
    from public.negociacao_servicos where negociacao_id = v_negociacao_a;
  assert v_qtd_servicos = 2, format('E2: deveriam sobrar exatamente 2 serviços, tem %s', v_qtd_servicos);
  assert not exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_a and servico_id = v_servico_1
  ), 'E2: o serviço removido não deveria mais estar vinculado';
  assert exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_a and servico_id = v_servico_2
  ) and exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_a and servico_id = v_servico_3
  ), 'E2: os dois serviços novos deveriam estar vinculados';
  raise notice 'ok  E2  serviços sincronizados (substituição)';

  assert (select observacoes from public.fechamentos where negociacao_id = v_negociacao_a)
       = 'Correção: valor renegociado.',
    'E3: observações deveriam ter sido atualizadas';
  raise notice 'ok  E3  observações atualizadas';

  assert (select data_fechamento from public.fechamentos where negociacao_id = v_negociacao_a)
       = current_date - 2,
    'E4: data_fechamento deveria ter sido atualizada';
  raise notice 'ok  E4  data_fechamento atualizada';

  -- =========================================================================
  -- P1-P3: fechado_em, fechado_por e responsavel_id NUNCA mudam.
  -- =========================================================================
  assert (select fechado_em from public.fechamentos where negociacao_id = v_negociacao_a) = v_fechado_em_antes,
    'P1: fechado_em não poderia ter mudado';
  raise notice 'ok  P1  fechado_em preservado';

  assert (select fechado_por from public.fechamentos where negociacao_id = v_negociacao_a) = v_fechado_por_antes,
    'P2: fechado_por não poderia ter mudado';
  raise notice 'ok  P2  fechado_por preservado';

  assert (select responsavel_id from public.fechamentos where negociacao_id = v_negociacao_a) = v_closer_a,
    'P3: responsavel_id deveria continuar closer A, mesmo depois da carteira ter ido pro closer B';
  raise notice 'ok  P3  responsavel_id (atribuição de meta/comissão) preservado mesmo após transferência de carteira';

  -- =========================================================================
  -- P4-P6: histórico, etapa e posição intocados.
  -- =========================================================================
  select count(*) into v_hist_depois from public.historico_etapas where negociacao_id = v_negociacao_a;
  assert v_hist_depois = v_hist_antes,
    format('P4: não deveria haver linha nova em historico_etapas (antes=%s depois=%s)', v_hist_antes, v_hist_depois);
  raise notice 'ok  P4  nenhuma linha nova em historico_etapas';

  select etapa_id, posicao into v_etapa_id_depois, v_posicao_depois
    from public.negociacoes where id = v_negociacao_a;
  assert v_etapa_id_depois = v_etapa_id_antes and v_etapa_id_depois = v_etapa_ganha_principal,
    'P5: negociacoes.etapa_id deveria continuar a mesma etapa ganha';
  raise notice 'ok  P5  etapa continua ganha (mesma linha)';

  assert v_posicao_depois = v_posicao_antes,
    format('P6: posicao não poderia ter mudado (antes=%s depois=%s)', v_posicao_antes, v_posicao_depois);
  raise notice 'ok  P6  posição continua igual';

  -- =========================================================================
  -- B1: perdida continua com negociacao_servicos bloqueada.
  -- =========================================================================
  begin
    insert into public.negociacao_servicos (negociacao_id, servico_id)
    values (v_negociacao_perdida, v_servico_1);
    assert false, 'B1: não deveria ser possível vincular serviço a uma negociação perdida';
  exception when check_violation then
    raise notice 'ok  B1  negociação perdida continua bloqueada pra serviços';
  end;

  -- =========================================================================
  -- B2: editar fechamento de negociação aberta ou perdida é recusado.
  -- =========================================================================
  begin
    perform public.atualizar_fechamento(
      v_negociacao_aberta, 1000.00, current_date, false, false, 'pendente', 'nao_iniciado'
    );
    assert false, 'B2: não deveria ser possível editar fechamento de negociação aberta (não tem fechamento)';
  exception when check_violation then
    raise notice 'ok  B2a atualizar_fechamento recusa negociação aberta';
  end;

  begin
    perform public.atualizar_fechamento(
      v_negociacao_perdida, 1000.00, current_date, false, false, 'pendente', 'nao_iniciado'
    );
    assert false, 'B2: não deveria ser possível editar fechamento de negociação perdida';
  exception when check_violation then
    raise notice 'ok  B2b atualizar_fechamento recusa negociação perdida';
  end;

  -- =========================================================================
  -- N1: mesmo fluxo funciona num segundo funil.
  -- =========================================================================
  perform public.atualizar_fechamento(
    v_negociacao_b, 8800.00, current_date - 1,
    true, true, 'pago', 'concluido', null,
    array[v_servico_2], 'Correção no funil novo.'
  );
  assert (select valor_vendido from public.fechamentos where negociacao_id = v_negociacao_b) = 8800.00,
    'N1: valor_vendido deveria ter sido atualizado no funil novo';
  assert (
    select e.tipo from public.negociacoes n join public.etapas_funil e on e.id = n.etapa_id
     where n.id = v_negociacao_b
  ) = 'ganha', 'N1: negociação do funil novo deveria continuar ganha';
  assert exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_b and servico_id = v_servico_2
  ) and not exists (
    select 1 from public.negociacao_servicos where negociacao_id = v_negociacao_b and servico_id = v_servico_1
  ), 'N1: serviços deveriam ter sido sincronizados no funil novo';
  raise notice 'ok  N1  edição de fechamento funciona igual num segundo funil';

  -- =========================================================================
  -- X1: nenhuma negociação/card/fechamento duplicado.
  -- =========================================================================
  select count(*) into v_neg_depois  from public.negociacoes;
  select count(*) into v_fech_depois from public.fechamentos;
  assert v_neg_depois = v_neg_antes,
    format('X1: não deveria haver negociação/card novo (antes=%s depois=%s)', v_neg_antes, v_neg_depois);
  assert v_fech_depois = v_fech_antes,
    format('X1: não deveria haver fechamento novo — edição é UPDATE puro (antes=%s depois=%s)',
           v_fech_antes, v_fech_depois);
  raise notice 'ok  X1  nenhuma negociação/card/fechamento duplicado';

  raise notice 'TODOS OS TESTES DE ATUALIZAR FECHAMENTO PASSARAM (E1-E4, P1-P6, B1-B2, N1, X1)';
end $$;

select 'OK — TODOS OS TESTES DE ATUALIZAR FECHAMENTO PASSARAM' as resultado;

rollback;
