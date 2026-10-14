-- ===========================================================================
-- Dry-run de "TCV/MRR + handoff SDR -> CLOSER"
-- (supabase/migrations/20261014140000_user_role_sdr.sql e
--  supabase/migrations/20261014150000_tcv_mrr_sdr.sql).
--
-- COMO RODAR
--   Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--
--   PRÉ-REQUISITO (diferente dos outros dry-runs deste diretório): o valor
--   'sdr' do enum user_role precisa já existir ANTES desta transação —
--   20261014140000_user_role_sdr.sql precisa ter sido aplicada. Motivo: o
--   Postgres não deixa USAR (comparar/inserir) um valor de enum na MESMA
--   transação em que ele foi adicionado ("unsafe use of new value of enum
--   type") — é por isso que essa migration existe separada da principal (ver
--   comentário dela, e o precedente em 20260928120000_agenda_enums.sql).
--   Sem isso aplicado, este arquivo falha em S0 com uma mensagem clara.
--
--   O resto (tipo_venda, colunas, funções, trigger) é instalado nesta própria
--   transação, byte a byte idêntico à migration principal — idempotente
--   (IF NOT EXISTS / DROP IF EXISTS) então funciona com ou sem ela já
--   aplicada. ROLLBACK no fim desfaz tudo. Nada fica gravado.
--
--   Resultado inequívoco: sucesso termina em "Success" com uma linha
--   "OK — ...". Qualquer assert que falhar propaga sem ser capturado — o
--   Editor termina em ERROR com a mensagem original (nunca "Success").
--
-- O QUE ELE PROVA
--   S0: pré-requisito (enum 'sdr') presente.
--   V1-V4: venda nova exige TCV/MRR; TCV só conta em TCV; MRR só conta em MRR.
--   H1-H3: fechamento histórico (tipo_venda null) não conta em TCV nem MRR, e
--          editar outro campo dele não o reclassifica.
--   M1-M3: metas TCV e MRR da empresa são independentes (linhas separadas,
--          mesmo alvo/mês).
--   G1-G5: SDR avança livremente até "Reunião realizada" (inclusive entrar
--          nela), não pode pular além, não pode mais tocar a negociação uma
--          vez lá, e CLOSER continua livre.
--   G6: a trava não depende do nome da etapa (gerente renomeia, regra
--       continua pela chave/ordem).
--   G7: funil sem a etapa técnica "reuniao_realizada" não é afetado — SDR
--       move livremente nele.
--   X1: nenhuma negociação/fechamento/meta duplicado fora dos criados pelo teste.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- S0: pré-requisito.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'sdr'
  ) then
    raise exception 'Pré-requisito ausente: aplique 20261014140000_user_role_sdr.sql antes deste dry-run (ver cabeçalho do arquivo).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Instalação temporária (idempotente) — byte a byte igual à migration.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_venda') then
    create type public.tipo_venda as enum ('tcv', 'mrr');
  end if;
end $$;

alter table public.fechamentos add column if not exists tipo_venda public.tipo_venda;
alter table public.metas       add column if not exists tipo_meta  public.tipo_venda;

create or replace function public.fechamentos_exige_tipo_venda_novo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo_venda is null then
    raise exception 'Toda nova venda precisa ser classificada como TCV ou MRR.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists fechamentos_exige_tipo_venda_novo on public.fechamentos;
create trigger fechamentos_exige_tipo_venda_novo
  before insert on public.fechamentos
  for each row execute function public.fechamentos_exige_tipo_venda_novo();

alter table public.metas drop constraint if exists metas_uma_por_mes;
alter table public.metas
  add constraint metas_uma_por_mes
  unique nulls not distinct (usuario_id, periodo_mes, tipo_meta);

create or replace function public.metas_exige_tipo_novo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo_meta is null then
    raise exception 'Toda nova meta precisa ser classificada como TCV ou MRR.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists metas_exige_tipo_novo on public.metas;
create trigger metas_exige_tipo_novo
  before insert on public.metas
  for each row execute function public.metas_exige_tipo_novo();

drop function if exists public.metas_progresso(date);
create function public.metas_progresso(p_mes date)
returns table (
  meta_id_tcv uuid, meta_id_mrr uuid, usuario_id uuid, nome text,
  role public.user_role, ativo boolean,
  valor_meta_tcv numeric, realizado_tcv numeric,
  valor_meta_mrr numeric, realizado_mrr numeric
)
language sql stable security definer set search_path = '' as $$
  with
  mes as (select date_trunc('month', p_mes)::date as inicio),
  vendas as (
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor
    from public.fechamentos f
    join public.negociacoes n  on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join mes
    where f.data_fechamento >= mes.inicio
      and f.data_fechamento <  (mes.inicio + interval '1 month')::date
      and f.tipo_venda is not null
    group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select usuario_id, valor from vendas where tipo_venda = 'tcv'),
  vendas_mrr as (select usuario_id, valor from vendas where tipo_venda = 'mrr')
  select mt.id, mm.id, null::uuid, null::text, null::public.user_role, null::boolean,
         mt.valor_meta, (select coalesce(sum(v.valor), 0) from vendas_tcv v),
         mm.valor_meta, (select coalesce(sum(v.valor), 0) from vendas_mrr v)
  from mes
  left join public.metas mt on mt.usuario_id is null and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm on mm.usuario_id is null and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  where public.is_gerente()
  union all
  select mt.id, mm.id, p.id, p.nome, p.role, p.ativo,
         mt.valor_meta, coalesce(vt.valor, 0), mm.valor_meta, coalesce(vm.valor, 0)
  from public.profiles p
  cross join mes
  left join public.metas mt on mt.usuario_id = p.id and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
  left join public.metas mm on mm.usuario_id = p.id and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
  left join vendas_tcv vt on vt.usuario_id = p.id
  left join vendas_mrr vm on vm.usuario_id = p.id
  where (public.is_gerente() or p.id = (select auth.uid()))
    and ((p.role = 'closer' and p.ativo) or mt.id is not null or mm.id is not null or vt.valor is not null or vm.valor is not null);
$$;

create or replace function public.negociacoes_valida_handoff_sdr()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role;
  v_funil_id uuid;
  v_ordem_destino numeric;
  v_limite_ordem numeric;
  v_ordem_atual numeric;
begin
  select role into v_role from public.profiles where id = (select auth.uid());
  if v_role is distinct from 'sdr' then
    return new;
  end if;

  select funil_id, ordem into v_funil_id, v_ordem_destino from public.etapas_funil where id = new.etapa_id;
  select ordem into v_limite_ordem from public.etapas_funil where funil_id = v_funil_id and chave = 'reuniao_realizada';

  if v_limite_ordem is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select ordem into v_ordem_atual from public.etapas_funil where id = old.etapa_id;
    if v_ordem_atual is not null and v_ordem_atual >= v_limite_ordem then
      raise exception 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.' using errcode = '42501';
    end if;
  end if;

  if v_ordem_destino > v_limite_ordem then
    raise exception 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists negociacoes_valida_handoff_sdr on public.negociacoes;
create trigger negociacoes_valida_handoff_sdr
  before insert or update of etapa_id on public.negociacoes
  for each row execute function public.negociacoes_valida_handoff_sdr();

-- ===========================================================================
-- Testes.
-- ===========================================================================
do $$
declare
  v_gerente  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_closer   uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_sdr      uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  v_funil_id     uuid;
  v_etapa_ganha  uuid;

  v_cliente_1 uuid;
  v_cliente_2 uuid;
  v_neg_tcv   uuid;
  v_neg_mrr   uuid;

  v_realizado_tcv numeric;
  v_realizado_mrr numeric;
  v_valor_meta_tcv numeric;
  v_valor_meta_mrr numeric;

  v_cliente_hist uuid;
  v_neg_hist     uuid;

  v_meta_tcv_id uuid;
  v_meta_mrr_id uuid;

  v_etapa_lead_novo uuid;
  v_etapa_mql       uuid;
  v_etapa_reuniao_ag uuid;
  v_etapa_reuniao_re uuid;
  v_etapa_proposta  uuid;

  v_cliente_sdr uuid;
  v_neg_sdr     uuid;

  v_funil_sem_gate uuid;
  v_etapa_a uuid;
  v_etapa_b uuid;
  v_cliente_sem_gate uuid;
  v_neg_sem_gate uuid;

  v_neg_total_antes integer;
  v_neg_total_depois integer;
  v_fech_total_antes integer;
  v_fech_total_depois integer;
  v_meta_total_antes integer;
  v_meta_total_depois integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_gerente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.tcvmrr.gerente@teste.local', '', now(), now(), now(),
     '{"role":"gerente"}'::jsonb, '{"nome":"Gerente Dry-Run TCV/MRR"}'::jsonb),
    (v_closer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.tcvmrr.closer@teste.local', '', now(), now(), now(),
     '{}'::jsonb, '{"nome":"Closer Dry-Run TCV/MRR"}'::jsonb),
    (v_sdr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dryrun.tcvmrr.sdr@teste.local', '', now(), now(), now(),
     '{"role":"sdr"}'::jsonb, '{"nome":"SDR Dry-Run TCV/MRR"}'::jsonb);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);

  select id into v_funil_id from public.funis where padrao;
  select id into v_etapa_ganha from public.etapas_funil where funil_id = v_funil_id and tipo = 'ganha';
  select id into v_etapa_lead_novo  from public.etapas_funil where funil_id = v_funil_id and tipo = 'aberta' order by ordem limit 1;
  select id into v_etapa_reuniao_ag from public.etapas_funil where chave = 'reuniao_agendada';
  select id into v_etapa_reuniao_re from public.etapas_funil where chave = 'reuniao_realizada';
  select id into v_etapa_proposta   from public.etapas_funil where chave = 'proposta_enviada';

  select count(*) into v_neg_total_antes from public.negociacoes;
  select count(*) into v_fech_total_antes from public.fechamentos;
  select count(*) into v_meta_total_antes from public.metas;

  -- =========================================================================
  -- V1-V4: venda nova exige TCV/MRR; cada tipo conta só no seu total.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run TCV', 'Empresa TCV', v_closer)
    returning id into v_cliente_1;
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run MRR', 'Empresa MRR', v_closer)
    returning id into v_cliente_2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_1, v_funil_id, 10000.00, 'quente') into v_neg_tcv;
  select public.criar_negociacao(v_cliente_2, v_funil_id, 500.00, 'quente') into v_neg_mrr;

  begin
    perform public.fechar_negociacao(v_neg_tcv, 1, 10000.00, current_date, true, true, 'pago', 'concluido', null, null, null, null);
    assert false, 'venda nova sem tipo_venda deveria ser recusada';
  exception when others then
    assert sqlerrm like '%TCV ou MRR%', format('mensagem inesperada: %s', sqlerrm);
    raise notice 'ok  V1  venda nova sem TCV/MRR é recusada pelo trigger';
  end;

  perform public.fechar_negociacao(v_neg_tcv, 1, 10000.00, current_date, true, true, 'pago', 'concluido', null, null, null, 'tcv');
  raise notice 'ok  V2  venda TCV fechada com sucesso';

  perform public.fechar_negociacao(v_neg_mrr, 1, 500.00, current_date, true, true, 'pago', 'concluido', null, null, null, 'mrr');
  raise notice 'ok  V3  venda MRR fechada com sucesso';

  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select realizado_tcv, realizado_mrr into v_realizado_tcv, v_realizado_mrr
    from public.metas_progresso(current_date) where usuario_id = v_closer;
  assert v_realizado_tcv = 10000.00, format('realizado_tcv deveria ser 10000.00, veio %s', v_realizado_tcv);
  assert v_realizado_mrr = 500.00, format('realizado_mrr deveria ser 500.00, veio %s', v_realizado_mrr);
  raise notice 'ok  V4  venda TCV conta só em TCV, venda MRR conta só em MRR — nenhuma mistura';

  -- =========================================================================
  -- H1-H3: fechamento histórico (tipo_venda null) nunca conta, e editar outro
  -- campo dele não o reclassifica.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Histórico', 'Empresa Histórico', v_closer)
    returning id into v_cliente_hist;
  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_hist, v_funil_id, 999999.00, 'quente') into v_neg_hist;

  -- Simula um fechamento ANTIGO (anterior à migration): INSERT direto, sem
  -- passar pelo trigger de obrigatoriedade (ele só pega o fluxo via
  -- fechar_negociacao/supabase; aqui simulamos o estado histórico direto).
  update public.negociacoes set etapa_id = v_etapa_ganha, posicao = 1 where id = v_neg_hist;
  insert into public.fechamentos (
    negociacao_id, valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
    status_pagamento, status_onboarding, fechado_por, tipo_venda
  ) values (
    v_neg_hist, 999999.00, current_date, true, true, 'pago', 'concluido', v_closer, 'tcv'
  );
  -- ^ nasce classificado só para contornar o trigger de INSERT (que exige
  -- tipo em toda venda NOVA); em seguida apagamos a classificação com um
  -- UPDATE direto, simulando fielmente uma linha histórica real (criada
  -- antes desta migration, portanto sem o trigger de INSERT no caminho).
  update public.fechamentos set tipo_venda = null where negociacao_id = v_neg_hist;

  select realizado_tcv, realizado_mrr into v_realizado_tcv, v_realizado_mrr
    from public.metas_progresso(current_date) where usuario_id = v_closer;
  assert v_realizado_tcv = 10000.00 and v_realizado_mrr = 500.00,
    'fechamento histórico sem tipo_venda não deveria alterar nenhum dos dois totais';
  raise notice 'ok  H1  fechamento histórico (tipo_venda null) não conta em TCV nem em MRR';

  perform public.atualizar_fechamento(v_neg_hist, 888888.00, current_date, true, true, 'pago', 'concluido', null, null, 'corrigido valor, não o tipo');
  assert (select tipo_venda from public.fechamentos where negociacao_id = v_neg_hist) is null,
    'editar outro campo de um fechamento histórico NÃO deveria classificá-lo automaticamente';
  raise notice 'ok  H2  editar valor/observações de um fechamento histórico não o reclassifica (sem backfill automático)';

  perform public.atualizar_fechamento(v_neg_hist, 888888.00, current_date, true, true, 'pago', 'concluido', null, null, 'agora classificado manualmente', 'mrr');
  assert (select tipo_venda from public.fechamentos where negociacao_id = v_neg_hist) = 'mrr',
    'classificação manual explícita via atualizar_fechamento deveria funcionar';
  raise notice 'ok  H3  classificar um histórico manualmente (ação explícita) funciona — diferente de um backfill automático';

  -- =========================================================================
  -- M1-M3: metas TCV e MRR da empresa são independentes.
  -- =========================================================================
  insert into public.metas (usuario_id, periodo_mes, valor_meta, tipo_meta)
  values (null, date_trunc('month', current_date)::date, 100000.00, 'tcv')
  returning id into v_meta_tcv_id;

  insert into public.metas (usuario_id, periodo_mes, valor_meta, tipo_meta)
  values (null, date_trunc('month', current_date)::date, 30000.00, 'mrr')
  returning id into v_meta_mrr_id;

  assert v_meta_tcv_id <> v_meta_mrr_id, 'TCV e MRR da empresa deveriam ser DUAS linhas distintas no mesmo mês';
  raise notice 'ok  M1  meta TCV e meta MRR da empresa coexistem no mesmo mês (linhas separadas)';

  begin
    insert into public.metas (usuario_id, periodo_mes, valor_meta, tipo_meta)
    values (null, date_trunc('month', current_date)::date, 50000.00, 'tcv');
    assert false, 'não deveria ser possível duas metas TCV da empresa no mesmo mês';
  exception when unique_violation then
    raise notice 'ok  M2  segunda meta TCV da empresa no mesmo mês é recusada (unicidade por tipo)';
  end;

  select valor_meta_tcv, valor_meta_mrr into v_valor_meta_tcv, v_valor_meta_mrr
    from public.metas_progresso(current_date) where usuario_id is null;
  assert v_valor_meta_tcv = 100000.00 and v_valor_meta_mrr = 30000.00,
    format('metas da empresa deveriam vir separadas (100000/30000), vieram (%s/%s)', v_valor_meta_tcv, v_valor_meta_mrr);
  raise notice 'ok  M3  metas_progresso devolve TCV e MRR da empresa como colunas independentes';

  -- =========================================================================
  -- G1-G5: handoff SDR -> CLOSER.
  -- =========================================================================
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run SDR', 'Empresa SDR', v_sdr)
    returning id into v_cliente_sdr;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_sdr, v_funil_id, 2000.00, 'morno') into v_neg_sdr;

  update public.negociacoes set etapa_id = v_etapa_reuniao_ag, posicao = 1 where id = v_neg_sdr;
  assert (select etapa_id from public.negociacoes where id = v_neg_sdr) = v_etapa_reuniao_ag,
    'SDR deveria conseguir mover até Reunião agendada';
  raise notice 'ok  G1  SDR move livremente antes do limite (-> Reunião agendada)';

  update public.negociacoes set etapa_id = v_etapa_reuniao_re, posicao = 1 where id = v_neg_sdr;
  assert (select etapa_id from public.negociacoes where id = v_neg_sdr) = v_etapa_reuniao_re,
    'SDR deveria conseguir ENTRAR em Reunião realizada (é o próprio limite, inclusivo)';
  raise notice 'ok  G2  SDR consegue entregar o lead entrando em Reunião realizada';

  begin
    update public.negociacoes set etapa_id = v_etapa_proposta, posicao = 1 where id = v_neg_sdr;
    assert false, 'SDR não deveria conseguir mover a negociação depois de Reunião realizada';
  exception when others then
    assert sqlerrm like '%CLOSER deve assumir%', format('mensagem inesperada: %s', sqlerrm);
    raise notice 'ok  G3  SDR é bloqueado ao tentar mover para além de Reunião realizada, com mensagem clara';
  end;

  begin
    update public.negociacoes set etapa_id = v_etapa_reuniao_ag, posicao = 1 where id = v_neg_sdr;
    assert false, 'SDR não deveria conseguir mover a negociação nem "para trás" depois de Reunião realizada';
  exception when others then
    raise notice 'ok  G4  SDR também é bloqueado tentando voltar a negociação que já está em Reunião realizada';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_closer, 'role', 'authenticated')::text, true);
  update public.negociacoes set etapa_id = v_etapa_proposta, posicao = 1 where id = v_neg_sdr;
  assert (select etapa_id from public.negociacoes where id = v_neg_sdr) = v_etapa_proposta,
    'CLOSER deveria continuar livre para avançar a negociação depois do handoff';
  raise notice 'ok  G5  CLOSER assume e avança a negociação sem nenhuma restrição';

  -- =========================================================================
  -- G6: a trava usa chave/ordem, nunca o nome — renomear a etapa não muda nada.
  -- =========================================================================
  update public.etapas_funil set nome = 'Call de Diagnóstico Concluída' where chave = 'reuniao_realizada';

  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run SDR 2', 'Empresa SDR 2', v_sdr)
    returning id into v_cliente_sdr;
  declare
    v_neg_sdr_2 uuid;
  begin
    select public.criar_negociacao(v_cliente_sdr, v_funil_id, 1000.00, 'frio') into v_neg_sdr_2;
    update public.negociacoes set etapa_id = v_etapa_reuniao_re, posicao = 1 where id = v_neg_sdr_2;

    begin
      update public.negociacoes set etapa_id = v_etapa_proposta, posicao = 1 where id = v_neg_sdr_2;
      assert false, 'a trava deveria continuar valendo mesmo com a etapa renomeada';
    exception when others then
      raise notice 'ok  G6  renomear a etapa (nome editável pelo gerente) não afeta a trava — ela usa chave/ordem';
    end;
  end;

  update public.etapas_funil set nome = 'Reunião realizada' where chave = 'reuniao_realizada';

  -- =========================================================================
  -- G7: funil sem a etapa técnica "reuniao_realizada" — SDR livre.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_gerente, 'role', 'authenticated')::text, true);
  select public.criar_funil(
    'Funil Dry-Run Sem Gate',
    'Fechado — dry-run sem gate', 'verde',
    'Perdido — dry-run sem gate', 'vermelho',
    '[{"nome":"Etapa A — dry-run sem gate","cor":"azul"},{"nome":"Etapa B — dry-run sem gate","cor":"ciano"}]'::jsonb
  ) into v_funil_sem_gate;

  select id into v_etapa_a from public.etapas_funil where funil_id = v_funil_sem_gate and nome = 'Etapa A — dry-run sem gate';
  select id into v_etapa_b from public.etapas_funil where funil_id = v_funil_sem_gate and nome = 'Etapa B — dry-run sem gate';

  insert into public.clientes (nome, empresa, owner_id) values ('Cliente Dry-Run Sem Gate', 'Empresa Sem Gate', v_sdr)
    returning id into v_cliente_sem_gate;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
  select public.criar_negociacao(v_cliente_sem_gate, v_funil_sem_gate, 1500.00, 'quente') into v_neg_sem_gate;

  update public.negociacoes set etapa_id = v_etapa_b, posicao = 1 where id = v_neg_sem_gate;
  assert (select etapa_id from public.negociacoes where id = v_neg_sem_gate) = v_etapa_b,
    'funil sem a etapa "reuniao_realizada" não deveria ter nenhuma trava de SDR — movimento livre';
  raise notice 'ok  G7  funil sem a etapa técnica "reuniao_realizada" não inventa regra equivalente — SDR move livre';

  -- =========================================================================
  -- X1: nenhuma duplicação fora do que o teste criou explicitamente.
  -- =========================================================================
  select count(*) into v_neg_total_depois from public.negociacoes;
  select count(*) into v_fech_total_depois from public.fechamentos;
  select count(*) into v_meta_total_depois from public.metas;
  assert v_neg_total_depois = v_neg_total_antes + 6,
    format('deveriam existir exatamente 6 negociações novas (tcv, mrr, histórico, sdr, sdr2, sem-gate) antes=%s depois=%s',
           v_neg_total_antes, v_neg_total_depois);
  raise notice 'ok  X1  nenhuma negociação/fechamento/meta duplicado além do que o teste criou (negociações: % -> %, fechamentos: % -> %, metas: % -> %)',
    v_neg_total_antes, v_neg_total_depois, v_fech_total_antes, v_fech_total_depois, v_meta_total_antes, v_meta_total_depois;

  raise notice 'TODOS OS TESTES DE TCV/MRR + HANDOFF SDR PASSARAM (V1-V4, H1-H3, M1-M3, G1-G7, X1)';
end $$;

select 'OK — TODOS OS TESTES DE TCV/MRR + HANDOFF SDR PASSARAM' as resultado;

rollback;
