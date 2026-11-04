set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: homologação de UM evento da CAPI (migration 20261110090000, com a
-- correção 20261111090000; formato real da planilha, prova e deduplicação em
-- capi_homologacao_formulario_test.sql).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  H1–H6   quem e o quê: só Super Admin COM a janela do "Acessar CRM", só
--          empresa em homologação, só com o envio geral desligado, só o
--          dataset, o formulário, o lead e a negociação certos
--  H6b     nunca um lead real: sem a prova da ferramenta de teste da Meta (um
--          nome "Homologação" não basta), de anúncio, de outro formulário,
--          antigo, movido, reaproveitado ou arquivado — tudo recusado
--  H7–H12  conferência não grava nada; reserva audita; sem repetição; resultado
--          nunca volta para a fila; conexão, negociação, histórico e fila intactos
--  H13–H16 envio travado, limite diário, permissões das funções, auditoria limpa
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

-- Lead como a planilha nativa da Meta grava: negociação na etapa inicial + respostas da linha
-- (form_id, created_time, id, ad_id). p_teste = dados fictícios da ferramenta de teste da Meta.
create function public._lead(p_tenant uuid, p_dono uuid, p_etapa uuid, p_nome text, p_tel text, p_lead text, p_form text,
                             p_criado interval, p_teste boolean, p_ad text default null, p_id_planilha text default null)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid;
begin
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id)
  values (p_tenant, 'pessoa_fisica', p_nome, p_tel, p_dono) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, p_etapa, 'formulario', 'homolog-' || p_tel, jsonb_build_object('source', 'google_sheets', 'meta_lead_id', p_lead))
  returning id into v_neg;
  insert into public.negociacao_respostas (tenant_id, negociacao_id, envio, chave, pergunta, resposta, ordem)
  select p_tenant, v_neg, 'linha-1', c, c, v, o from (values
    ('id', coalesce(p_id_planilha, 'l:' || p_lead), 1),
    ('form_id', p_form, 2),
    ('created_time', to_char((now() - p_criado) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+0000"'), 3),
    ('is_organic', 'true', 4),
    ('ad_id', coalesce(p_ad, ''), 5),
    ('Qual é o nome da sua Empresa?', case when p_teste then '<test lead: dummy data for qual_é_o_nome_da_sua_empresa?>' else 'Escola Real Ltda' end, 6),
    -- A ferramenta preenche todas as perguntas; 20261111090000 exige os dados fictícios em dois campos.
    ('Qual o maior desafio hoje?', case when p_teste then '<test lead: dummy data for qual_o_maior_desafio_hoje?>' else 'Captar alunos' end, 7)
  ) x(c, v, o) where v <> '';
  return v_neg;
end;
$$;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  sup   uuid := '60000000-0000-4000-8000-0000000000ff';
  hib   uuid := '60000000-0000-4000-8000-0000000000fe';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  ds_a  text := '800000000000001';
  ds_b  text := '800000000000002';
  form  text := '1459591029473591';
  lead_a text := '123456789012345';
  fa1 uuid; ea1 uuid; ea_real uuid; fb1 uuid; eb1 uuid;
  v_con uuid; v_con_b uuid; v_cli uuid;
  n_a uuid; n_a2 uuid; n_a3 uuid; n_a4 uuid; n_b uuid;
  n_nome uuid; n_anuncio uuid; n_outro_form uuid; n_meta_velha uuid; n_sem_criado uuid; n_id_dif uuid;
  n_movida uuid; n_origem uuid; n_arq uuid; n_funil_velho uuid;
  v_r text; v_p record; v_h public.meta_conversoes_homologacoes;
  v_hist integer; v_etapa uuid; v_fila integer; v_aud integer;
  p_business uuid;
  q text := 'select * from public.capi_homologacao_preparar(%L, %L, %L, %L, %L, %L, %s)';
begin
  perform public._como(null, null);
  -- Mesmo ponto de partida da produção: chave global da CAPI desligada, nenhuma conexão, nenhuma homologação liberada.
  update public.plataforma_integracoes set meta_conversoes = false;
  delete from public.meta_conversoes_conexoes;
  delete from public.plataforma_integracoes_empresas where tipo = 'meta_conversoes';
  delete from public.super_admin_acessos;
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_real from public.etapas_funil where funil_id = fa1 and chave = 'reuniao_realizada';
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;

  select id into p_business from public.planos where codigo = 'business';
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where id = p_business and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_a, p_business, 'ativa'), (t_b, p_business, 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';

  -- Leads da ferramenta de teste da Meta (dados fictícios gerados pela Meta).
  n_a  := public._lead(t_a, g_a, ea1, 'Lead teste 1', '5511900000101', lead_a, form, interval '1 hour', true);
  n_a2 := public._lead(t_a, g_a, ea1, 'Lead teste 2', '5511900000102', '223456789012345', form, interval '1 hour', true);
  n_a3 := public._lead(t_a, g_a, ea1, 'Lead teste 3', '5511900000103', '323456789012345', form, interval '1 hour', true);
  n_a4 := public._lead(t_a, g_a, ea1, 'Lead teste 4', '5511900000104', '423456789012345', form, interval '1 hour', true);
  n_b  := public._lead(t_b, g_b, eb1, 'Lead teste B', '5511900000201', lead_a, form, interval '1 hour', true);
  -- Leads que NUNCA podem ser homologados.
  n_nome       := public._lead(t_a, g_a, ea1, 'Homologação AVANTE (nome digitado)', '5511900000301', '613456789012345', form, interval '1 hour', false);
  n_anuncio    := public._lead(t_a, g_a, ea1, 'Lead de anúncio', '5511900000302', '623456789012345', form, interval '1 hour', true, '120200000000001');
  n_outro_form := public._lead(t_a, g_a, ea1, 'Lead outro formulário', '5511900000303', '633456789012345', '999999999999999', interval '1 hour', true);
  n_meta_velha := public._lead(t_a, g_a, ea1, 'Lead Meta antigo', '5511900000304', '643456789012345', form, interval '4 days', true);
  n_sem_criado := public._lead(t_a, g_a, ea1, 'Lead sem created_time', '5511900000305', '653456789012345', form, interval '1 hour', true);
  delete from public.negociacao_respostas where negociacao_id = n_sem_criado and pergunta = 'created_time';
  n_id_dif     := public._lead(t_a, g_a, ea1, 'Lead id diferente', '5511900000306', '663456789012345', form, interval '1 hour', true, null, 'l:999999999999999');
  n_movida     := public._lead(t_a, g_a, ea1, 'Lead já movido', '5511900000307', '673456789012345', form, interval '1 hour', true);
  insert into public.historico_etapas (negociacao_id, tenant_id, usuario_id, etapa_anterior_id, etapa_nova_id) values (n_movida, t_a, g_a, ea1, ea_real);
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id) values (t_a, 'pessoa_fisica', 'Lead reaproveitado', '5511900000308', g_a) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (t_a, v_cli, ea1, 'formulario', 'origem-1', '{"source":"google_sheets","origens_adicionais":[{"meta_lead_id":"683456789012345"}]}') returning id into n_origem;
  insert into public.negociacao_respostas (tenant_id, negociacao_id, envio, chave, pergunta, resposta)
  values (t_a, n_origem, 'linha-1', 'form_id', 'form_id', form), (t_a, n_origem, 'linha-1', 'x', 'x', '<test lead: dummy data for x>'),
         (t_a, n_origem, 'linha-1', 'created_time', 'created_time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+0000"'));
  n_arq        := public._lead(t_a, g_a, ea1, 'Lead arquivado', '5511900000309', '693456789012345', form, interval '1 hour', true);
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste local' where id = n_arq;
  n_funil_velho := public._lead(t_a, g_a, ea1, 'Lead entrou há 4 dias', '5511900000310', '713456789012345', form, interval '1 hour', true);
  update public.historico_etapas set created_at = now() - interval '4 days' where negociacao_id = n_funil_velho;

  -- ================================================================= H1 empresa fora da homologação
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '42501:%' or v_r like 'RX030:%', 'H1 sem janela / CAPI não liberada: homologação recusada');

  -- Libera a CAPI só em homologação, para A e B (chave global desligada), e conecta os dois datasets.
  perform public._como(null, null);
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('meta_conversoes', t_a), ('meta_conversoes', t_b);
  perform public._servico();
  v_con := public.capi_salvar_conexao(t_a, g_a, '700000000000001', ds_a, 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx');
  v_con_b := public.capi_salvar_conexao(t_b, g_b, '700000000000002', ds_b, 'Dataset B', 'token-sistema-beta-xxxxxxxxxx');
  perform public._como(null, null);
  perform public._ok((select not meta_conversoes from public.plataforma_integracoes)
                     and (select situacao = 'configurando' from public.meta_conversoes_conexoes where id = v_con), 'H1 chave global desligada; conexão de A só configurando');

  -- ================================================================= H2 só Super Admin, e só com a janela auditada
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '42501:%', 'H2 Super Admin SEM a janela do "Acessar CRM": recusado');
  perform public._como(null, null);
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_a, 'teste local', 's1', now(), now() + interval '1 hour'), (sup, t_b, 'teste local', 's1', now(), now() + interval '1 hour');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, hib, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '42501:%', 'H2 Super Admin com vínculo, sem a janela dele: recusado');
  v_r := public._recusa(format(q, t_a, g_a, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '42501:%', 'H2 Administrador da empresa (não Super Admin): recusado');
  v_r := public._recusa(format('select * from public.capi_homologacao_preparar(%L, null, %L, %L, %L, %L, false)', t_a, n_a, lead_a, ds_a, form));
  perform public._ok(v_r like '42501:%', 'H2 sem usuário: recusado');
  perform public._como(null, null);
  update public.super_admin_acessos set encerrado_em = now() where user_id = sup and tenant_id = t_a;
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '42501:%', 'H2 janela encerrada: recusado');
  perform public._como(null, null);
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_a, 'teste local 2', 's1', now(), now() + interval '1 hour');
  select count(*) into v_hist from public.historico_etapas where negociacao_id = n_a;
  select etapa_id into v_etapa from public.negociacoes where id = n_a;
  select count(*) into v_fila from public.meta_conversoes_eventos;

  -- ================================================================= H3 envio geral precisa estar desligado
  update public.meta_conversoes_conexoes set situacao = 'ativa' where id = v_con;
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H3 conexão ativa (fila geral ligada): homologação recusada');
  perform public._como(null, null);
  update public.meta_conversoes_conexoes set situacao = 'configurando' where id = v_con;

  -- ================================================================= H4–H6 dataset, formulário, lead e empresa certos
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_b, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H4 dataset de outra empresa: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_a, '999999999999999', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H5 ID de lead diferente do autorizado: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, '888888888888888', 'false'));
  perform public._ok(v_r like '23514:%', 'H5 formulário diferente do autorizado: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_b, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like 'P0002:%', 'H6 negociação de outra empresa (mesmo ID de lead): não encontrada');
  v_r := public._recusa(format(q, t_b, sup, n_a, lead_a, ds_b, form, 'false'));
  perform public._ok(v_r like 'P0002:%', 'H6 empresa B não alcança a negociação de A');

  -- ================================================================= H6b nunca um lead real
  v_r := public._recusa(format(q, t_a, sup, n_nome, '613456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%' and v_r like '%ferramenta de teste da Meta%', 'H6b nome "Homologação" digitado, sem a prova da Meta: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_anuncio, '623456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b lead que veio de um anúncio: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_outro_form, '633456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b lead de outro formulário: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_meta_velha, '643456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b lead criado na Meta há mais de 72 h: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_sem_criado, '653456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b lead sem o horário de criação da Meta: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_id_dif, '663456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b ID gravado pela Meta na planilha diferente: recusado');
  v_r := public._recusa(format(q, t_a, sup, n_movida, '673456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b negociação já movimentada no funil: recusada');
  v_r := public._recusa(format(q, t_a, sup, n_origem, '683456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b ID só numa origem adicional (negociação reaproveitada): recusado');
  v_r := public._recusa(format(q, t_a, sup, n_arq, '693456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b negociação arquivada: recusada');
  v_r := public._recusa(format(q, t_a, sup, n_funil_velho, '713456789012345', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'H6b entrada no funil há mais de 72 h: recusada');

  -- ================================================================= H7 conferência não grava nada
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_a, lead_a, ds_a, form, false);
  perform public._ok(v_p.nome_evento = 'Lead recebido' and v_p.id_evento = 'avante-homologacao-' || n_a and v_p.lead = lead_a
                     and v_p.dataset = ds_a and v_p.negocio = '700000000000001' and v_p.credencial is null and not v_p.ja_feita,
                     'H7 lead da ferramenta de teste: Lead recebido, event_id próprio, lead e dataset certos, sem credencial');
  perform public._ok(v_p.momento_unix = (select extract(epoch from min(h.created_at))::bigint from public.historico_etapas h
                                          where h.negociacao_id = n_a and h.etapa_anterior_id is null and h.etapa_nova_id = ea1),
                     'H7 ...horário = entrada real do lead na etapa inicial');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.meta_conversoes_homologacoes)
                     and not exists (select 1 from public.admin_auditoria where acao like 'capi_homologacao%'), 'H7 ...nada gravado, nada auditado');

  -- ================================================================= H8 reserva
  perform public._servico();
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_a, lead_a, ds_a, form, true);
  perform public._ok(v_p.homologacao is not null and v_p.credencial = 'token-sistema-alfa-xxxxxxxxxx', 'H8 reserva devolve a credencial da conexão (só ao servidor)');
  perform public._como(null, null);
  select * into v_h from public.meta_conversoes_homologacoes where id = v_p.homologacao;
  perform public._ok(v_h.situacao = 'enviando' and v_h.event_id = 'avante-homologacao-' || n_a and v_h.solicitado_por = sup and v_h.formulario_id = form,
                     'H8 ...registro em curso, com quem pediu e o formulário');
  perform public._ok((select count(*) = 1 from public.admin_auditoria where acao = 'capi_homologacao_iniciada' and tenant_id = t_a
                        and detalhes ->> 'event_id' = v_h.event_id and detalhes::text not like '%token%'), 'H8 ...auditado, sem credencial');

  -- ================================================================= H9 sem repetição
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'true'));
  perform public._ok(v_r like '23505:%', 'H9 mesma negociação de novo: recusada (sem reenvio)');
  v_r := public._recusa(format(q, t_a, sup, n_a2, '223456789012345', ds_a, form, 'true'));
  perform public._ok(v_r like '23505:%', 'H9 outro envio da mesma empresa enquanto um está em curso: recusado');

  -- ================================================================= H10 resultado ok
  perform public.capi_homologacao_concluir(v_p.homologacao, 'ok', null, 'trace-h1');
  perform public.capi_homologacao_concluir(v_p.homologacao, 'permanente', 'segunda chamada', null);
  perform public._como(null, null);
  select * into v_h from public.meta_conversoes_homologacoes where id = v_p.homologacao;
  perform public._ok(v_h.situacao = 'enviado' and v_h.resultado = 'ok' and v_h.fbtrace_id = 'trace-h1' and v_h.concluido_em is not null,
                     'H10 aceito pela Meta: enviado; a segunda conclusão não muda nada');
  perform public._ok((select situacao = 'configurando' and enviados = 0 and rejeitados = 0 and codigo_teste is null
                        from public.meta_conversoes_conexoes where id = v_con), 'H10 conexão intacta: configurando, contadores e código de teste iguais');
  perform public._ok((select count(*) from public.historico_etapas where negociacao_id = n_a) = v_hist
                     and (select etapa_id from public.negociacoes where id = n_a) = v_etapa, 'H10 negociação e histórico de etapas intactos');
  perform public._ok((select count(*) from public.meta_conversoes_eventos) = v_fila
                     and not exists (select 1 from public.meta_conversoes_eventos where event_id like 'avante-homologacao-%'), 'H10 fila geral intacta (nada entra nela)');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'capi_homologacao_concluida' and detalhes ->> 'resultado' = 'ok'), 'H10 ...conclusão auditada');

  -- ================================================================= H11 depois de feita
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'true'));
  perform public._ok(v_r like '23505:%', 'H11 negociação já homologada: nunca reenviada');
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_a, lead_a, ds_a, form, false);
  perform public._ok(v_p.ja_feita and v_p.credencial is null, 'H11 ...a conferência mostra que já foi feita');

  -- ================================================================= H12 erro da Meta nunca volta para fila
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_a2, '223456789012345', ds_a, form, true);
  perform public.capi_homologacao_concluir(v_p.homologacao, 'temporario', '500 Erro da Meta', null);
  perform public._como(null, null);
  perform public._ok((select situacao = 'rejeitado' and resultado = 'temporario' from public.meta_conversoes_homologacoes where id = v_p.homologacao),
                     'H12 erro temporário: rejeitado (sem nova tentativa automática)');
  perform public._servico();
  perform public._ok((select count(*) from public.capi_reservar(50)) = 0, 'H12 a fila geral não envia nada (conexão configurando)');

  -- ================================================================= H13 envio travado por mais de 10 minutos
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_a3, '323456789012345', ds_a, form, true);
  perform public._como(null, null);
  update public.meta_conversoes_homologacoes set created_at = now() - interval '11 minutes' where id = v_p.homologacao;
  perform public._servico();
  perform public.capi_homologacao_preparar(t_a, sup, n_a4, '423456789012345', ds_a, form, false);
  perform public._como(null, null);
  perform public._ok((select situacao = 'rejeitado' and ultimo_erro = 'Sem confirmação do envio.' from public.meta_conversoes_homologacoes where id = v_p.homologacao),
                     'H13 envio sem confirmação há mais de 10 min: encerrado como rejeitado');

  -- ================================================================= H14 limite diário
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, n_a4, '423456789012345', ds_a, form, 'true'));
  perform public._ok(v_r like 'RX010:%', 'H14 quarta homologação em 24 h: recusada pelo limite');

  -- ================================================================= H15 permissões
  perform public._como(sup, 'teste-alfa');
  v_r := public._recusa(format(q, t_a, sup, n_a, lead_a, ds_a, form, 'false'));
  perform public._ok(v_r like '42501:%', 'H15 nem o Super Admin chama direto do navegador (só o servidor)');
  v_r := public._recusa('select count(*) from public.meta_conversoes_homologacoes');
  perform public._ok(v_r like '42501:%', 'H15 tabela invisível para usuários');
  v_r := public._recusa(format($x$select public.capi_homologacao_concluir(%L, 'ok', null, null)$x$, v_p.homologacao));
  perform public._ok(v_r like '42501:%', 'H15 conclusão só pelo servidor');

  -- ================================================================= H16 auditoria limpa
  perform public._como(null, null);
  select count(*) into v_aud from public.admin_auditoria where acao like 'capi_homologacao%' and (detalhes::text like '%token-sistema%' or detalhes::text ilike '%test_event%');
  perform public._ok(v_aud = 0, 'H16 auditoria sem credencial e sem código de teste');
end;
$$;

rollback;
