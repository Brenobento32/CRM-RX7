set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: venda fechada na CAPI (migration 20261113090100, sobre a trava 20261112090000).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK. Nada sai para a Meta:
-- só a fila do banco é exercitada (capi_reservar), sem Edge Function.
--
--  V1  venda fechada vira UM evento na etapa de fechamento, com o lead da Meta e o horário real
--  V2  sem regra comercial aprovada: nenhum valor sai (mesmo com "Enviar o valor" marcado)
--  V3  com aprovação por modalidade: TCV = contrato total, Venda comum = venda; MRR só se aprovado
--      e como UMA mensalidade; BRL só quando há valor; "Enviar o valor" desmarcado = sem valor
--  V4  sem duplicata; venda anulada antes do envio nunca sai
--  V5  nada retroativo: venda com o envio pausado não gera evento depois
--  V6  sem ID do lead da Meta: nunca sai; e-mail/telefone não vão sem o hash ligado
--  V7  isolamento: cada evento só no dataset da própria empresa
--  V8  a trava continua barrando tudo (Rio X7 travada pela 20261112090000)
--  V9  permissões das funções novas
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

do $lim$
begin
  if to_regclass('public.empresa_limites') is not null then
    execute $x$insert into public.empresa_limites (tenant_id, recurso, limite, motivo)
             select t.id, r, 100, 'ambiente local de teste' from public.tenants t cross join unnest(array['fontes', 'numeros_whatsapp', 'funis']) r
              where t.tipo = 'assinante' on conflict (tenant_id, recurso) do nothing$x$;
  end if;
end;
$lim$;

create function public._como(p_uid uuid, p_slug text)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', 's1')::text, true);
  perform set_config('request.headers', case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._como(uuid, text) to authenticated, service_role, anon;
create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated, service_role, anon;
create function public._recusa(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'aceito';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function public._recusa(text) to authenticated, service_role, anon;
create function public._servico()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.headers', '{}', true);
  perform set_config('role', 'service_role', true);
end;
$$;
grant execute on function public._servico() to authenticated, service_role, anon;

-- Lead com ID de Lead Ads (como o meta-webhooks grava), na etapa inicial do funil padrão.
create function public._lead_meta(p_tenant uuid, p_dono uuid, p_tel text, p_leadgen text)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid; v_e uuid;
begin
  select e.id into v_e from public.etapas_funil e join public.funis f on f.id = e.funil_id where f.tenant_id = p_tenant and f.padrao and e.etapa_inicial;
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, email, owner_id)
  values (p_tenant, 'pessoa_fisica', 'Lead ' || p_tel, p_tel, 'lead' || p_tel || '@exemplo.test', p_dono) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, v_e, 'formulario', 'venda-' || p_tel,
          case when p_leadgen is null then '{"source":"manual"}'::jsonb else jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', p_leadgen) end)
  returning id into v_neg;
  return v_neg;
end;
$$;

-- Fechamento pela função oficial, como o Administrador da empresa.
create function public._fechar(p_neg uuid, p_uid uuid, p_slug text, p_valor numeric, p_tipo public.tipo_venda)
returns void language plpgsql as $$
begin
  perform public._como(p_uid, p_slug);
  perform public.fechar_negociacao(p_neg, 1000, p_valor, current_date, true, true, 'pendente', 'nao_iniciado', null, null, null, p_tipo);
  perform public._como(null, null);
end;
$$;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  clo_a uuid := '60000000-0000-4000-8000-0000000000a2';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  sup   uuid := '60000000-0000-4000-8000-0000000000ff';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  t_rio uuid := 'a0000000-0000-4000-8000-000000000002';
  ds_a  text := '800000000000001';
  ds_b  text := '800000000000002';
  fa1 uuid; ea1 uuid; ea_ganha uuid; fb1 uuid; eb1 uuid; eb_ganha uuid;
  v_con_a uuid; v_con_b uuid;
  n_tcv uuid; n_mrr uuid; n_venda uuid; n_anul uuid; n_hist uuid; n_sem uuid; n_b uuid; n_trava uuid;
  v_ev public.meta_conversoes_eventos; v_r text; v_n integer; p_business uuid;
begin
  perform public._como(null, null);
  update public.plataforma_integracoes set meta_conversoes = true;
  delete from public.meta_conversoes_conexoes where tenant_id in (t_a, t_b);
  select id into p_business from public.planos where codigo = 'business';
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where id = p_business and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_a, p_business, 'ativa'), (t_b, p_business, 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_ganha from public.etapas_funil where funil_id = fa1 and tipo = 'ganha';
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;
  select id into eb_ganha from public.etapas_funil where funil_id = fb1 and tipo = 'ganha';

  perform public._servico();
  v_con_a := public.capi_salvar_conexao(t_a, g_a, '700000000000001', ds_a, 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx');
  v_con_b := public.capi_salvar_conexao(t_b, g_b, '700000000000002', ds_b, 'Dataset B', 'token-sistema-beta-xxxxxxxxxx');
  -- A: fechamento com "Enviar o valor" marcado. B: fechamento SEM o valor.
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_definir_configuracao(array[fa1]::uuid[], jsonb_build_array(
    jsonb_build_object('etapa_id', ea1, 'evento', 'Lead recebido'),
    jsonb_build_object('etapa_id', ea_ganha, 'evento', 'Venda fechada', 'enviar_valor', true)), false);
  perform public.capi_acao('ativar');
  perform public._como(g_b, 'teste-beta');
  perform public.capi_definir_configuracao(array[fb1]::uuid[], jsonb_build_array(
    jsonb_build_object('etapa_id', eb_ganha, 'evento', 'Venda fechada', 'enviar_valor', false)), false);
  perform public.capi_acao('ativar');
  perform public._como(null, null);
  perform public._ok((select meta_conversoes_valor_modalidades = '{}' from public.plataforma_integracoes), 'V0 regra comercial do valor: nenhuma modalidade aprovada por padrão');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(public.capi_valor_modalidades() = '{}'::text[], 'V0 ...e a tela do Administrador mostra isso');
  perform public._como(null, null);

  -- ================================================================= V1 venda fechada vira UM evento
  n_tcv := public._lead_meta(t_a, g_a, '5511981000001', '111111111111111');
  perform public._fechar(n_tcv, g_a, 'teste-alfa', 2500.00, 'tcv');
  select * into v_ev from public.meta_conversoes_eventos where negociacao_id = n_tcv and etapa_id = ea_ganha;
  perform public._ok(v_ev.situacao = 'pendente' and v_ev.evento = 'Venda fechada' and v_ev.lead_id = '111111111111111' and v_ev.conexao_id = v_con_a
                     and v_ev.event_id = 'avante-' || n_tcv || '-' || ea_ganha, 'V1 venda fechada: evento "Venda fechada" com o lead da Meta e event_id estável');
  perform public._ok(v_ev.event_time = (select fechado_em from public.fechamentos where negociacao_id = n_tcv)
                     and v_ev.event_time = (select max(created_at) from public.historico_etapas where negociacao_id = n_tcv and etapa_nova_id = ea_ganha),
                     'V1 ...horário real: o momento do fechamento (mudança para a etapa de fechamento)');

  -- ================================================================= V2 sem regra aprovada: sem valor
  perform public._servico();
  select count(*) into v_n from public.capi_reservar(200) r where r.event_id = v_ev.event_id and r.valor is null and r.moeda is null;
  perform public._ok(v_n = 1, 'V2 sem regra comercial aprovada: o evento sai SEM valor e sem moeda');
  perform public._como(null, null);
  update public.meta_conversoes_eventos set situacao = 'pendente', bloqueado_ate = null where id = v_ev.id;

  -- ================================================================= V3 valor por modalidade aprovada
  update public.plataforma_integracoes set meta_conversoes_valor_modalidades = array['tcv', 'venda']::public.tipo_venda[];
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'plataforma_integracoes_alterada'
                               and detalhes -> 'depois' ->> 'meta_conversoes_valor_modalidades' is not null), 'V3 aprovar a regra fica auditado');
  n_mrr := public._lead_meta(t_a, g_a, '5511981000002', '222222222222222');
  perform public._fechar(n_mrr, g_a, 'teste-alfa', 900.00, 'mrr');
  n_venda := public._lead_meta(t_a, g_a, '5511981000003', '333333333333333');
  perform public._fechar(n_venda, g_a, 'teste-alfa', 480.00, 'venda');
  n_b := public._lead_meta(t_b, g_b, '5511981000004', '444444444444444');
  perform public._fechar(n_b, g_b, 'teste-beta', 300.00, 'venda');
  perform public._como(null, null);
  create temp table _lote on commit drop as select * from public.capi_reservar(200);
  perform public._ok((select valor = 2500.00 and moeda = 'BRL' from _lote where event_id = 'avante-' || n_tcv || '-' || ea_ganha),
                     'V3 TCV aprovado: valor total do contrato, em BRL');
  perform public._ok((select valor = 480.00 and moeda = 'BRL' from _lote where event_id = 'avante-' || n_venda || '-' || ea_ganha),
                     'V3 Venda comum aprovada: valor da venda, em BRL');
  perform public._ok((select valor is null and moeda is null from _lote where event_id = 'avante-' || n_mrr || '-' || ea_ganha),
                     'V3 MRR não aprovado: sem valor');
  perform public._ok((select valor is null and moeda is null and dataset_id = ds_b from _lote where event_id = 'avante-' || n_b || '-' || eb_ganha),
                     'V3 empresa com "Enviar o valor" desmarcado: sem valor, mesmo aprovado');
  perform public._ok(not exists (select 1 from _lote where email is not null or telefone is not null), 'V6 sem o hash ligado: e-mail e telefone não vão');
  perform public._ok((select bool_and((tenant_id = t_a and dataset_id = ds_a) or (tenant_id = t_b and dataset_id = ds_b)) from _lote),
                     'V7 cada evento só no dataset da própria empresa');
  perform public._como(null, null);
  update public.plataforma_integracoes set meta_conversoes_valor_modalidades = array['mrr']::public.tipo_venda[];
  update public.meta_conversoes_eventos set situacao = 'pendente', bloqueado_ate = null where negociacao_id = n_mrr;
  perform public._servico();
  perform public._ok((select valor = 900.00 and moeda = 'BRL' from public.capi_reservar(200) where event_id = 'avante-' || n_mrr || '-' || ea_ganha),
                     'V3 MRR aprovado: UMA mensalidade (900), nunca multiplicada');
  perform public._como(null, null);
  update public.plataforma_integracoes set meta_conversoes_valor_modalidades = array['tcv', 'mrr', 'venda']::public.tipo_venda[];
  update public.fechamentos set tipo_venda = null where negociacao_id = n_venda;
  perform public._ok(public.capi_valor_da_venda(n_venda) is null, 'V3 venda "não classificada" (sem modalidade): nunca leva valor');

  -- ================================================================= V4 sem duplicata; anulada nunca sai
  v_r := public._recusa(format($q$select public._fechar(%L, %L, 'teste-alfa', 2600.00, 'tcv')$q$, n_tcv, g_a));
  perform public._como(null, null);
  perform public._ok((select count(*) from public.meta_conversoes_eventos where negociacao_id = n_tcv and etapa_id = ea_ganha) = 1,
                     'V4 a mesma venda nunca gera um segundo evento');
  n_anul := public._lead_meta(t_a, g_a, '5511981000005', '555555555555555');
  perform public._fechar(n_anul, g_a, 'teste-alfa', 1200.00, 'tcv');
  perform public._como(g_a, 'teste-alfa');
  perform public.anular_fechamento(n_anul, 'teste local de anulação');
  perform public._servico();
  perform public._ok(not exists (select 1 from public.capi_reservar(200) where event_id = 'avante-' || n_anul || '-' || ea_ganha), 'V4 venda anulada antes do envio: não sai');
  perform public._como(null, null);
  perform public._ok((select situacao = 'rejeitado' and ultimo_erro like 'Venda anulada%' from public.meta_conversoes_eventos where negociacao_id = n_anul and etapa_id = ea_ganha),
                     'V4 ...fica rejeitada, com o motivo');

  -- ================================================================= V5 nada retroativo
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_acao('pausar');
  perform public._como(null, null);
  n_hist := public._lead_meta(t_a, g_a, '5511981000006', '666666666666666');
  perform public._fechar(n_hist, g_a, 'teste-alfa', 700.00, 'tcv');
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_acao('retomar');
  perform public._servico();
  perform public._ok(not exists (select 1 from public.capi_reservar(200) where event_id like 'avante-' || n_hist || '-%')
                     and not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_hist),
                     'V5 venda fechada com o envio pausado: nenhum evento depois (nada retroativo)');
  perform public._como(null, null);

  -- ================================================================= V6 sem lead da Meta
  n_sem := public._lead_meta(t_a, g_a, '5511981000007', null);
  perform public._fechar(n_sem, g_a, 'teste-alfa', 800.00, 'tcv');
  perform public._servico();
  perform public._ok(not exists (select 1 from public.capi_reservar(200) where event_id = 'avante-' || n_sem || '-' || ea_ganha), 'V6 venda sem ID do lead da Meta: não sai');
  perform public._como(null, null);
  perform public._ok((select situacao = 'sem_correspondencia' from public.meta_conversoes_eventos where negociacao_id = n_sem and etapa_id = ea_ganha),
                     'V6 ...fica "sem correspondência" (sem atribuição inventada)');

  -- ================================================================= V8 a trava continua valendo
  perform public._ok(public.capi_travada(t_rio), 'V8 Rio X7 continua travada');
  perform public._como(sup, null);
  perform public.admin_capi_travar(t_a, 'Trava de teste da venda fechada');
  perform public._como(null, null);
  update public.meta_conversoes_conexoes set situacao = 'ativa' where id = v_con_a;
  n_trava := public._lead_meta(t_a, g_a, '5511981000008', '777777777777777');
  perform public._fechar(n_trava, g_a, 'teste-alfa', 990.00, 'tcv');
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_trava), 'V8 empresa travada: venda fechada não gera evento');
  update public.meta_conversoes_eventos set situacao = 'pendente', bloqueado_ate = null where negociacao_id = n_tcv;
  perform public._servico();
  perform public._ok(not exists (select 1 from public.capi_reservar(200) where tenant_id = t_a), 'V8 ...e nenhum evento dela é reservado');
  perform public._como(null, null);

  -- ================================================================= V9 permissões
  perform public._como(clo_a, 'teste-alfa');
  v_r := public._recusa('select public.capi_valor_modalidades()');
  perform public._ok(v_r like '42501:%', 'V9 Closer não lê a regra do valor (só o Administrador)');
  v_r := public._recusa(format('select public.capi_valor_da_venda(%L)', n_tcv));
  perform public._ok(v_r like '42501:%', 'V9 valor da venda só pelo servidor');
  v_r := public._recusa($q$update public.plataforma_integracoes set meta_conversoes_valor_modalidades = array['tcv']::public.tipo_venda[]$q$);
  perform public._ok(v_r like '42501:%', 'V9 usuário não aprova a regra comercial');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa($q$update public.plataforma_integracoes set meta_conversoes_valor_modalidades = array['tcv']::public.tipo_venda[]$q$);
  perform public._ok(v_r like '42501:%', 'V9 ...nem o Administrador da empresa');
  perform public._como(null, null);
end;
$$;

rollback;
