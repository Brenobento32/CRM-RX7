-- ===========================================================================
-- Teste transacional da INFRAESTRUTURA de anulação de fechamentos
-- (20261019160000_fechamentos_anulacao.sql) — a migration ainda não foi
-- aplicada no banco real, então este teste instala uma cópia idêntica das
-- colunas/constraint/RPC/guardas antes de testar, igual ao padrão já usado
-- por desqualificar_negociacao_test.sql. BEGIN/ROLLBACK: nada permanece.
--
-- NÃO testa a correção dos 2 registros reais (isso é
-- corrige_fechamentos_extras_outubro_test.sql, separado) — aqui é só o
-- mecanismo genérico de anulação, com dados sintéticos.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Instala a infraestrutura (cópia de 20261019160000_fechamentos_anulacao.sql,
-- só as partes relevantes a este teste: colunas + constraint + RPC + guardas
-- em fechar_negociacao/atualizar_fechamento). A função funil_metricas (não
-- exercida aqui) fica para o outro teste.
-- ---------------------------------------------------------------------------
alter table public.fechamentos
  add column if not exists anulado_em      timestamptz null,
  add column if not exists motivo_anulacao text        null,
  add column if not exists anulado_por     uuid        null references public.profiles(id) on delete restrict;

alter table public.fechamentos drop constraint if exists fechamentos_anulacao_valida;
alter table public.fechamentos add constraint fechamentos_anulacao_valida check (
  (anulado_em is null and motivo_anulacao is null and anulado_por is null)
  or
  (anulado_em is not null and motivo_anulacao is not null and btrim(motivo_anulacao) <> '')
);

create or replace function public.anular_fechamento(
  p_negociacao_id uuid,
  p_motivo        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_motivo text := btrim(p_motivo);
  v_existe boolean;
  v_ja_anulado boolean;
begin
  if v_uid is null then
    raise exception 'Operação exige um usuário autenticado.' using errcode = '42501';
  end if;

  if not public.is_gerente() then
    raise exception 'Somente gerentes podem anular um fechamento.' using errcode = '42501';
  end if;

  select true, f.anulado_em is not null into v_existe, v_ja_anulado
    from public.fechamentos f
   where f.negociacao_id = p_negociacao_id;

  if v_existe is null then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;

  if v_ja_anulado then
    raise exception 'Este fechamento já está anulado.' using errcode = '23514';
  end if;

  if v_motivo is null or v_motivo = '' then
    raise exception 'Informe o motivo da anulação.' using errcode = '23514';
  end if;

  update public.fechamentos
     set anulado_em      = now(),
         motivo_anulacao = v_motivo,
         anulado_por     = v_uid
   where negociacao_id = p_negociacao_id;
end;
$$;

revoke all on function public.anular_fechamento(uuid, text) from public, anon;
grant execute on function public.anular_fechamento(uuid, text) to authenticated;

create or replace function public.fechar_negociacao(
  p_negociacao_id      uuid,
  p_posicao            numeric,
  p_valor_vendido      numeric,
  p_data_fechamento    date,
  p_contrato_enviado   boolean,
  p_contrato_assinado  boolean,
  p_status_pagamento   public.status_pagamento,
  p_status_onboarding  public.status_onboarding,
  p_link_contrato      text default null,
  p_servico_ids        uuid[] default null,
  p_observacoes        text default null,
  p_tipo_venda         public.tipo_venda default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_funil_id uuid;
  v_ganha_id uuid;
begin
  select n.funil_id into v_funil_id
    from public.negociacoes n
   where n.id = p_negociacao_id;

  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.fechamentos f
    where f.negociacao_id = p_negociacao_id and f.anulado_em is not null
  ) then
    raise exception 'Este fechamento foi anulado e não pode ser reaberto/sobrescrito por aqui — exige um fluxo de reativação (ainda não implementado).'
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

  select e.id into v_ganha_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id
     and e.tipo = 'ganha';

  update public.negociacoes
     set etapa_id = v_ganha_id,
         posicao = p_posicao
   where id = p_negociacao_id;

  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado,
    contrato_assinado, link_contrato, status_pagamento, status_onboarding,
    observacoes, tipo_venda
  )
  values (
    p_negociacao_id, p_valor_vendido, p_data_fechamento, p_contrato_enviado,
    p_contrato_assinado, p_link_contrato, p_status_pagamento, p_status_onboarding,
    p_observacoes, p_tipo_venda
  )
  on conflict (negociacao_id) do update
    set valor_vendido      = excluded.valor_vendido,
        data_fechamento    = excluded.data_fechamento,
        contrato_enviado   = excluded.contrato_enviado,
        contrato_assinado  = excluded.contrato_assinado,
        link_contrato      = excluded.link_contrato,
        status_pagamento   = excluded.status_pagamento,
        status_onboarding  = excluded.status_onboarding,
        observacoes        = excluded.observacoes,
        tipo_venda         = coalesce(excluded.tipo_venda, public.fechamentos.tipo_venda),
        fechado_por        = excluded.fechado_por,
        fechado_em         = now();
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
  p_observacoes        text default null,
  p_tipo_venda         public.tipo_venda default null
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

  if exists (
    select 1 from public.fechamentos f
    where f.negociacao_id = p_negociacao_id and f.anulado_em is not null
  ) then
    raise exception 'Este fechamento foi anulado e não pode ser editado — exige um fluxo de reativação (ainda não implementado).'
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
         observacoes        = p_observacoes,
         tipo_venda         = coalesce(p_tipo_venda, tipo_venda)
   where negociacao_id = p_negociacao_id;

  if not found then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: 1 funil, 1 etapa ganha, 3 usuários (gerente/sdr/closer), 1
-- negociação já em ganha com 1 fechamento ativo.
-- ---------------------------------------------------------------------------
do $$
declare
  v_gerente uuid := gen_random_uuid();
  v_sdr     uuid := gen_random_uuid();
  v_closer  uuid := gen_random_uuid();

  v_funil_id uuid;
  v_etapa_ganha uuid;
  v_cliente_id uuid;
  v_neg_id uuid;

  v_valor numeric; v_tipo public.tipo_venda; v_data date; v_neg_id_check uuid; v_resp_id uuid;
  v_etapa_id_antes uuid; v_etapa_id_depois uuid;
  v_hist_antes int; v_hist_depois int;
  v_anulado_em timestamptz; v_motivo text; v_anulado_por uuid;

  v_sqlstate text; v_mensagem text;
  v_tem_execute_anon boolean; v_tem_execute_auth boolean;
begin
  -- role vem de auth.users.raw_app_meta_data->>'role' NA CRIAÇÃO (trigger
  -- handle_new_user, 20260923120100_profiles.sql) — nunca por UPDATE depois:
  -- profiles_guard_privilegios (before update) exige is_gerente() pra
  -- qualquer UPDATE de role, e este script roda sem nenhuma impersonação
  -- ainda (auth.uid() null = não-gerente, bloquearia a própria fixture).
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.anula.gerente@teste.local', '', now(), now(), now(), '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Teste Anulação"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.anula.sdr@teste.local', '', now(), now(), now(), '{}'::jsonb, '{"nome":"SDR Teste Anulação"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste.anula.closer@teste.local', '', now(), now(), now(), '{}'::jsonb, '{"nome":"Closer Teste Anulação"}'::jsonb);
  -- sdr/closer nascem 'closer' (default da coluna) — basta não ser gerente pra provar o bloqueio de permissão.

  insert into public.funis (nome, padrao) values ('Teste Anulação', false) returning id into v_funil_id;
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo) values
    (v_funil_id, 'Fechado', 'verde', 100000, 'ganha') returning id into v_etapa_ganha;

  insert into public.clientes (tipo_cliente, nome, empresa, owner_id) values
    ('pessoa_fisica', 'Cliente Teste Anulação', 'Empresa Teste Anulação', v_gerente)
    returning id into v_cliente_id;
  insert into public.negociacoes (cliente_id, funil_id, etapa_id, owner_id) values
    (v_cliente_id, v_funil_id, v_etapa_ganha, v_gerente)
    returning id into v_neg_id;
  insert into public.fechamentos (negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado, status_pagamento, status_onboarding, tipo_venda, fechado_por)
    values (v_neg_id, 1000, '2026-10-01', true, true, 'pago', 'concluido', 'mrr', v_gerente);

  select etapa_id into v_etapa_id_antes from public.negociacoes where id = v_neg_id;
  select count(*) into v_hist_antes from public.historico_etapas where negociacao_id = v_neg_id;

  -- -------------------------------------------------------------------
  -- 2. SDR tentando anular -> bloqueado (42501).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  begin
    perform public.anular_fechamento(v_neg_id, 'tentativa indevida');
    raise exception 'FALHA: SDR conseguiu anular (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '42501', format('SDR: esperava 42501, veio % (%)', v_sqlstate, v_mensagem);
  end;

  -- -------------------------------------------------------------------
  -- 3. CLOSER tentando anular -> bloqueado (42501). Mesma role padrão do
  -- SDR (ambos nascem 'closer'), mas é um UUID diferente — prova que não é
  -- "o SDR especificamente", é "não-gerente" de forma geral.
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  begin
    perform public.anular_fechamento(v_neg_id, 'tentativa indevida');
    raise exception 'FALHA: CLOSER conseguiu anular (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '42501', format('CLOSER: esperava 42501, veio % (%)', v_sqlstate, v_mensagem);
  end;

  -- -------------------------------------------------------------------
  -- 4. GERENTE com motivo vazio -> bloqueado (23514).
  -- -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  begin
    perform public.anular_fechamento(v_neg_id, '   ');
    raise exception 'FALHA: motivo vazio foi aceito (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514', format('motivo vazio: esperava 23514, veio % (%)', v_sqlstate, v_mensagem);
  end;

  -- -------------------------------------------------------------------
  -- 5. GERENTE anulando de verdade -> sucesso.
  -- -------------------------------------------------------------------
  perform public.anular_fechamento(v_neg_id, 'teste: anulação válida');

  select valor_vendido, tipo_venda, data_fechamento, responsavel_id, anulado_em, motivo_anulacao, anulado_por
    into v_valor, v_tipo, v_data, v_resp_id, v_anulado_em, v_motivo, v_anulado_por
  from public.fechamentos where negociacao_id = v_neg_id;

  assert v_valor = 1000, format('valor_vendido mudou: %', v_valor);
  assert v_tipo = 'mrr', format('tipo_venda mudou: %', v_tipo);
  assert v_data = '2026-10-01', format('data_fechamento mudou: %', v_data);
  assert v_anulado_em is not null, 'anulado_em deveria estar preenchido';
  assert v_motivo = 'teste: anulação válida', format('motivo_anulacao errado: %', v_motivo);
  assert v_anulado_por = v_gerente, 'anulado_por deveria ser quem chamou (v_gerente), nunca current_user';

  -- -------------------------------------------------------------------
  -- 6. Linha permanece (não foi apagada); etapa/histórico intactos.
  -- -------------------------------------------------------------------
  assert exists (select 1 from public.fechamentos where negociacao_id = v_neg_id), 'linha de fechamentos foi apagada (não deveria)';
  select etapa_id into v_etapa_id_depois from public.negociacoes where id = v_neg_id;
  assert v_etapa_id_depois = v_etapa_id_antes, 'etapa_id da negociação mudou (não deveria)';
  select count(*) into v_hist_depois from public.historico_etapas where negociacao_id = v_neg_id;
  assert v_hist_depois = v_hist_antes, format('historico_etapas mudou: antes=%, depois=%', v_hist_antes, v_hist_depois);

  -- -------------------------------------------------------------------
  -- 7. Anular de novo -> bloqueado (23514, "já está anulado").
  -- -------------------------------------------------------------------
  begin
    perform public.anular_fechamento(v_neg_id, 'segunda tentativa');
    raise exception 'FALHA: anular duas vezes foi aceito (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514' and v_mensagem ilike '%já está anulado%',
      format('anular 2x: esperava 23514 "já está anulado", veio % (%)', v_sqlstate, v_mensagem);
  end;

  -- -------------------------------------------------------------------
  -- 8. atualizar_fechamento no anulado -> bloqueado (23514, "anulado").
  -- -------------------------------------------------------------------
  begin
    perform public.atualizar_fechamento(v_neg_id, 2000, '2026-10-02', true, true, 'pago', 'concluido');
    raise exception 'FALHA: atualizar_fechamento editou um fechamento anulado (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514' and v_mensagem ilike '%anulado%',
      format('atualizar_fechamento anulado: esperava 23514 "anulado", veio % (%)', v_sqlstate, v_mensagem);
  end;
  -- Confirma que realmente não mudou nada (a exceção não deixou passar parcialmente).
  select valor_vendido into v_valor from public.fechamentos where negociacao_id = v_neg_id;
  assert v_valor = 1000, format('valor_vendido foi alterado apesar do bloqueio: %', v_valor);

  -- -------------------------------------------------------------------
  -- 9. fechar_negociacao de novo (negociação já em ganha, fechamento
  -- anulado) -> bloqueado (23514, "anulado") ANTES de reescrever a linha.
  -- -------------------------------------------------------------------
  begin
    perform public.fechar_negociacao(v_neg_id, 1, 9999, '2026-10-05', true, true, 'pago', 'concluido');
    raise exception 'FALHA: fechar_negociacao sobrescreveu um fechamento anulado (deveria ter sido bloqueado)';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensagem = message_text;
    assert v_sqlstate = '23514' and v_mensagem ilike '%anulado%',
      format('fechar_negociacao sobre anulado: esperava 23514 "anulado", veio % (%)', v_sqlstate, v_mensagem);
  end;
  select valor_vendido, anulado_em into v_valor, v_anulado_em from public.fechamentos where negociacao_id = v_neg_id;
  assert v_valor = 1000 and v_anulado_em is not null, 'fechar_negociacao alterou/reativou o fechamento anulado apesar do bloqueio';

  -- -------------------------------------------------------------------
  -- 10. Grants: PUBLIC/anon SEM EXECUTE; authenticated COM EXECUTE.
  -- -------------------------------------------------------------------
  select has_function_privilege('anon', 'public.anular_fechamento(uuid, text)', 'EXECUTE') into v_tem_execute_anon;
  select has_function_privilege('authenticated', 'public.anular_fechamento(uuid, text)', 'EXECUTE') into v_tem_execute_auth;
  assert not v_tem_execute_anon, 'anon não deveria ter EXECUTE em anular_fechamento';
  assert v_tem_execute_auth, 'authenticated deveria ter EXECUTE em anular_fechamento';

  raise notice 'fechamentos_anulacao_test.sql: todas as asserções passaram.';
end;
$$;

set constraints all immediate;

rollback;
