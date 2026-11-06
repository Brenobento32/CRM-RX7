set client_encoding = 'UTF8';
-- ===========================================================================
-- Teste dos três eventos da Rio X7, da regra de "lead novo", da oposição e da
-- recuperação. ONDE RODAR: cópia LOCAL crm_rx7_* com 20261115090000..090300
-- aplicadas. Só dados fictícios. Termina em ROLLBACK. Nada sai para a Meta.
--
--  Q0  migrations aplicadas com a CAPI travada: três eventos mapeados, valor só TCV/MRR
--      e só na Rio X7, trava intacta, nenhum evento criado
--  E1  Lead Novo de formulário Meta cadastrado há minutos: sai, sem valor
--  E2  lead antigo importado/sincronizado agora: NÃO sai ("descartado" com o motivo)
--  E3  sem a data do cadastro: espera 1 h e então descarta; antes disso, não sai
--  E4  Lead Ads direto (created_time na atribuição) também vale
--  Q1  agendar não gera evento; "Reunião realizada" gera um, sem valor, sem duplicar
--  V1  Fechado TCV = total registrado; MRR = UMA mensalidade; BRL; modalidade junto e guardada
--  V2  fechamento sem modalidade: retido ("valor_pendente"); corrigido, sai com o valor
--  V3  venda anulada: rejeitada
--  V4  venda comum (não aprovada na Rio X7): retida, nunca sai sem valor
--  V5  outra empresa continua sem valor; V6 sem e-mail/telefone, dataset isolado
--  O1  oposição: só o Administrador da própria empresa registra; descarta o pendente; auditada
--  O2  depois da oposição, evento novo já nasce descartado e nunca entra no lote
--  O3  ficha do cliente: situação da oposição só para o Administrador
--  R1  recuperação: só Reunião realizada e Fechado (nunca Lead Novo), valor real, sem duplicar,
--      horário real da mudança de etapa, pula titular com oposição
--  T1  travada: recuperação recusada e nada sai
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
  if to_regclass('public.meta_conversoes_oposicoes') is null
     or to_regprocedure('public.admin_capi_recuperar_eventos(uuid, timestamptz, text, text)') is null then
    raise exception 'Aplique antes as propostas 20261115090000 a 20261115090300 nesta cópia local.';
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
grant execute on function public._como(uuid, text) to authenticated, service_role, anon;
create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated, service_role, anon;
create function public._recusa(p_sql text, p_codigo text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_codigo;
end;
$$;
grant execute on function public._recusa(text, text) to authenticated, service_role, anon;
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

-- Lead de formulário Meta (planilha nativa): negociação nasce na etapa inicial; as respostas
-- (com o created_time da Meta) chegam DEPOIS, como na ingestão real. p_criado nulo = sem a data.
create function public._lead(p_tenant uuid, p_tel text, p_leadgen text, p_criado interval)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid; v_e uuid;
begin
  select e.id into v_e from public.etapas_funil e join public.funis f on f.id = e.funil_id where f.tenant_id = p_tenant and f.padrao and e.etapa_inicial;
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, email, owner_id)
  values (p_tenant, 'pessoa_fisica', 'Lead ' || p_tel, p_tel, 'lead' || p_tel || '@exemplo.test',
          (select m.user_id from public.tenant_memberships m
            where m.tenant_id = p_tenant and m.ativo and m.user_id not in (select s.user_id from public.super_admins s)
            order by m.user_id limit 1)) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, v_e, 'formulario', 'rx-' || p_tel, jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', p_leadgen))
  returning id into v_neg;
  if p_criado is not null then
    insert into public.negociacao_respostas (tenant_id, negociacao_id, envio, chave, pergunta, resposta, ordem)
    values (p_tenant, v_neg, 'linha-' || p_tel, 'created_time', 'created_time',
            to_char((now() - p_criado) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00', 1);
  end if;
  return v_neg;
end;
$$;
create function public._mover(p_neg uuid, p_etapa uuid, p_uid uuid, p_slug text)
returns void language plpgsql as $$
begin
  perform public._como(p_uid, p_slug);
  update public.negociacoes set etapa_id = p_etapa where id = p_neg;
  perform public._como(null, null);
end;
$$;
create function public._fechar(p_neg uuid, p_uid uuid, p_slug text, p_valor numeric, p_tipo public.tipo_venda)
returns void language plpgsql as $$
begin
  perform public._como(p_uid, p_slug);
  perform public.fechar_negociacao(p_neg, 1000, p_valor, current_date, true, true, 'pendente', 'nao_iniciado', null, null, null, p_tipo);
  perform public._como(null, null);
end;
$$;
create function public._ev(p_neg uuid, p_etapa uuid)
returns text language sql as $$ select 'avante-' || p_neg || '-' || p_etapa $$;

do $$
declare
  sup   uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  vend  uuid := '60000000-0000-4000-8000-0000000000a4';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  t_rx  uuid := 'a0000000-0000-4000-8000-000000000002';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  f_rx uuid; e_novo uuid; e_ag uuid; e_reu uuid; e_fech uuid; fb uuid; eb_ganha uuid; eb_ini uuid; n_b_velho uuid; n_b_sem uuid;
  n_novo uuid; n_velho uuid; n_semdata uuid; n_semdata2 uuid; n_ads uuid; n1 uuid;
  n_tcv uuid; n_mrr uuid; n_venda uuid; n_sem uuid; n_anul uuid; n_b uuid;
  n_opo uuid; n_opo2 uuid; n_opo3 uuid; n_rec uuid; n_rec2 uuid;
  v_r record;
begin
  perform public._como(null, null);

  -- ================================================================= Q0 migrations com a CAPI travada
  perform public._ok(exists (select 1 from public.meta_conversoes_travas where tenant_id = t_rx)
                     and not exists (select 1 from public.meta_conversoes_eventos where tenant_id = t_rx),
                     'Q0 migrations aplicadas com a Rio X7 travada: trava intacta e nenhum evento criado');
  select id into f_rx from public.funis where tenant_id = t_rx and nome = 'Funil Principal';
  select id into e_novo from public.etapas_funil where funil_id = f_rx and etapa_inicial;
  select id into e_ag from public.etapas_funil where funil_id = f_rx and chave = 'reuniao_agendada';
  select id into e_reu from public.etapas_funil where funil_id = f_rx and chave = 'reuniao_realizada';
  select id into e_fech from public.etapas_funil where funil_id = f_rx and tipo = 'ganha';
  select id into fb from public.funis where tenant_id = t_b and padrao;
  select id into eb_ganha from public.etapas_funil where funil_id = fb and tipo = 'ganha';
  select id into eb_ini from public.etapas_funil where funil_id = fb and etapa_inicial;
  perform public._ok((select count(*) from public.meta_conversoes_mapeamento where tenant_id = t_rx) = 3
                     and exists (select 1 from public.meta_conversoes_mapeamento where tenant_id = t_rx and etapa_id = e_novo and evento = 'Lead Novo' and not enviar_valor)
                     and exists (select 1 from public.meta_conversoes_mapeamento where tenant_id = t_rx and etapa_id = e_reu and evento = 'Reunião realizada' and not enviar_valor)
                     and exists (select 1 from public.meta_conversoes_mapeamento where tenant_id = t_rx and etapa_id = e_fech and evento = 'Fechado' and enviar_valor),
                     'Q0 três eventos: Lead Novo (sem valor), Reunião realizada (sem valor), Fechado (com valor)');
  perform public._ok((select modalidades = array['tcv', 'mrr']::public.tipo_venda[] and exige_valor from public.meta_conversoes_valor_empresa where tenant_id = t_rx)
                     and (select meta_conversoes_valor_modalidades = '{}' from public.plataforma_integracoes)
                     and not exists (select 1 from public.meta_conversoes_valor_empresa where tenant_id <> t_rx),
                     'Q0 valor aprovado só TCV e MRR, só para a Rio X7 (plataforma continua sem nenhuma)');
  perform public._ok((select array_agg(tenant_id) from public.meta_conversoes_entrada_empresa) = array[t_rx],
                     'Q0 regra do Lead Novo ligada só para a Rio X7');

  -- ================================================================= preparação local (fictícia)
  update public.plataforma_integracoes set meta_conversoes = true;
  insert into public.super_admins (user_id) values (sup) on conflict do nothing;
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_rx, 'teste local', 's1', now(), now() + interval '1 hour');
  insert into public.tenant_memberships (tenant_id, user_id, papel, ativo) values (t_rx, g_a, 'gerente', true) on conflict do nothing;
  insert into public.tenant_memberships (tenant_id, user_id, papel, ativo) values (t_rx, vend, 'vendedor', true) on conflict do nothing;
  -- Em produção a Rio X7 aceita só TCV e MRR; "venda" é liberada aqui só para provar que fica retida.
  update public.empresa_regras_comerciais set tipos_venda = array['tcv', 'mrr', 'venda']::public.tipo_venda[] where tenant_id = t_rx;
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where codigo = 'business' and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_b, (select id from public.planos where codigo = 'business'), 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  perform public._servico();
  perform public.capi_salvar_conexao(t_rx, sup, '700000000000009', '800000000000009', 'Dataset Rio X7 (local)', 'token-sistema-rio-xxxxxxxxxxxx');
  perform public.capi_salvar_conexao(t_b, g_b, '700000000000002', '800000000000002', 'Dataset B', 'token-sistema-beta-xxxxxxxxxx');
  perform public._como(sup, null);
  perform public.admin_capi_retirar_trava(t_rx, 'Teste local dos três eventos da Rio X7', 'RETIRAR TRAVA rio-x7');
  perform public._como(sup, 'rio-x7');
  perform public.capi_acao('ativar');
  perform public._como(g_b, 'teste-beta');
  perform public.capi_definir_configuracao(array[fb]::uuid[], jsonb_build_array(jsonb_build_object('etapa_id', eb_ini, 'evento', 'Lead recebido', 'enviar_valor', false),
                                                                           jsonb_build_object('etapa_id', eb_ganha, 'evento', 'Venda', 'enviar_valor', true)), false);
  perform public.capi_acao('ativar');
  perform public._como(null, null);

  -- ================================================================= E1–E4 evento de entrada
  n_novo := public._lead(t_rx, '5524990000101', '902000000000101', interval '10 minutes');
  n_velho := public._lead(t_rx, '5524990000102', '902000000000102', interval '10 days');
  n_semdata := public._lead(t_rx, '5524990000103', '902000000000103', null);
  n_semdata2 := public._lead(t_rx, '5524990000104', '902000000000104', null);
  update public.meta_conversoes_eventos set created_at = now() - interval '2 hours' where negociacao_id = n_semdata;
  n_ads := public._lead(t_rx, '5524990000105', '902000000000105', null);
  update public.negociacoes
     set atribuicao = atribuicao || jsonb_build_object('created_time', to_char((now() - interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+0000"'))
   where id = n_ads;
  perform public._ok((select bool_and(evento_entrada and evento = 'Lead Novo') from public.meta_conversoes_eventos
                       where negociacao_id in (n_novo, n_velho, n_semdata, n_semdata2, n_ads)),
                     'E0 negociação que nasce na etapa inicial gera o evento de ENTRADA "Lead Novo"');

  -- ================================================================= Q1 qualificação
  n1 := public._lead(t_rx, '5524990000001', '902000000000001', interval '30 minutes');
  perform public._mover(n1, e_ag, sup, 'rio-x7');
  perform public._ok((select count(*) from public.meta_conversoes_eventos where negociacao_id = n1) = 1,
                     'Q1 agendar reunião NÃO gera evento (só o de entrada existe)');
  perform public._mover(n1, e_reu, sup, 'rio-x7');
  perform public._ok((select not evento_entrada from public.meta_conversoes_eventos where event_id = public._ev(n1, e_reu)),
                     'Q1 reunião realizada gera o evento de qualificação (não é entrada)');
  perform public._mover(n1, e_ag, sup, 'rio-x7');
  perform public._mover(n1, e_reu, sup, 'rio-x7');
  perform public._ok((select count(*) from public.meta_conversoes_eventos where negociacao_id = n1 and etapa_id = e_reu) = 1,
                     'Q1 realizar de novo não duplica (evento por negociação e etapa)');

  -- ================================================================= V1–V5 fechamentos
  n_tcv := public._lead(t_rx, '5524990000002', '902000000000002', interval '20 minutes');
  perform public._fechar(n_tcv, sup, 'rio-x7', 12000.00, 'tcv');
  n_mrr := public._lead(t_rx, '5524990000003', '902000000000003', interval '20 minutes');
  perform public._fechar(n_mrr, sup, 'rio-x7', 1500.00, 'mrr');
  n_venda := public._lead(t_rx, '5524990000004', '902000000000004', interval '20 minutes');
  perform public._fechar(n_venda, sup, 'rio-x7', 800.00, 'venda');
  n_sem := public._lead(t_rx, '5524990000005', '902000000000005', interval '20 minutes');
  perform public._fechar(n_sem, sup, 'rio-x7', 2300.00, 'tcv');
  update public.fechamentos set tipo_venda = null where negociacao_id = n_sem;
  n_anul := public._lead(t_rx, '5524990000006', '902000000000006', interval '20 minutes');
  perform public._fechar(n_anul, sup, 'rio-x7', 999.00, 'mrr');
  update public.fechamentos set anulado_em = now(), motivo_anulacao = 'Venda cancelada (teste)', anulado_por = g_a where negociacao_id = n_anul;
  n_b := public._lead(t_b, '5524990000007', '902000000000007', interval '20 minutes');
  n_b_velho := public._lead(t_b, '5524990000010', '902000000000010', interval '10 days');
  n_b_sem := public._lead(t_b, '5524990000011', '902000000000011', null);
  update public.meta_conversoes_eventos set created_at = now() - interval '2 hours' where negociacao_id = n_b_sem;
  perform public._fechar(n_b, g_b, 'teste-beta', 5000.00, 'tcv');

  perform public._servico();
  create temp table _l1 on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);

  perform public._ok(exists (select 1 from _l1 where event_id = public._ev(n_novo, e_novo) and valor is null and modalidade is null),
                     'E1 Lead Novo cadastrado na Meta há 10 min: sai, sem valor');
  perform public._ok(not exists (select 1 from _l1 where event_id = public._ev(n_velho, e_novo))
                     and (select situacao = 'descartado' and ultimo_erro like 'Lead cadastrado na Meta mais de 24 h%'
                            from public.meta_conversoes_eventos where event_id = public._ev(n_velho, e_novo)),
                     'E2 lead antigo importado agora: NÃO sai (descartado, com o motivo)');
  perform public._ok((select situacao = 'descartado' and ultimo_erro like 'Sem a data do cadastro%'
                        from public.meta_conversoes_eventos where event_id = public._ev(n_semdata, e_novo))
                     and (select situacao = 'pendente' from public.meta_conversoes_eventos where event_id = public._ev(n_semdata2, e_novo))
                     and not exists (select 1 from _l1 where event_id in (public._ev(n_semdata, e_novo), public._ev(n_semdata2, e_novo))),
                     'E3 sem a data do cadastro: espera 1 h (não sai) e então descarta');
  perform public._ok(exists (select 1 from _l1 where event_id = public._ev(n_ads, e_novo)),
                     'E4 Lead Ads direto (created_time na atribuição, recente): sai');
  perform public._ok((select count(*) from _l1 where event_id = public._ev(n1, e_reu) and valor is null and evento = 'Reunião realizada') = 1,
                     'Q1 reunião realizada sai sem valor');

  perform public._ok((select valor = 12000.00 and moeda = 'BRL' and modalidade = 'tcv' and evento = 'Fechado' from _l1 where event_id = public._ev(n_tcv, e_fech)),
                     'V1 TCV: valor total registrado (12000,00), BRL, modalidade TCV');
  perform public._ok((select valor = 1500.00 and moeda = 'BRL' and modalidade = 'mrr' from _l1 where event_id = public._ev(n_mrr, e_fech)),
                     'V1 MRR: UMA mensalidade (1500,00), sem multiplicar, modalidade MRR');
  perform public._ok((select valor_informado = 12000.00 and modalidade_valor = 'tcv' from public.meta_conversoes_eventos where event_id = public._ev(n_tcv, e_fech))
                     and (select valor_informado = 1500.00 and modalidade_valor = 'mrr' from public.meta_conversoes_eventos where event_id = public._ev(n_mrr, e_fech))
                     and (select valor_informado is null and modalidade_valor is null from public.meta_conversoes_eventos where event_id = public._ev(n1, e_reu)),
                     'V1 o evento guarda o valor e a modalidade exatamente como foram informados');
  perform public._ok(not exists (select 1 from _l1 where event_id = public._ev(n_sem, e_fech))
                     and (select situacao from public.meta_conversoes_eventos where event_id = public._ev(n_sem, e_fech)) = 'valor_pendente',
                     'V2 fechamento sem modalidade: retido para correção');
  perform public._ok((select situacao from public.meta_conversoes_eventos where event_id = public._ev(n_anul, e_fech)) = 'rejeitado',
                     'V3 venda anulada: rejeitada, nunca sai');
  perform public._ok(not exists (select 1 from _l1 where event_id = public._ev(n_venda, e_fech))
                     and (select situacao from public.meta_conversoes_eventos where event_id = public._ev(n_venda, e_fech)) = 'valor_pendente',
                     'V4 venda comum (não aprovada na Rio X7): retida, nunca sai sem valor');
  perform public._ok((select valor is null and modalidade is null from _l1 where event_id = public._ev(n_b, eb_ganha)),
                     'V5 outra empresa com "Enviar o valor" marcado: continua SEM valor');
  perform public._ok(exists (select 1 from _l1 where event_id = public._ev(n_b_velho, eb_ini)) and exists (select 1 from _l1 where event_id = public._ev(n_b_sem, eb_ini)),
                     'X1 outra empresa: a regra do lead novo NÃO se aplica (lead antigo e sem data saem como hoje)');
  perform public._ok(not exists (select 1 from _l1 where email is not null or telefone is not null)
                     and (select bool_and((tenant_id = t_rx and dataset_id = '800000000000009') or (tenant_id <> t_rx and dataset_id <> '800000000000009')) from _l1),
                     'V6 sem e-mail e telefone; cada evento só no dataset da própria empresa');

  update public.fechamentos set tipo_venda = 'tcv' where negociacao_id = n_sem;
  perform public._servico();
  create temp table _l2 on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);
  perform public._ok((select valor = 2300.00 and modalidade = 'tcv' from _l2 where event_id = public._ev(n_sem, e_fech)),
                     'V2 corrigido o fechamento: sai com o valor registrado (2300,00, TCV)');

  -- ================================================================= O1–O3 oposição
  n_opo := public._lead(t_rx, '5524990000201', '902000000000201', interval '15 minutes');
  perform public._mover(n_opo, e_reu, sup, 'rio-x7');
  perform public._ok((select count(*) from public.meta_conversoes_eventos where negociacao_id = n_opo and situacao = 'pendente') = 2,
                     'O0 cliente com Lead Novo e Reunião realizada pendentes');
  perform public._como(vend, 'rio-x7');
  perform public._ok(public._recusa(format('select public.capi_registrar_oposicao(%L, %L, null)', (select cliente_id from public.negociacoes where id = n_opo), 'email'), '42501'),
                     'O1 Vendedor não registra oposição');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(public._recusa(format('select public.capi_registrar_oposicao(%L, %L, null)', (select cliente_id from public.negociacoes where id = n_opo), 'email'), 'P0002'),
                     'O1 Administrador de outra empresa não alcança o cliente da Rio X7');
  perform public._como(g_a, 'rio-x7');
  perform public._ok(public._recusa(format('select public.capi_registrar_oposicao(%L, %L, null)', (select cliente_id from public.negociacoes where id = n_opo), 'carta'), '22023'),
                     'O1 canal inválido recusado');
  select * into v_r from public.capi_registrar_oposicao((select cliente_id from public.negociacoes where id = n_opo), 'email', 'Pedido recebido no suporte (teste)');
  perform public._ok(v_r.registrada_em is not null and v_r.eventos_descartados = 2,
                     'O1 Administrador registra: os 2 eventos pendentes do titular são descartados na hora');
  select * into v_r from public.capi_registrar_oposicao((select cliente_id from public.negociacoes where id = n_opo), 'whatsapp', null);
  perform public._ok(public._recusa('select count(*) from public.meta_conversoes_oposicoes', '42501'),
                     'O3 a tabela de oposições é invisível fora das funções');
  perform public._como(null, null);
  perform public._ok(v_r.eventos_descartados = 0 and (select count(*) from public.meta_conversoes_oposicoes where cliente_id = (select cliente_id from public.negociacoes where id = n_opo)) = 1
                     and (select canal from public.meta_conversoes_oposicoes where cliente_id = (select cliente_id from public.negociacoes where id = n_opo)) = 'email',
                     'O1 registrar de novo não duplica nem troca o registro original');
  perform public._como(g_a, 'rio-x7');
  perform public._ok((select aplicavel and registrada_em is not null and canal = 'email' from public.capi_oposicao_do_cliente((select cliente_id from public.negociacoes where id = n_opo))),
                     'O3 a ficha do cliente mostra a oposição ao Administrador');
  perform public._como(vend, 'rio-x7');
  perform public._ok(public._recusa(format('select * from public.capi_oposicao_do_cliente(%L)', (select cliente_id from public.negociacoes where id = n_opo)), '42501'),
                     'O3 Vendedor não vê a situação da oposição');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'capi_oposicao_registrada' and tenant_id = t_rx and ator_id = g_a),
                     'O1 oposição auditada (quem registrou)');
  -- nova negociação do mesmo titular: evento já nasce descartado
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (t_rx, (select cliente_id from public.negociacoes where id = n_opo), e_novo, 'formulario', 'rx-opo-2',
          jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', '902000000000202'))
  returning id into n_opo2;
  perform public._mover(n_opo2, e_reu, sup, 'rio-x7');
  perform public._ok((select bool_and(situacao = 'descartado' and ultimo_erro like 'Titular se opôs%') from public.meta_conversoes_eventos where negociacao_id = n_opo2)
                     and (select count(*) from public.meta_conversoes_eventos where negociacao_id = n_opo2) = 2,
                     'O2 depois da oposição, os eventos novos do titular já nascem descartados');
  update public.meta_conversoes_eventos set situacao = 'pendente', ultimo_erro = null where negociacao_id = n_opo2 and etapa_id = e_reu;  -- força por fora
  perform public._servico();
  create temp table _l_opo on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from _l_opo where event_id = public._ev(n_opo2, e_reu))
                     and (select situacao from public.meta_conversoes_eventos where event_id = public._ev(n_opo2, e_reu)) = 'descartado',
                     'O2 mesmo forçado para "pendente" por fora, o lote nunca leva evento de titular com oposição');

  -- ================================================================= R1 recuperação
  perform public._como(sup, 'rio-x7');
  perform public.capi_acao('pausar');
  perform public._como(null, null);
  n_rec := public._lead(t_rx, '5524990000008', '902000000000008', interval '5 minutes');
  perform public._mover(n_rec, e_ag, sup, 'rio-x7');
  perform public._mover(n_rec, e_reu, sup, 'rio-x7');
  n_rec2 := public._lead(t_rx, '5524990000009', '902000000000009', interval '5 minutes');
  perform public._fechar(n_rec2, sup, 'rio-x7', 4200.00, 'mrr');
  -- titular com oposição: negociação nova avança durante a pausa
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (t_rx, (select cliente_id from public.negociacoes where id = n_opo), e_novo, 'formulario', 'rx-opo-3',
          jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', '902000000000203'))
  returning id into n_opo3;
  perform public._mover(n_opo3, e_reu, sup, 'rio-x7');
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where negociacao_id in (n_rec, n_rec2)), 'R1 pausada: nada nasce');
  perform public._como(sup, 'rio-x7');
  perform public.capi_acao('retomar');
  perform public._como(sup, null);
  create temp table _rec on commit drop as
    select * from public.admin_capi_recuperar_eventos(t_rx, now() - interval '1 hour', 'Recuperação local dos três eventos da Rio X7', 'RECUPERAR EVENTOS rio-x7');
  perform public._como(null, null);
  perform public._ok((select string_agg(evento, ',' order by evento) from public.meta_conversoes_eventos where negociacao_id in (n_rec, n_rec2)) = 'Fechado,Reunião realizada',
                     'R1 recupera só Reunião realizada e Fechado; NUNCA o Lead Novo (entrada)');
  perform public._ok(not exists (select 1 from _rec where evento = 'Lead Novo'),
                     'R1 Lead Novo nem aparece na recuperação');
  perform public._ok((select event_time = (select min(h.created_at) from public.historico_etapas h where h.negociacao_id = n_rec and h.etapa_nova_id = e_reu)
                        from public.meta_conversoes_eventos where event_id = public._ev(n_rec, e_reu)),
                     'R1 horário do evento = horário real da mudança de etapa (sem alteração)');
  perform public._ok((select com_oposicao from _rec where evento = 'Reunião realizada') = 1
                     and not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_opo3),
                     'R1 titular com oposição: a recuperação não cria o evento');
  perform public._servico();
  create temp table _l3 on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);
  perform public._ok((select valor = 4200.00 and moeda = 'BRL' and modalidade = 'mrr' from _l3 where event_id = public._ev(n_rec2, e_fech)),
                     'R1 venda recuperada sai com o valor real (MRR 4200,00, uma mensalidade)');
  perform public._como(sup, null);
  perform public._ok((select sum(enfileirados) from public.admin_capi_recuperar_eventos(t_rx, now() - interval '1 hour', 'Segunda chamada local, não pode duplicar', 'RECUPERAR EVENTOS rio-x7')) = 0,
                     'R1 chamar de novo não duplica nada');
  perform public._como(null, null);
  perform public._ok((select (detalhes ->> 'entradas_ignoradas')::int >= 2 from public.admin_auditoria
                       where acao = 'capi_eventos_recuperados' and tenant_id = t_rx order by id limit 1),
                     'R1 recuperação auditada, com as entradas de lead ignoradas');

  -- ================================================================= M1 tela e T1 trava
  perform public._como(sup, 'rio-x7');
  perform public._ok(public.capi_valor_modalidades() = array['mrr', 'tcv'], 'M1 a Rio X7 vê TCV e MRR aprovados');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(public.capi_valor_modalidades() = '{}'::text[], 'M1 outra empresa não vê nada aprovado');
  perform public._como(null, null);
  update public.meta_conversoes_eventos set situacao = 'pendente', bloqueado_ate = null where tenant_id = t_rx and situacao = 'enviando';
  perform public._como(sup, null);
  perform public.admin_capi_travar(t_rx, 'Trava de volta depois do teste local');
  perform public._ok(public._recusa(format('select * from public.admin_capi_recuperar_eventos(%L, now() - interval ''1 hour'', ''Recuperação com trava (teste)'', ''RECUPERAR EVENTOS rio-x7'')', t_rx), '42501'),
                     'T1 travada: recuperação recusada');
  perform public._servico();
  perform public._ok(not exists (select 1 from public.capi_reservar(200) where tenant_id = t_rx), 'T1 travada: nada da Rio X7 sai');
  perform public._como(null, null);
end;
$$;

rollback;
