set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: Central de Integrações (migration 20261104090000). ONDE RODAR: só
-- cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  C1–C2   permissão pelo plano (Business × Starter) e bloqueio no banco
--  C3–C6   exceções do Super Admin (liberar/bloquear/voltar ao plano), motivo, auditoria
--  C7      pedido de upgrade (só não liberada, sem duplicar, atendido ao liberar)
--  C8      leitura da Central: só Administrador, só a própria empresa
--  C9–C11  respostas dinâmicas: planilha, perguntas repetidas/vazias, outro envio, formulário por token
--  C12–C15 coexistência: eco do app, histórico (sem criar lead), recusa, contatos, isolamento
--  L1–L6   limites reais: números (os dois cartões somam), funis e permissões de quem define
--  L7–L10  cotas separadas: número de WhatsApp não gasta fontes; Starter só com formulários; credenciais
--  L11–L14 padrões aprovados dos planos, Meta Ads por plano, exceções do Super Admin (0, mais, menos), limite abaixo do uso
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
create function public._servico()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.headers', '{}', true);
  perform set_config('role', 'service_role', true);
end;
$$;
grant execute on function public._servico() to authenticated, service_role;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  sdr_a uuid := '60000000-0000-4000-8000-0000000000a3';
  c_a   uuid := '60000000-0000-4000-8000-0000000000a2';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  sa    uuid := '60000000-0000-4000-8000-0000000000ff';
  g_g   uuid := '566e6b59-3748-4ad5-b684-8c6c3a1395f6';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  t_g   uuid := '741bb627-472f-4511-ba1c-81e3dbf5c6dd';
  fa1 uuid; ea1 uuid; fg1 uuid; eg1 uuid;
  v_r text; v_fs uuid; v_j jsonb; v_neg uuid; v_neg2 uuid; n_co uuid;
  v_uso integer; sdr uuid := '60000000-0000-4000-8000-0000000000a3';
begin
  perform public._como(null, null);
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into fg1 from public.funis where tenant_id = t_g and padrao;
  select id into eg1 from public.etapas_funil where funil_id = fg1 and etapa_inicial;
  update public.plataforma_integracoes set google_sheets = true, whatsapp_oficial = true, meta_conversoes = true;
  delete from public.empresa_integracoes_regras where tenant_id in (t_a, t_b, t_g);
  -- Ambiente local de teste: limites definidos por empresa (os planos locais não têm quantidades).
  delete from public.empresa_limites where tenant_id in (t_a, t_b, t_g);
  insert into public.empresa_limites (tenant_id, recurso, limite, motivo)
  select t, r, 100, 'ambiente local de teste' from unnest(array[t_a, t_b, t_g]) t cross join unnest(array['fontes', 'numeros_whatsapp', 'funis']) r;
  -- Padrões que a migration gravou nos planos (conferidos em L11). Os cenários C1–C10
  -- partem de um Starter SEM recursos, para provar as regras de permissão.
  create temp table _padroes on commit drop as
    select codigo, limite_usuarios, limite_integracoes, limite_funis, limite_numeros_whatsapp, recursos from public.planos;
  update public.planos set recursos = array['metas'] where codigo = 'starter';
  -- L1–L10 testam "limite a definir" (nulo no plano): números e funis começam sem quantidade.
  update public.planos set limite_numeros_whatsapp = null, limite_funis = null;

  -- ================================================================= C1–C2 plano
  perform public._ok(public.integracao_permitida('google_sheets', t_a) and public.integracao_permitida('whatsapp_oficial', t_a)
                     and public.integracao_permitida('meta_conversoes', t_a), 'C1 Business: Sheets, WhatsApp e Meta Ads liberados pelo plano');
  perform public._ok(not public.integracao_permitida('google_sheets', t_g) and not public.integracao_permitida('whatsapp_oficial', t_g)
                     and not public.integracao_permitida('meta_conversoes', t_g) and not public.integracao_permitida('formularios', t_g),
                     'C1 Starter: nada disso no plano');
  perform public._ok(not public.integracao_habilitada('whatsapp_oficial', t_g) and public.integracao_lancada('whatsapp_oficial', t_g),
                     'C1 lançada na plataforma, mas não habilitada para a empresa sem o recurso');
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook Gama', 'ativa', %L, %L, %L)$q$, t_g, fg1, eg1, g_g));
  perform public._ok(v_r like 'RX003:%', 'C2 banco recusa ativar fonte fora do plano (não é só a tela)');

  -- ================================================================= C3–C6 exceções
  perform public._como(g_g, 'gama-nova');
  v_r := public._recusa(format('select public.admin_definir_integracao_empresa(%L, %L, %L, %L)', t_g, 'formularios', 'liberar', 'teste'));
  perform public._ok(v_r like '42501:%', 'C3 Administrador da empresa não abre exceção para si');
  perform public._como(sa, null);
  v_r := public._recusa(format('select public.admin_definir_integracao_empresa(%L, %L, %L, %L)', t_g, 'formularios', 'liberar', '  '));
  perform public._ok(v_r like '22023:%motivo%', 'C4 exceção exige motivo');
  perform public.admin_definir_integracao_empresa(t_g, 'formularios', 'liberar', 'Cortesia comercial de teste');
  perform public._como(null, null);
  perform public._ok(public.integracao_permitida('formularios', t_g), 'C4 Super Admin libera formulários para a Gama (exceção)');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'integracao_empresa_regra_definida' and tenant_id = t_g
                                and detalhes ->> 'depois' = 'liberar' and detalhes ->> 'motivo' like 'Cortesia%'), 'C4 ...auditada com motivo');
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook Gama', 'ativa', %L, %L, %L)$q$, t_g, fg1, eg1, g_g));
  perform public._ok(v_r = 'aceito', 'C4 ...e o banco passa a aceitar a fonte');

  perform public._como(sa, null);
  perform public.admin_definir_integracao_empresa(t_a, 'google_sheets', 'bloquear', 'Inadimplência (teste)');
  perform public._como(null, null);
  perform public._ok(not public.integracao_habilitada('google_sheets', t_a) and public.integracao_permitida('whatsapp_oficial', t_a),
                     'C5 bloqueio de uma integração vale mesmo com o plano incluindo (e só para ela)');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select not google_sheets and whatsapp_oficial from public.integracoes_habilitadas()), 'C5 ...a tela e as conexões da empresa veem Sheets desligado');
  perform public._como(sa, null);
  perform public.admin_definir_integracao_empresa(t_a, 'google_sheets', 'plano', null);
  perform public._como(null, null);
  perform public._ok(public.integracao_habilitada('google_sheets', t_a) and not exists (select 1 from public.empresa_integracoes_regras where tenant_id = t_a),
                     'C6 "voltar ao plano" remove a exceção');
  update public.plataforma_integracoes set meta_conversoes = false;
  perform public._ok(not public.integracao_habilitada('meta_conversoes', t_a) and public.integracao_permitida('meta_conversoes', t_a),
                     'C6 chave global desligada vence o plano (não lançada = não funciona)');
  update public.plataforma_integracoes set meta_conversoes = true;

  -- ================================================================= C7 upgrade
  perform public._como(g_g, 'gama-nova');
  perform public._ok(public.solicitar_integracao('whatsapp_oficial'), 'C7 Gama pede WhatsApp (fora do plano)');
  perform public.solicitar_integracao('whatsapp_oficial');
  perform public._como(null, null);
  perform public._ok((select count(*) = 1 from public.integracoes_solicitacoes where tenant_id = t_g and integracao = 'whatsapp_oficial' and situacao = 'aberta'),
                     'C7 ...pedido repetido não duplica');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(not public.solicitar_integracao('google_sheets'), 'C7 integração já liberada não gera pedido');
  perform public._como(sa, null);
  perform public._ok((select solicitada_em is not null from public.admin_central_integracoes(t_g) where integracao = 'whatsapp_oficial'),
                     'C7 Super Admin vê o pedido no painel da empresa');
  perform public.admin_definir_integracao_empresa(t_g, 'whatsapp_oficial', 'liberar', 'Upgrade aprovado (teste)');
  perform public._como(null, null);
  perform public._ok((select situacao = 'atendida' from public.integracoes_solicitacoes where tenant_id = t_g and integracao = 'whatsapp_oficial'),
                     'C7 ...liberar atende o pedido');

  -- ================================================================= C8 leitura
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) = 4 and bool_and(lancada) from public.central_integracoes_empresa()), 'C8 Administrador lê as 4 integrações da própria empresa (o WhatsApp oficial é uma só, com dois cartões na tela)');
  perform public._ok((select em_uso > 0 from public.central_integracoes_empresa() where integracao = 'google_sheets'), 'C8 ...com o uso real (planilhas)');
  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa('select * from public.central_integracoes_empresa()');
  perform public._ok(v_r like '42501:%', 'C8 SDR não lê a Central');
  perform public._como(g_a, 'teste-beta');
  v_r := public._recusa('select * from public.central_integracoes_empresa()');
  perform public._ok(v_r <> 'aceito', 'C8 Administrador da Alfa não lê a Central da Beta');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select * from public.admin_central_integracoes(%L)', t_b));
  perform public._ok(v_r like '42501:%', 'C8 painel do Super Admin é só do Super Admin');

  -- ================================================================= C9–C11 respostas
  perform public._como(null, null);
  select f.id into v_fs from public.fontes_leads f where f.tenant_id = t_a and f.tipo = 'google_sheets' and f.status = 'ativa' limit 1;
  update public.fontes_google_sheets set importar_existentes = true where fonte_id = v_fs;
  perform public._servico();
  v_j := public.sheets_processar_linhas(v_fs, jsonb_build_array(
    jsonb_build_object('chave', 'id:central-1', 'linha', 2, 'nome', 'Lia Formulário', 'telefone', '11977770001', 'email', null,
                       'respostas', jsonb_build_array(
                         jsonb_build_object('pergunta', 'Qual o seu orçamento?', 'resposta', 'R$ 5 mil'),
                         jsonb_build_object('pergunta', 'Observação', 'resposta', 'Prefere manhã'),
                         jsonb_build_object('pergunta', 'Observação', 'resposta', 'Tem sócio'),
                         jsonb_build_object('pergunta', 'Cidade', 'resposta', '   '),
                         jsonb_build_object('pergunta', 'Carimbo de data/hora', 'resposta', '28/10/2026 10:00:00')))), false);
  perform public._como(null, null);
  select negociacao_id into v_neg from public.fontes_google_sheets_linhas where fonte_id = v_fs and chave = 'id:central-1';
  perform public._ok(v_neg is not null and (v_j ->> 'importadas')::integer = 1, 'C9 linha da planilha vira lead');
  perform public._ok((select count(*) = 4 from public.negociacao_respostas where negociacao_id = v_neg), 'C9 todas as perguntas preenchidas guardadas (vazia ignorada)');
  perform public._ok(exists (select 1 from public.negociacao_respostas where negociacao_id = v_neg and chave = 'observacao_2' and resposta = 'Tem sócio'),
                     'C9 pergunta repetida não sobrescreve a primeira');
  perform public._ok(exists (select 1 from public.negociacao_respostas where negociacao_id = v_neg and chave = 'qual_o_seu_orcamento'), 'C9 chave normalizada sem acento');

  perform public.registrar_respostas_lead(t_a, v_neg, v_fs, 'gs:id:central-1', '[{"pergunta":"Qual o seu orçamento?","resposta":"R$ 6 mil"}]');
  perform public._ok((select count(*) = 4 from public.negociacao_respostas where negociacao_id = v_neg)
                     and (select resposta = 'R$ 6 mil' from public.negociacao_respostas where negociacao_id = v_neg and chave = 'qual_o_seu_orcamento'),
                     'C10 mesmo envio reprocessado atualiza, não duplica');
  perform public._servico();
  perform public.sheets_processar_linhas(v_fs, jsonb_build_array(
    jsonb_build_object('chave', 'id:central-2', 'linha', 3, 'nome', 'Lia Formulário', 'telefone', '11977770001',
                       'respostas', jsonb_build_array(jsonb_build_object('pergunta', 'Qual o seu orçamento?', 'resposta', 'R$ 10 mil'),
                                                      jsonb_build_object('pergunta', 'Nova coluna', 'resposta', 'Valor novo')))), false);
  perform public._como(null, null);
  select negociacao_id into v_neg2 from public.fontes_google_sheets_linhas where fonte_id = v_fs and chave = 'id:central-2';
  perform public._ok(v_neg2 = v_neg and (select count(*) = 6 from public.negociacao_respostas where negociacao_id = v_neg),
                     'C10 novo envio do mesmo contato: mesma negociação, respostas anteriores preservadas, coluna nova aceita');

  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) = 6 from public.respostas_da_negociacao(v_neg)), 'C11 Administrador vê as perguntas e respostas no lead');
  perform public._como(g_b, 'teste-beta');
  perform public._ok((select count(*) = 0 from public.negociacao_respostas where negociacao_id = v_neg), 'C11 outra empresa não vê as respostas');
  perform public._como(null, null);
  select r.negociacao_id into v_neg from public.ingerir_lead_nucleo(t_a, 'formulario', 'respondi:central-3', fa1, ea1, g_a, null, null,
    'Rui Respondi', '11977770003', null, null, null,
    '[{"pergunta_externa":"Qual seu segmento?","resposta":"Clínica"},{"pergunta_externa":"Urgência","resposta":"Alta"}]'::jsonb, null) r;
  perform public._ok((select count(*) = 2 from public.negociacao_respostas where negociacao_id = v_neg and envio = 'respondi:central-3'),
                     'C11 formulário por token sem perguntas cadastradas: respostas guardadas (antes eram descartadas)');

  -- ================================================================= C12–C15 coexistência
  perform public._servico();
  n_co := public.whatsapp_salvar_numero(t_a, g_a, '530000000000091', '630000000000091', '+55 11 4300-0091', 'Alfa', 'token-meta-coex-central', 'WA App Central', fa1, ea1, c_a, 'coexistencia');
  v_j := public.whatsapp_registrar_mensagens_app('530000000000091', 'eco_app',
    '[{"id":"wamid.ECO1","telefone":"5511955880001","tipo":"text","texto":"Olá, enviado do celular","em":"2026-10-28T12:00:00Z"}]');
  perform public._como(null, null);
  perform public._ok((v_j ->> 'novas')::integer = 1 and exists (select 1 from public.mensagens where whatsapp_message_id = 'wamid.ECO1'
                                                                  and direcao = 'saida' and origem_app = 'eco_app'),
                     'C12 eco do app entra como mensagem ENVIADA na conversa');
  perform public._ok(not exists (select 1 from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.tenant_id = t_a and c.telefone like '%955880001'),
                     'C12 ...sem criar lead (quem iniciou foi a empresa)');
  perform public._servico();
  v_j := public.whatsapp_registrar_mensagens_app('530000000000091', 'eco_app', '[{"id":"wamid.ECO1","telefone":"5511955880001","tipo":"text","texto":"x"}]');
  perform public._ok((v_j ->> 'duplicadas')::integer = 1, 'C12 eco repetido não duplica');

  perform public.whatsapp_sincronizacao_registrar(n_co, 'historico', true, 'req-1', null);
  perform public.whatsapp_historico_andamento('530000000000091', 0, 40, false);
  v_j := public.whatsapp_registrar_mensagens_app('530000000000091', 'historico',
    '[{"id":"wamid.H1","telefone":"5511955880002","da_empresa":false,"tipo":"text","texto":"Quero orçamento","em":"2026-06-01T10:00:00Z","status":"READ"},
      {"id":"wamid.H2","telefone":"5511955880002","da_empresa":true,"tipo":"text","texto":"Claro!","em":"2026-06-01T10:05:00Z","status":"DELIVERED"},
      {"id":"wamid.H3","telefone":"5511955880002","da_empresa":false,"tipo":"media_placeholder","em":"2026-06-01T10:06:00Z"}]');
  perform public._como(null, null);
  perform public._ok((v_j ->> 'novas')::integer = 3 and (select count(*) = 3 from public.mensagens m join public.conversas c on c.id = m.conversa_id
                                                          where c.telefone like '%955880002' and m.origem_app = 'historico'),
                     'C13 histórico entra na conversa (entrada e saída)');
  perform public._ok(not exists (select 1 from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.tenant_id = t_a and c.telefone like '%955880002'),
                     'C13 ...histórico NÃO cria negociação');
  perform public._ok((select situacao = 'recebendo' and progresso = 40 and mensagens = 3 from public.whatsapp_sincronizacoes where numero_id = n_co and tipo = 'historico'),
                     'C13 andamento do histórico registrado');
  perform public._servico();
  perform public.whatsapp_historico_andamento('530000000000091', null, null, true);
  perform public._como(null, null);
  perform public._ok((select situacao = 'recusada' from public.whatsapp_sincronizacoes where numero_id = n_co and tipo = 'historico'),
                     'C14 empresa recusou compartilhar o histórico: fica registrado, sem inventar mensagens');
  perform public._servico();
  perform public.whatsapp_registrar_contatos_app('530000000000091', '[{"telefone":"5511955880003","nome":"Contato do App","acao":"add"}]');
  v_j := public.whatsapp_registrar_mensagens_app('530000000000091', 'eco_app', '[{"id":"wamid.ECO3","telefone":"5511955880003","tipo":"text","texto":"Oi"}]');
  perform public._como(null, null);
  perform public._ok((select nome_contato = 'Contato do App' from public.conversas where telefone like '%955880003' and whatsapp_numero_id = n_co),
                     'C14 contatos do app dão nome à conversa (sem virar lead)');
  perform public._servico();
  v_j := public.whatsapp_registrar_mensagens_app('530000000000001', 'eco_app', '[{"id":"wamid.ECO9","telefone":"5511966669999","tipo":"text","texto":"x"}]');
  perform public._ok(v_j ? 'ignorado', 'C15 eco para número fora da coexistência é ignorado');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.mensagens where whatsapp_message_id in ('wamid.ECO1', 'wamid.H1')), 'C15 outra empresa não vê ecos nem histórico');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_registrar_mensagens_app(%L, %L, %L)', '530000000000091', 'eco_app', '[]'));
  perform public._ok(v_r like '42501:%', 'C15 só o servidor grava ecos e histórico');

  -- ================================================================= L1–L6 limites reais (números, fontes e funis)
  perform public._como(null, null);
  delete from public.empresa_limites where tenant_id = t_a and recurso = 'numeros_whatsapp';
  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000081', '630000000000081', '+55 11 4300-0081', 'Alfa', 'tok-l1', 'WA L1', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like 'RX002:%ainda não foi definido%', 'L1 plano sem limite de números cadastrado: número NOVO bloqueado (ausência não é ilimitado)');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.whatsapp_numeros where tenant_id = t_a and situacao <> 'desconectado') > 0, 'L1 ...números que já estavam conectados continuam');
  v_uso := public.uso_numeros_whatsapp(t_a);
  insert into public.empresa_limites (tenant_id, recurso, limite, motivo) values (t_a, 'numeros_whatsapp', v_uso + 1, 'teste de limite');
  perform public._servico();
  perform public.whatsapp_salvar_numero(t_a, g_a, '530000000000082', '630000000000082', '+55 11 4300-0082', 'Alfa', 'tok-l2', 'WA L2', fa1, ea1, c_a, 'coexistencia');
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000083', '630000000000083', '+55 11 4300-0083', 'Alfa', 'tok-l3', 'WA L3', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like 'RX002:%atingido%', 'L2 app existente (coexistência) e número novo somam no MESMO limite de números');
  perform public._como(g_b, 'teste-beta');
  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000082', '630000000000099', '+55 11 4300-0082', 'Beta', 'tok-l4', 'WA L4', null, null, null)$q$, t_b, g_b));
  perform public._ok(v_r <> 'aceito', 'L2 o mesmo número (phone_number_id) não conecta em outra empresa');
  perform public._como(null, null);
  update public.empresa_limites set limite = 100 where tenant_id = t_a and recurso = 'numeros_whatsapp';

  -- Funis: o 1º é sempre permitido; sem limite definido, o 2º é bloqueado; os existentes continuam.
  delete from public.empresa_limites where tenant_id = t_a and recurso = 'funis';
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.duplicar_funil(%L, %L)', fa1, 'Funil extra (teste)'));
  perform public._ok(v_r like 'RX002:%funis%ainda não foi definido%', 'L3 funil NOVO bloqueado quando o plano não define a quantidade de funis');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.funis where tenant_id = t_a and ativo) >= 1, 'L3 ...os funis que já existem continuam');
  insert into public.empresa_limites (tenant_id, recurso, limite, motivo)
  values (t_a, 'funis', (select count(*) from public.funis where tenant_id = t_a and ativo) + 1, 'teste de limite');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.duplicar_funil(%L, %L)', fa1, 'Funil extra (teste)'));
  perform public._ok(v_r = 'aceito', 'L4 com limite definido, o funil novo entra');
  v_r := public._recusa(format('select public.duplicar_funil(%L, %L)', fa1, 'Funil extra 2 (teste)'));
  perform public._ok(v_r like 'RX002:%funis%atingido%', 'L4 ...e o seguinte passa do limite: bloqueado');
  perform public._como(null, null);
  perform public._ok((select count(*) = 0 from public.funis f where f.tenant_id = t_g and f.ativo) or exists (select 1 from public.funis where tenant_id = t_g and ativo),
                     'L5 empresa nova recebe sempre o 1º funil (estrutura inicial)');
  perform public._como(sa, null);
  v_r := public._recusa(format('select public.admin_definir_limite_empresa(%L, %L, 5, %L)', t_a, 'funis', ' '));
  perform public._ok(v_r like '22023:%motivo%', 'L6 limite próprio da empresa exige motivo');
  perform public.admin_definir_limites_plano('business', null, null);
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.admin_definir_limite_empresa(%L, %L, 50, %L)', t_a, 'numeros_whatsapp', 'x'));
  perform public._ok(v_r like '42501:%', 'L6 Administrador da empresa não muda o próprio limite');
  v_r := public._recusa('select public.admin_definir_limites_plano(''business'', 9, 9)');
  perform public._ok(v_r like '42501:%', 'L6 ...nem os limites do plano');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'limite_empresa_definido' and tenant_id = t_a), 'L6 limite da empresa auditado');

  -- ================================================================= L7–L10 cotas separadas (fontes × números × funis)
  perform public._como(null, null);
  v_uso := public.uso_fontes(t_a);
  update public.empresa_limites set limite = v_uso where tenant_id = t_a and recurso = 'fontes';          -- fontes: cota cheia
  update public.empresa_limites set limite = public.uso_numeros_whatsapp(t_a) + 1 where tenant_id = t_a and recurso = 'numeros_whatsapp';
  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000084', '630000000000084', '+55 11 4300-0084', 'Alfa', 'tok-l7', 'WA L7', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r = 'aceito', 'L7 com a cota de FONTES cheia, um número de WhatsApp novo ainda conecta (usa só a cota de números)');
  perform public._como(null, null);
  perform public._ok(public.uso_fontes(t_a) = v_uso, 'L7 ...e não gasta a cota de fontes (a fonte whatsapp_cloud não conta)');
  perform public._ok(public.uso_integracoes(t_a) = public.uso_fontes(t_a), 'L7 nome antigo (uso_integracoes) = mesma conta de fontes');
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook L7', 'ativa', %L, %L, %L)$q$, t_a, fa1, ea1, g_a));
  perform public._ok(v_r like 'RX002:%fontes de captação%atingido%', 'L8 formulário/webhook novo barrado pela cota de FONTES cheia');
  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000085', '630000000000085', '+55 11 4300-0085', 'Alfa', 'tok-l8', 'WA L8', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like 'RX002:%números de WhatsApp%atingido%', 'L8 ...e número além da cota de NÚMEROS barrado pela cota de números (independentes)');
  perform public._como(null, null);
  update public.empresa_limites set limite = 100 where tenant_id = t_a and recurso in ('fontes', 'numeros_whatsapp');

  -- Starter: captação só por formulário (recurso `formularios`) sem abrir Google Sheets nem WhatsApp.
  delete from public.empresa_integracoes_regras where tenant_id = t_g;
  perform public._ok(not public.integracao_permitida('formularios', t_g), 'L9 Starter sem recurso de captação: formulários fora do plano');
  update public.planos set recursos = array_append(recursos, 'formularios') where codigo = 'starter';
  perform public._ok(public.integracao_permitida('formularios', t_g) and not public.integracao_permitida('google_sheets', t_g)
                     and not public.integracao_permitida('whatsapp_oficial', t_g) and not public.integracao_permitida('meta_conversoes', t_g),
                     'L9 com `formularios` no plano: só formulários liberados (Sheets, WhatsApp e Meta continuam fora)');
  delete from public.empresa_limites where tenant_id = t_g and recurso = 'fontes';
  update public.planos set limite_integracoes = null where codigo = 'starter';
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook L9', 'ativa', %L, %L, %L)$q$, t_g, fg1, eg1, g_g));
  perform public._ok(v_r like 'RX002:%fontes de captação%ainda não foi definido%', 'L9 ...mas sem quantidade de fontes definida no plano, nenhuma fonte nova (não é ilimitado)');
  update public.planos set limite_integracoes = public.uso_fontes(t_g) + 1 where codigo = 'starter';
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook L9', 'ativa', %L, %L, %L)$q$, t_g, fg1, eg1, g_g));
  perform public._ok(v_r = 'aceito', 'L9 com a quantidade contratada definida, o formulário entra');
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook L9b', 'ativa', %L, %L, %L)$q$, t_g, fg1, eg1, g_g));
  perform public._ok(v_r like 'RX002:%atingido%', 'L9 ...e o seguinte passa da quantidade contratada');
  update public.planos set limite_integracoes = 100 where codigo = 'starter';
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'google_sheets', 'Planilha L9', 'ativa', %L, %L, %L)$q$, t_g, fg1, eg1, g_g));
  perform public._ok(v_r like 'RX003:%', 'L9 ...planilha (Google Sheets) continua barrada no banco');
  v_r := public._recusa(format($q$insert into public.ingestao_credenciais (tenant_id, nome, prefixo, segredo_hash) values (%L, 'Respondi L9', 'rx7_l9', '\x00')$q$, t_g));
  perform public._ok(v_r = 'aceito', 'L10 credencial de ingestão (Respondi) segue a permissão de formulários');
  perform public._ok(public.uso_fontes(t_g) >= 3, 'L10 ...e entra na mesma cota de fontes');
  update public.planos set recursos = array_remove(recursos, 'formularios') where codigo = 'starter';
  v_r := public._recusa(format($q$insert into public.ingestao_credenciais (tenant_id, nome, prefixo, segredo_hash) values (%L, 'Respondi L10', 'rx7_l10', '\x00')$q$, t_g));
  perform public._ok(v_r like 'RX003:%', 'L10 sem o recurso no plano, credencial nova recusada');
  perform public._como(sa, null);
  perform public.admin_definir_integracao_empresa(t_g, 'formularios', 'liberar', 'formulários contratados à parte (teste)');
  perform public._ok(public.integracao_permitida('formularios', t_g) and not public.integracao_permitida('google_sheets', t_g),
                     'L10 exceção do Super Admin libera só formulários, auditada');
  v_r := public._recusa(format('select public.admin_definir_limite_empresa(%L, %L, 3, %L)', t_a, 'integracoes', 'nome antigo'));
  perform public._ok(v_r like '22023:%', 'L10 recurso de limite só aceita fontes, numeros_whatsapp ou funis');
  perform public._como(null, null);

  -- ================================================================= L11–L14 padrões aprovados e exceções do Super Admin
  perform public._ok((select limite_usuarios = 1 and limite_integracoes = 1 and limite_funis = 1 and limite_numeros_whatsapp = 1
                             and recursos @> array['formularios', 'whatsapp'] and not (recursos && array['ingestao_leads', 'meta_conversoes'])
                        from _padroes where codigo = 'starter'), 'L11 Starter: 1 usuário, 1 fonte, 1 funil, 1 número; formulário básico sem Google Sheets; sem Meta Ads');
  perform public._ok((select limite_usuarios = 3 and limite_integracoes = 3 and limite_funis = 3 and limite_numeros_whatsapp = 3
                             and recursos @> array['ingestao_leads', 'whatsapp'] and not ('meta_conversoes' = any (recursos))
                        from _padroes where codigo = 'pro'), 'L11 Pro: 3/3/3/3; Meta Ads fora do plano (só liberação individual)');
  perform public._ok((select limite_usuarios = 10 and limite_integracoes = 10 and limite_funis = 10 and limite_numeros_whatsapp = 10
                             and recursos @> array['ingestao_leads', 'whatsapp', 'meta_conversoes']
                        from _padroes where codigo = 'business'), 'L11 Business: 10/10/10/10 com Meta Ads no plano');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'planos_padroes_aprovados'), 'L11 definição dos padrões registrada na auditoria');
  update public.planos p set limite_usuarios = d.limite_usuarios, limite_integracoes = d.limite_integracoes, limite_funis = d.limite_funis,
         limite_numeros_whatsapp = d.limite_numeros_whatsapp, recursos = d.recursos from _padroes d where d.codigo = p.codigo;
  perform public._ok(public.integracao_permitida('whatsapp_oficial', t_g) and public.integracao_permitida('formularios', t_g)
                     and not public.integracao_permitida('google_sheets', t_g), 'L11 Starter com os padrões: WhatsApp e formulário no plano, Google Sheets não');
  update public.plataforma_integracoes set whatsapp_oficial = false;
  perform public._ok(not public.integracao_habilitada('whatsapp_oficial', t_g) and not public.integracao_habilitada('whatsapp_oficial', t_a),
                     'L11 cota disponível não liga nada: com a chave global desligada, WhatsApp fica indisponível para todos');
  update public.plataforma_integracoes set whatsapp_oficial = true;

  -- Meta Ads: Starter nunca (nem por exceção); Pro só com liberação individual; Business no plano.
  delete from public.empresa_integracoes_regras where tenant_id in (t_a, t_g);
  perform public._como(sa, null);
  v_r := public._recusa(format('select public.admin_definir_integracao_empresa(%L, %L, %L, %L)', t_g, 'meta_conversoes', 'liberar', 'pedido do cliente'));
  perform public._ok(v_r like 'RX003:%Starter%', 'L12 Super Admin não consegue liberar Meta Ads para empresa Starter');
  perform public._como(null, null);
  insert into public.empresa_integracoes_regras (tenant_id, integracao, regra, motivo) values (t_g, 'meta_conversoes', 'liberar', 'forçado direto no banco');
  perform public._ok(not public.integracao_permitida('meta_conversoes', t_g) and not public.meta_conversoes_elegivel(t_g),
                     'L12 ...nem uma regra gravada direto no banco libera Meta para Starter');
  delete from public.empresa_integracoes_regras where tenant_id = t_g;
  update public.assinaturas set plano_id = (select id from public.planos where codigo = 'pro') where tenant_id = t_g;
  perform public._ok(not public.integracao_permitida('meta_conversoes', t_g), 'L12 Pro sem liberação: Meta Ads indisponível');
  perform public._como(sa, null);
  perform public.admin_definir_integracao_empresa(t_g, 'meta_conversoes', 'liberar', 'liberação individual aprovada (teste)');
  perform public._como(null, null);
  perform public._ok(public.integracao_permitida('meta_conversoes', t_g), 'L12 Pro com liberação individual do Super Admin: Meta Ads permitido');
  perform public._ok(public.integracao_permitida('meta_conversoes', t_a), 'L12 Business: Meta Ads incluído no plano');
  delete from public.empresa_integracoes_regras where tenant_id = t_g;
  update public.assinaturas set plano_id = (select id from public.planos where codigo = 'starter') where tenant_id = t_g;

  -- Exceção individual prevalece sobre o padrão; 0 é aceito; vazio volta ao padrão.
  delete from public.empresa_limites where tenant_id = t_a;
  perform public._como(sa, null);
  perform public._ok((select count(*) = 3 and bool_and(padrao = 10 and excecao is null and efetivo = 10 and efetivo_definido)
                        from public.admin_limites_empresa(t_a)), 'L13 sem exceção: as 3 cotas valem o padrão do plano (Business 10)');
  perform public.admin_definir_limite_empresa(t_a, 'fontes', 0, 'fontes suspensas (teste)');
  perform public._ok((select excecao = 0 and efetivo = 0 and padrao = 10 from public.admin_limites_empresa(t_a) where recurso = 'fontes'),
                     'L13 exceção 0 aceita e prevalece sobre o padrão');
  perform public._como(null, null);
  v_uso := public.uso_fontes(t_a);
  v_r := public._recusa(format($q$insert into public.fontes_leads (tenant_id, tipo, nome, status, funil_id, etapa_id, responsavel_id)
                                 values (%L, 'webhook', 'Webhook L13', 'ativa', %L, %L, %L)$q$, t_a, fa1, ea1, g_a));
  perform public._ok(v_r like 'RX002:%atingido (0)%', 'L13 ...fonte nova barrada');
  perform public._ok(public.uso_fontes(t_a) = v_uso and v_uso > 0, 'L13 ...e as fontes que já existiam continuam ativas (nada excluído)');
  perform public._como(sa, null);
  perform public.admin_definir_limite_empresa(t_a, 'fontes', 25, 'campanha (teste)');
  perform public._ok((select efetivo = 25 from public.admin_limites_empresa(t_a) where recurso = 'fontes'), 'L13 exceção também aumenta acima do padrão');
  perform public.admin_definir_limite_empresa(t_a, 'fontes', null, null);
  perform public._ok((select excecao is null and efetivo = 10 from public.admin_limites_empresa(t_a) where recurso = 'fontes'), 'L13 vazio remove a exceção: volta ao padrão');
  perform public._como(null, null);
  perform public._ok((select count(*) >= 3 from public.admin_auditoria where tenant_id = t_a and acao in ('limite_empresa_definido', 'limite_empresa_removido')
                        and detalhes ->> 'recurso' = 'fontes'), 'L13 cada mudança individual auditada');

  -- Reduzir abaixo do uso: preserva números e funis, só barra os novos.
  perform public._como(null, null);
  v_uso := public.uso_numeros_whatsapp(t_a);
  perform public._ok(v_uso >= 1, 'L14 preparo: a empresa tem número(s) conectado(s)');
  perform public._como(sa, null);
  perform public.admin_definir_limite_empresa(t_a, 'numeros_whatsapp', 0, 'redução comercial (teste)');
  perform public._ok((select uso = v_uso and efetivo = 0 from public.admin_limites_empresa(t_a) where recurso = 'numeros_whatsapp'),
                     'L14 painel mostra uso acima do limite (para o aviso)');
  perform public._como(null, null);
  perform public._ok(public.uso_numeros_whatsapp(t_a) = v_uso, 'L14 números conectados continuam (nada desconectado ou excluído)');
  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000086', '630000000000086', '+55 11 4300-0086', 'Alfa', 'tok-l14', 'WA L14', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like 'RX002:%números de WhatsApp%', 'L14 ...número novo barrado');
  perform public._como(null, null);
  v_uso := (select count(*) from public.funis where tenant_id = t_a and ativo);
  perform public._como(sa, null);
  perform public.admin_definir_limite_empresa(t_a, 'funis', 1, 'redução (teste)');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.duplicar_funil(%L, %L)', fa1, 'Funil L14'));
  perform public._ok(v_r like 'RX002:%funis%', 'L14 funil novo barrado com o limite reduzido');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.funis where tenant_id = t_a and ativo) = v_uso and v_uso > 1, 'L14 ...e os funis existentes continuam ativos');

  raise notice 'central_integracoes_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
