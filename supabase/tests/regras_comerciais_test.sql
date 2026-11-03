set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: regras comerciais por empresa, Venda comum, ciclo de vida das empresas
-- e mapeamento da Conversions API (migrations 20261109090000 e 20261109090100).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  P  preservação: empresas existentes continuam "agência" (TCV/MRR e itens obrigatórios)
--  G  empresa genérica: Venda comum, fechamento sem itens de agência; TCV recusado
--  A  agência: itens exigidos; "confirmar" exige Sim; item oculto não é apagado ao editar
--  M  metas: menu desligado barra metas e metas de reuniões; tipo não liberado recusado
--  V  progresso/realizado: Venda comum separada, sem somar a TCV/MRR
--  S  segurança: só Super Admin configura; empresa lê só as próprias regras; auditoria
--  E  empresas: arquivar, reativar e excluir (só vazia, inativa, com endereço digitado)
--  C  Conversions API: venda só na etapa ganha; sugestão pelas etapas da empresa
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

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
grant execute on function public._como(uuid, text) to authenticated, service_role;
create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated, service_role;
create function public._recusa(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'aceito';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function public._recusa(text) to authenticated, service_role;

do $$
declare
  sa   uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a  uuid := '60000000-0000-4000-8000-0000000000a1';
  c_a  uuid := '60000000-0000-4000-8000-0000000000a2';
  sdr  uuid := '60000000-0000-4000-8000-0000000000a3';
  g_b  uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a  uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b  uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  t_g  uuid;
  t_rio uuid;
  ea uuid; eb uuid; ea_ganha uuid; eb_ganha uuid; ea_real uuid; fa uuid;
  v_cli uuid; n1 uuid; n2 uuid; n3 uuid; nb uuid;
  v_r text; v_j jsonb; v_n integer; v_mes date := date_trunc('month', current_date)::date;
begin
  perform public._como(null, null);
  select id into t_g from public.tenants where slug = 'gama-nova';
  select id into t_rio from public.tenants where slug = 'rio-x7';
  select id into fa from public.funis where tenant_id = t_a and padrao;
  select id into ea from public.etapas_funil where funil_id = fa and etapa_inicial;
  select id into ea_ganha from public.etapas_funil where funil_id = fa and tipo = 'ganha';
  select id into ea_real from public.etapas_funil where funil_id = fa and chave = 'reuniao_realizada';
  select e.id into eb from public.etapas_funil e join public.funis f on f.id = e.funil_id where f.tenant_id = t_b and f.padrao and e.etapa_inicial;
  select e.id into eb_ganha from public.etapas_funil e join public.funis f on f.id = e.funil_id where f.tenant_id = t_b and f.padrao and e.tipo = 'ganha';

  -- ================================================================= P. preservação
  perform public._ok((select count(*) from public.tenants) = (select count(*) from public.empresa_regras_comerciais),
                     'P1 toda empresa existente ganhou regras explícitas');
  perform public._ok((select perfil = 'agencia' and tipos_venda = array['tcv', 'mrr']::public.tipo_venda[] and metas_ativo
                        from public.empresa_regras_comerciais where tenant_id = t_a), 'P2 ...com o comportamento de antes (agência, TCV/MRR, Metas ligado)');
  perform public._ok((select (public.regras_comerciais_da_empresa(t_a) -> 'campos' ->> 'contrato_enviado') = 'obrigatorio'
                         and (public.regras_comerciais_da_empresa(t_a) -> 'campos' ->> 'status_onboarding') = 'obrigatorio'),
                     'P3 ...itens de agência continuam obrigatórios');
  perform public._ok((select (public.regras_comerciais_da_empresa(gen_random_uuid()) ->> 'perfil') = 'generico'),
                     'P4 empresa sem regras = genérica (não presume agência)');

  -- ================================================================= S. segurança e configuração
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.admin_definir_regras_comerciais(%L, 'generico', true, array['venda'], '{}', 'tentativa')$q$, t_a));
  perform public._ok(v_r like '42501:%', 'S1 Administrador da empresa não configura as regras');
  v_r := public._recusa(format($q$select public.regras_comerciais_da_empresa(%L)$q$, t_b));
  perform public._ok(v_r like '42501:%', 'S2 empresa não lê as regras de outra empresa');
  perform public._ok((public.minhas_regras_comerciais() ->> 'perfil') = 'agencia', 'S3 empresa lê as próprias regras');
  perform public._como(sa, null);
  v_r := public._recusa(format($q$select public.admin_definir_regras_comerciais(%L, 'generico', true, array['tcv'], '{"contrato_assinado":"obrigatorio"}', 'teste')$q$, t_b));
  perform public._ok(v_r like '22023:%contrato enviado%', 'S4 regra incoerente recusada (assinado sem enviado)');
  v_r := public._recusa(format($q$select public.admin_definir_regras_comerciais(%L, 'generico', true, array['tcv'], '{"status_pagamento":"confirmar"}', 'teste')$q$, t_b));
  perform public._ok(v_r like '22023:%', 'S5 "confirmar" só vale para contrato');
  perform public.admin_definir_regras_comerciais(t_b, 'generico', true, array['venda'], '{}', 'Empresa de varejo: venda comum');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'regras_comerciais_definidas' and tenant_id = t_b and ator_id = sa
                              and detalhes ->> 'motivo' = 'Empresa de varejo: venda comum'), 'S6 alteração auditada com o Super Admin e o motivo');
  perform public._como(sa, null);
  perform public._ok((public.admin_regras_comerciais(t_a) ->> 'perfil') = 'agencia' and (public.admin_regras_comerciais(t_b) ->> 'perfil') = 'generico',
                     'S7 duas empresas com regras diferentes, cada uma isolada');

  -- ================================================================= G. empresa genérica (teste-beta)
  perform public._como(null, null);
  insert into public.clientes (tenant_id, tipo_cliente, nome, owner_id) values (t_b, 'pessoa_fisica', 'Cliente B', g_b) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_b, v_cli, eb, 'manual', 'p9-b1') returning id into nb;
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 500, current_date, null, null, null, null, null, null, null, 'tcv')$q$, nb));
  perform public._ok(v_r like '23514:%TCV%não está liberado%', 'G1 genérica: TCV recusado no banco');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 500, current_date, null, null, null, null, null, null, null, 'venda')$q$, nb));
  perform public._ok(v_r = 'aceito', 'G2 genérica: Venda comum fecha sem contrato, pagamento nem onboarding');
  perform public._ok((select contrato_enviado is null and status_onboarding is null and tipo_venda = 'venda' from public.fechamentos where negociacao_id = nb),
                     'G3 ...itens de agência gravados como "não se aplica"');

  -- ================================================================= A. agência (teste-alfa)
  perform public._como(null, null);
  insert into public.clientes (tenant_id, tipo_cliente, nome, owner_id) values (t_a, 'pessoa_fisica', 'Cliente A1', c_a) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, ea, 'manual', 'p9-a1') returning id into n1;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, ea, 'manual', 'p9-a2') returning id into n2;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, ea, 'manual', 'p9-a3') returning id into n3;
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 1200, current_date, null, false, 'pago', 'concluido', null, null, null, 'tcv')$q$, n1));
  perform public._ok(v_r like '23514:%Contrato enviado%', 'A1 agência: sem "contrato enviado" é recusado (como antes)');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 1200, current_date, true, false, 'pago', 'concluido', null, null, null, 'venda')$q$, n1));
  perform public._ok(v_r like '23514:%Venda comum%', 'A2 agência sem Venda comum liberada: recusado');
  perform public.fechar_negociacao(n1, 1000, 1200, current_date, true, false, 'pago', 'concluido', null, null, null, 'tcv');
  perform public._ok(exists (select 1 from public.fechamentos where negociacao_id = n1 and contrato_enviado), 'A3 agência: fechamento completo aceito');
  perform public._como(sa, null);
  perform public.admin_definir_regras_comerciais(t_a, 'agencia', true, array['tcv', 'mrr', 'venda'], '{"contrato_assinado":"confirmar"}', 'Agência exige contrato assinado');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 300, current_date, true, false, 'pago', 'concluido', null, null, null, 'mrr')$q$, n2));
  perform public._ok(v_r like '23514:%Confirme "Contrato assinado"%', 'A4 "confirmar": contrato assinado = Não é recusado');
  perform public.fechar_negociacao(n2, 1000, 300, current_date, true, true, 'pago', 'concluido', null, null, null, 'mrr');
  perform public.fechar_negociacao(n3, 1000, 450, current_date, true, true, 'pago', 'concluido', null, null, null, 'venda');
  perform public._ok((select count(*) from public.fechamentos where negociacao_id in (n2, n3)) = 2, 'A5 ...com Sim, MRR e Venda comum fecham na mesma empresa');
  -- empresa passa a genérica: editar o fechamento antigo sem os campos ocultos não apaga nada
  perform public._como(sa, null);
  perform public.admin_definir_regras_comerciais(t_a, 'generico', true, array['tcv', 'mrr', 'venda'], '{}', 'Passou a vender como varejo');
  perform public._como(g_a, 'teste-alfa');
  -- pagamento é visível (opcional) no genérico: a tela manda o valor atual; só os ocultos vêm vazios.
  perform public.atualizar_fechamento(n1, 1300, current_date, null, null, 'pago', null, null, null, null, null);
  perform public._ok((select valor_vendido = 1300 and contrato_enviado and contrato_assinado is false and status_pagamento = 'pago' and status_onboarding = 'concluido'
                        and tipo_venda = 'tcv' from public.fechamentos where negociacao_id = n1),
                     'A6 item oculto não é apagado ao editar (dados de agência preservados)');
  perform public._como(sa, null);
  perform public.admin_definir_regras_comerciais(t_a, 'agencia', true, array['tcv', 'mrr', 'venda'], '{}', 'Volta a agência');

  -- ================================================================= V. progresso separado
  perform public._como(g_a, 'teste-alfa');
  select * into v_j from (select to_jsonb(p) j from public.metas_progresso(v_mes) p where p.usuario_id is null) x;
  perform public._ok((v_j ->> 'realizado_venda')::numeric >= 450 and (v_j ->> 'qtd_venda')::integer >= 1, 'V1 Venda comum no progresso: faturamento e quantidade');
  perform public._ok((v_j ->> 'realizado_tcv')::numeric >= 1300 and (v_j ->> 'realizado_mrr')::numeric >= 300
                     and (select sum(valor_vendido) from public.fechamentos where negociacao_id in (n1, n2, n3)) = 1300 + 300 + 450,
                     'V2 TCV, MRR e Venda comum em totais separados (cada fechamento uma vez)');
  perform public._ok((select realizado_venda >= 450 from public.realizado_periodo(v_mes, current_date) where usuario_id is null),
                     'V3 realizado do período também separa Venda comum');
  perform public._ok((select count(*) from public.metas_funis_progresso(v_mes) where funil_id = fa and realizado_venda >= 450) = 1,
                     'V4 meta por funil também separa Venda comum');

  -- ================================================================= M. metas
  perform public.salvar_metas_funis(v_mes, jsonb_build_array(jsonb_build_object('funil_id', fa, 'tipo_meta', 'venda', 'valor_meta', 1000)));
  perform public._ok(exists (select 1 from public.metas where tenant_id = t_a and funil_id = fa and tipo_meta = 'venda'), 'M1 meta de Venda comum por funil');
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa(format($q$insert into public.metas (tenant_id, usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta) values (%L, null, null, %L, 'tcv', 100)$q$, t_b, v_mes));
  perform public._ok(v_r like '23514:%TCV%', 'M2 tipo de meta não liberado para a empresa: recusado');
  insert into public.metas (tenant_id, usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta) values (t_b, null, null, v_mes, 'venda', 900);
  perform public._como(sa, null);
  perform public.admin_definir_regras_comerciais(t_b, 'generico', false, array['venda'], '{}', 'Cliente não usa metas');
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa(format($q$update public.metas set valor_meta = 950 where tenant_id = %L and tipo_meta = 'venda'$q$, t_b));
  perform public._ok(v_r like '42501:%Metas está desativado%', 'M3 menu Metas desligado: meta não muda nem pela API');
  perform public._ok((select valor_meta = 900 from public.metas where tenant_id = t_b and tipo_meta = 'venda'), 'M4 ...e a meta existente fica preservada');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) from public.metas where tenant_id = t_a and tipo_meta = 'venda') = 1, 'M5 outra empresa continua com Metas ligado');
  perform public._como(sa, null);
  perform public.admin_definir_regras_comerciais(t_a, 'agencia', true, array['mrr'], '{}', 'Só MRR daqui em diante');
  perform public._como(g_a, 'teste-alfa');
  update public.metas set valor_meta = 1100 where tenant_id = t_a and tipo_meta = 'venda';
  perform public._ok((select valor_meta = 1100 from public.metas where tenant_id = t_a and tipo_meta = 'venda'),
                     'M6 meta antiga de tipo retirado continua editável (histórico preservado)');

  -- ================================================================= E. empresas
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.admin_arquivar_empresa(%L, 'teste')$q$, t_b));
  perform public._ok(v_r like '42501:%', 'E1 só o Super Admin arquiva');
  perform public._como(sa, null);
  v_r := public._recusa(format($q$select public.admin_arquivar_empresa(%L, 'teste')$q$, t_rio));
  perform public._ok(v_r like '22023:%interna%', 'E2 empresa interna protegida contra arquivamento');
  v_r := public._recusa(format($q$select public.admin_excluir_empresa(%L, 'rio-x7', 'teste')$q$, t_rio));
  perform public._ok(v_r like '22023:%nunca são excluídas%', 'E3 empresa interna nunca é excluída');
  perform public.admin_arquivar_empresa(t_b, 'Encerrou o contrato');
  perform public._como(null, null);
  perform public._ok((select status = 'cancelado' and somente_leitura from public.tenants where id = t_b)
                     and (select count(*) from public.fechamentos where tenant_id = t_b) = 1, 'E4 arquivada: somente leitura, dados preservados');
  perform public._ok((select status <> 'cancelado' from public.tenants where id = t_a), 'E5 ...sem afetar outra empresa');
  perform public._como(sa, null);
  v_r := public._recusa(format($q$select public.admin_excluir_empresa(%L, 'teste-beta', 'teste')$q$, t_b));
  perform public._ok(v_r like '23503:%tem dados%', 'E6 empresa com dados comerciais não é excluída');
  perform public.admin_reativar_empresa(t_b, 'Voltou');
  perform public._como(null, null);
  perform public._ok((select status in ('ativo', 'teste') from public.tenants where id = t_b), 'E7 reativada volta com tudo');
  perform public._como(sa, null);
  v_r := public._recusa(format($q$select public.admin_excluir_empresa(%L, 'gama-nova', 'teste')$q$, t_g));
  perform public._ok(v_r like '22023:%Desative%', 'E8 exclusão exige empresa inativa antes');
  perform public.admin_suspender_empresa(t_g, 'Cadastro abandonado');
  v_r := public._recusa(format($q$select public.admin_excluir_empresa(%L, 'gama', 'teste')$q$, t_g));
  perform public._ok(v_r like '22023:%digite exatamente%', 'E9 exige o endereço exato como confirmação');
  perform public._ok((public.admin_exclusao_empresa_situacao(t_g) -> 'bloqueios') = '[]'::jsonb, 'E10 situação: cadastro vazio, sem bloqueios');
  perform public._como(null, null);
  -- Exceções da Central (cota e integração): os gatilhos delas auditam a remoção.
  insert into public.empresa_limites (tenant_id, recurso, limite, motivo) values (t_g, 'funis', 3, 'teste')
    on conflict do nothing;
  insert into public.empresa_integracoes_regras (tenant_id, integracao, regra, motivo) values (t_g, 'formularios', 'bloquear', 'teste')
    on conflict do nothing;
  select count(*) into v_n from public.admin_auditoria where tenant_id = t_g;
  perform public._como(sa, null);
  perform public.admin_excluir_empresa(t_g, 'gama-nova', 'Cadastro de teste abandonado');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.tenants where id = t_g) and not exists (select 1 from public.etapas_funil where tenant_id = t_g),
                     'E11 cadastro vazio excluído com funil, etapas e vínculos');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'empresa_excluida' and detalhes ->> 'empresa_slug' = 'gama-nova' and ator_id = sa)
                     and (select count(*) from public.admin_auditoria where detalhes -> 'empresa_excluida' ->> 'slug' = 'gama-nova') >= v_n,
                     'E12 auditoria preservada (histórico da empresa e a exclusão)');
  perform public._ok(not exists (select 1 from public.tenants_exclusao_em_curso), 'E13 nenhuma exclusão fica "em curso"');
  perform public._ok((select count(*) from public.tenants where id in (t_a, t_b, t_rio)) = 3, 'E14 outras empresas intactas');

  -- ================================================================= C. Conversions API
  perform public._ok(public.capi_evento_de_venda('Venda fechada') and public.capi_evento_de_venda(' purchase ') and not public.capi_evento_de_venda('Reunião realizada'),
                     'C1 reconhece nomes de evento de venda');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) from public.capi_mapeamento_sugerido() where etapa_id = ea_ganha and evento = 'Venda fechada' and enviar_valor) = 1
                     and (select count(*) from public.capi_mapeamento_sugerido() where etapa_id = ea_real and evento = 'Reunião realizada' and not enviar_valor) = 1,
                     'C2 sugestão pelas etapas da empresa: venda só na etapa ganha (com valor), reunião realizada sem valor');
  perform public._ok(not exists (select 1 from public.capi_mapeamento_sugerido() where etapa_id = eb_ganha), 'C3 sugestão nunca mostra etapas de outra empresa');
  perform public._como(null, null);
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('meta_conversoes', t_a) on conflict do nothing;
  insert into public.meta_conversoes_conexoes (tenant_id, business_id, dataset_id) values (t_a, '900000000000001', '900000000000002');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.capi_definir_configuracao(array[%L]::uuid[], jsonb_build_array(jsonb_build_object('etapa_id', %L, 'evento', 'Venda', 'enviar_valor', true)), false)$q$, fa, ea_real));
  perform public._ok(v_r like '23514:%representa uma venda%', 'C4 evento de venda numa etapa que não é ganha: recusado');
  perform public.capi_definir_configuracao(array[fa], jsonb_build_array(
    jsonb_build_object('etapa_id', ea_ganha, 'evento', 'Venda fechada', 'enviar_valor', true),
    jsonb_build_object('etapa_id', ea_real, 'evento', 'Reunião realizada', 'enviar_valor', true)), false);
  perform public._como(null, null);
  perform public._ok((select enviar_valor from public.meta_conversoes_mapeamento where etapa_id = ea_ganha)
                     and not (select enviar_valor from public.meta_conversoes_mapeamento where etapa_id = ea_real),
                     'C5 valor só na etapa ganha (mesmo pedindo valor na reunião)');
  perform public._ok((select count(*) from public.meta_conversoes_eventos where tenant_id = t_a) = 0, 'C6 nada foi enfileirado nem enviado');

  raise notice 'regras_comerciais_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
