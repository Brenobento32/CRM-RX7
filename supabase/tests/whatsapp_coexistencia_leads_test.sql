set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: WhatsApp — coexistência oficial, inicialização do número, leads e
-- histórico (migration 20261114090000). ONDE RODAR: só cópia LOCAL crm_rx7_*.
-- Termina em ROLLBACK.
--
--  X1      chave global DESLIGADA + só a empresa A na lista de homologação
--  FASE 1 — número do app em INICIALIZAÇÃO
--  I1      número do app nasce em inicialização; número novo (Cloud API) não
--  I2–I4   contato antigo escrevendo: conversa visível, sem lead, "origem a
--          revisar"; cliente já cadastrado: sem nova oportunidade; repetido
--  I5      revisão manual: "não é lead novo" e "levar para o funil"
--  X8–X10  histórico: ignorado sem autorização; só Administrador, uma vez,
--          auditado; não cria lead nem abre a janela; confirma contato antigo
--  I6–I9   concluir: espera contatos e histórico; só Administrador; agenda
--          guardada; histórico não pode mais ser pedido
--  FASE 2 — inicialização CONCLUÍDA
--  I10–I13 agenda → revisão; contato novo → lead; cliente com negócio
--          encerrado → nova oportunidade; contato confirmado antigo → sem lead
--  X2–X5   primeiro contato vira lead; repetido não duplica; mensagens
--          seguintes não inflam a negociação; anúncio Click-to-WhatsApp
--  X6–X7   eco do app: sem lead, nem quando o contato responde; janela
--  X12     evento de status não cria lead
--  X14     rótulos de mensagem sem texto / não suportada
--  X15–X16 "Levar para o funil", fonte pausada e nova tentativa
--  X17     isolamento entre empresas, view de mensagens, permissões
--  FASE 3 — reconexão
--  X11     prazo de 24 h; reconexão recomeça a inicialização
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
-- Quantas negociações o contato (telefone) tem na empresa.
create function public._negs(p_tenant uuid, p_tel text)
returns integer language sql as $$
  select count(*)::integer from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.tenant_id = p_tenant and c.telefone = p_tel
$$;
grant execute on function public._negs(uuid, text) to authenticated, service_role;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  c_a   uuid := '60000000-0000-4000-8000-0000000000a2';
  sdr_a uuid := '60000000-0000-4000-8000-0000000000a3';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  ph    text := '580000000000001';
  fa1 uuid; ea1 uuid; ea_perdida uuid;
  n_co uuid; n_cl uuid; v_fonte uuid; v_j jsonb; v_r text; v_conv uuid; v_conv2 uuid; v_cli uuid; v_neg uuid; v_neg2 uuid;
  v_negs integer; v_eventos integer; v_origens integer; v_ph text; v_convs integer;
begin
  perform public._como(null, null);
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_perdida from public.etapas_funil where funil_id = fa1 and tipo = 'perdida' and ativo;
  delete from public.empresa_limites where tenant_id in (t_a, t_b);
  insert into public.empresa_limites (tenant_id, recurso, limite, motivo)
  select t, r, 100, 'ambiente local de teste' from unnest(array[t_a, t_b]) t cross join unnest(array['fontes', 'numeros_whatsapp', 'funis']) r;
  delete from public.empresa_integracoes_regras where tenant_id in (t_a, t_b);
  -- Rui: cliente que a empresa A já tinha no AVANTE, com negócio perdido no funil do número.
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id) values (t_a, 'pessoa_fisica', 'Rui Antigo', '5511958000030', c_a) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, motivo_perda)
  values (t_a, v_cli, ea_perdida, 'manual', 'teste-rui-perdida', 'Sem verba');

  -- ================================================================= X1 só uma empresa
  update public.plataforma_integracoes set whatsapp_oficial = false;
  delete from public.plataforma_integracoes_empresas where tipo = 'whatsapp_oficial';
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('whatsapp_oficial', t_a);
  perform public._ok(public.integracao_habilitada('whatsapp_oficial', t_a) and not public.integracao_habilitada('whatsapp_oficial', t_b)
                     and not (select whatsapp_oficial from public.plataforma_integracoes),
                     'X1 chave global desligada; só a empresa A liberada (lista de homologação)');

  -- ======================================================================================== FASE 1
  perform public._servico();
  n_co := public.whatsapp_salvar_numero(t_a, g_a, ph, '680000000000001', '+55 11 4300-0581', 'Alfa', 'token-coex-x', 'WA App X', fa1, ea1, c_a, 'coexistencia');
  n_cl := public.whatsapp_salvar_numero(t_a, g_a, '580000000000099', '680000000000099', '+55 11 4300-0599', 'Alfa', 'token-cloud-x', 'WA Novo X', fa1, ea1, c_a);
  -- a Edge pede os contatos na conexão
  perform public.whatsapp_sincronizacao_registrar(n_co, 'contatos', true, 'req-contatos', null);
  perform public._como(null, null);
  select fonte_id into v_fonte from public.whatsapp_numeros where id = n_co;
  perform public._ok((select situacao = 'conectado' and modo_conexao = 'coexistencia' and inicializacao_concluida_em is null from public.whatsapp_numeros where id = n_co),
                     'I1 número do app conectado em coexistência nasce EM INICIALIZAÇÃO');
  perform public._ok((select inicializacao_concluida_em is not null from public.whatsapp_numeros where id = n_cl),
                     'I1 número novo (Cloud API) não tem inicialização');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I2a', '5511958000021', 'Ana Antiga', 'text', 'Oi, tudo bem? Sou cliente de vocês', now());
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I2b', '5511958000022', 'Bruno', 'text', 'Quero um orçamento', now());
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I2c', '5511958000023', 'Clara', 'text', 'Vocês abrem sábado?', now());
  perform public._como(null, null);
  v_conv := (v_j ->> 'conversa')::uuid;
  perform public._ok(v_j ->> 'lead' = 'em_inicializacao'
                     and not exists (select 1 from public.clientes where tenant_id = t_a and telefone in ('5511958000021', '5511958000022', '5511958000023')),
                     'I2 durante a inicialização: contato de origem incerta NÃO vira lead (nem cliente)');
  perform public._ok((select count(*) = 3 from public.conversas where whatsapp_numero_id = n_co and revisar_origem and not lead_automatico and ultima_entrada_em is not null)
                     and (select count(*) = 1 from public.mensagens where conversa_id = v_conv),
                     'I2 ...a mensagem fica visível na conversa, marcada "origem a revisar" (janela aberta pela mensagem recebida)');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I3', '5511958000030', 'Rui', 'text', 'Oi, lembra de mim?', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'em_inicializacao' and public._negs(t_a, '5511958000030') = 1
                     and (select cliente_id = v_cli and lead_automatico and not revisar_origem from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000030'),
                     'I3 cliente já cadastrado com negócio encerrado: conversa vinculada, sem nova oportunidade durante a inicialização');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I2a', '5511958000021', 'Ana Antiga', 'text', 'Oi, tudo bem? Sou cliente de vocês', now());
  perform public._como(null, null);
  perform public._ok((v_j ->> 'duplicada')::boolean and (select count(*) = 1 from public.mensagens where whatsapp_message_id = 'wamid.I2a'),
                     'I4 mensagem repetida da Meta durante a inicialização: não duplica');

  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select revisar_origem and em_inicializacao and pode_levar and negociacao_id is null
                        from public.whatsapp_conversa_no_funil((select id from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000021'))),
                     'I5 Administrador vê a conversa "origem a revisar" e pode levar ao funil');
  perform public.whatsapp_conversa_revisada((select id from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000021'));
  v_neg := public.whatsapp_conversa_levar_ao_funil((select id from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000022'));
  perform public._como(null, null);
  perform public._ok((select not revisar_origem and not lead_automatico from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000021')
                     and public._negs(t_a, '5511958000021') = 0,
                     'I5 "não é lead novo": sai da revisão, fica só a conversa');
  perform public._ok((select not revisar_origem and cliente_id is not null from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000022')
                     and public._negs(t_a, '5511958000022') = 1 and (select etapa_id = ea1 from public.negociacoes where id = v_neg),
                     'I5 "levar para o funil" durante a inicialização: cliente e negociação na etapa do número');
  perform public._como(c_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_conversa_revisada(%L)', v_conv));
  perform public._ok(v_r like '42501:%', 'I5 Closer não revisa a origem');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) = 1 from public.whatsapp_conversas_a_revisar()), 'I5 caixa do Administrador: 1 conversa ainda para revisar (Clara)');

  -- histórico sem autorização
  perform public._servico();
  v_j := public.whatsapp_registrar_mensagens_app(ph, 'historico',
    '[{"id":"wamid.HX8","telefone":"5511958000008","da_empresa":false,"tipo":"text","texto":"antigo","em":"2026-06-01T10:00:00Z"}]');
  perform public.whatsapp_historico_andamento(ph, 0, 50, false);
  perform public._como(null, null);
  perform public._ok(v_j ->> 'ignorado' = 'historico_nao_autorizado' and not exists (select 1 from public.mensagens where whatsapp_message_id = 'wamid.HX8')
                     and not exists (select 1 from public.whatsapp_sincronizacoes where numero_id = n_co and tipo = 'historico'),
                     'X8 histórico (e andamento) sem autorização do Administrador: ignorado, nada gravado');

  -- concluir: contatos ainda não chegaram
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select em_inicializacao and pendencia = 'contatos' and contatos = 'pedida' and a_revisar = 1 from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co),
                     'I6 tela: em inicialização, aguardando contatos, 1 conversa para revisar');
  v_r := public._recusa(format('select public.whatsapp_inicializacao_concluir(%L)', n_co));
  perform public._ok(v_r like '23514:%contatos%', 'I6 concluir antes de os contatos chegarem: recusado');
  perform public._servico();
  perform public.whatsapp_registrar_contatos_app(ph, '[{"telefone":"5511958000020","nome":"Dora da Agenda","acao":"add"},{"telefone":"5511958000021","nome":"Ana (agenda)","acao":"add"}]');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select pendencia is null and contatos = 'concluida' from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co),
                     'I6 contatos recebidos: nada mais segura a inicialização');

  -- histórico autorizado durante a inicialização
  perform public._como(c_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_historico_autorizar(%L)', n_co));
  perform public._ok(v_r like '42501:%', 'X9 Closer não autoriza o histórico');
  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_historico_autorizar(%L)', n_co));
  perform public._ok(v_r like '42501:%', 'X9 SDR não autoriza o histórico');
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa(format('select public.whatsapp_historico_autorizar(%L)', n_co));
  perform public._ok(v_r not like 'aceito', 'X9 Administrador de outra empresa não autoriza');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select pode_pedir_historico and historico = 'nao_pedido' from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co),
                     'X9 tela: histórico ainda não pedido, dentro do prazo');
  v_ph := public.whatsapp_historico_autorizar(n_co);
  perform public._ok(v_ph = ph, 'X9 Administrador autoriza: o banco devolve o número para o pedido à Meta');
  perform public._como(null, null);
  perform public._ok((select situacao = 'pedida' from public.whatsapp_sincronizacoes where numero_id = n_co and tipo = 'historico')
                     and exists (select 1 from public.admin_auditoria where acao = 'whatsapp_historico_autorizado' and tenant_id = t_a
                                    and detalhes ->> 'numero' = n_co::text and ator_id = g_a),
                     'X9 ...pedido registrado e auditado (quem, número, prazo)');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_historico_autorizar(%L)', n_co));
  perform public._ok(v_r like '23505:%uma vez%', 'X9 segundo pedido na mesma conexão: recusado (a Meta só permite uma vez)');
  v_r := public._recusa(format('select public.whatsapp_inicializacao_concluir(%L)', n_co));
  perform public._ok(v_r like '23514:%histórico%', 'I7 concluir com o histórico ainda chegando: recusado');

  perform public._servico();
  perform public.whatsapp_sincronizacao_registrar(n_co, 'historico', true, 'req-x9', null);
  v_j := public.whatsapp_registrar_mensagens_app(ph, 'historico',
    '[{"id":"wamid.HX10a","telefone":"5511958000010","da_empresa":false,"tipo":"text","texto":"Quero saber o preço","em":"2026-06-01T10:00:00Z","status":"READ"},
      {"id":"wamid.HX10b","telefone":"5511958000010","da_empresa":true,"tipo":"text","texto":"Claro","em":"2026-06-01T10:05:00Z","status":"DELIVERED"},
      {"id":"wamid.HX10c","telefone":"5511958000023","da_empresa":false,"tipo":"text","texto":"Conversa antiga da Clara","em":"2026-05-01T10:00:00Z","status":"READ"}]');
  perform public._como(null, null);
  perform public._ok((v_j ->> 'novas')::integer = 3, 'X10 histórico autorizado entra nas conversas');
  perform public._ok(not exists (select 1 from public.clientes where tenant_id = t_a and telefone = '5511958000010')
                     and (select ultima_entrada_em is null and not lead_automatico from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000010'),
                     'X10 ...histórico não cria lead nem abre a janela de 24 h');
  perform public._ok((select not revisar_origem and not lead_automatico from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000023')
                     and public._negs(t_a, '5511958000023') = 0,
                     'I7 conversa em revisão com mensagem antiga no histórico: contato antigo confirmado, sai da revisão (nada retroativo)');
  perform public._servico();
  v_j := public.whatsapp_registrar_mensagens_app(ph, 'historico', '[{"id":"wamid.HX10a","telefone":"5511958000010","tipo":"text","texto":"x"}]');
  perform public._ok((v_j ->> 'duplicadas')::integer = 1, 'X10 histórico reenviado não duplica');
  perform public.whatsapp_historico_andamento(ph, 2, 100, false);
  perform public._como(null, null);
  perform public._ok((select situacao = 'concluida' and mensagens = 3 from public.whatsapp_sincronizacoes where numero_id = n_co and tipo = 'historico'),
                     'X10 andamento: concluído, 3 mensagens importadas');

  -- concluir
  perform public._como(c_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_inicializacao_concluir(%L)', n_co));
  perform public._ok(v_r like '42501:%', 'I8 Closer não conclui a inicialização');
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa(format('select public.whatsapp_inicializacao_concluir(%L)', n_co));
  perform public._ok(v_r not like 'aceito', 'I8 outra empresa não conclui');
  perform public._como(g_a, 'teste-alfa');
  v_j := public.whatsapp_inicializacao_concluir(n_co);
  perform public._ok((v_j ->> 'contatos_agenda')::integer = 2 and (v_j ->> 'a_revisar')::integer = 0, 'I9 Administrador conclui: 2 contatos da agenda guardados, nada pendente de revisão');
  perform public._como(null, null);
  perform public._ok((select inicializacao_concluida_em is not null from public.whatsapp_numeros where id = n_co)
                     and (select count(*) = 2 from public.whatsapp_contatos_app where numero_id = n_co and agenda_inicial)
                     and exists (select 1 from public.admin_auditoria where acao = 'whatsapp_inicializacao_concluida' and tenant_id = t_a
                                    and detalhes ->> 'numero' = n_co::text and detalhes ->> 'historico' = 'concluida' and ator_id = g_a),
                     'I9 ...registrado e auditado (agenda, revisão, histórico)');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_inicializacao_concluir(%L)', n_co));
  perform public._ok(v_r like '23505:%', 'I9 concluir de novo: recusado');
  perform public._ok((select not em_inicializacao and not pode_pedir_historico from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co),
                     'I9 tela: inicialização concluída, histórico não pode mais ser pedido');

  -- ======================================================================================== FASE 2
  select count(*) into v_negs from public.negociacoes where tenant_id = t_a;
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I10', '5511958000020', 'Dora', 'text', 'Oi! Tudo certo para quinta?', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'revisar_origem' and (select count(*) from public.negociacoes where tenant_id = t_a) = v_negs
                     and (select revisar_origem and not lead_automatico from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000020'),
                     'I10 contato da agenda do app escrevendo pela 1ª vez: sem lead, vai para revisão (não é certeza de que é antigo)');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I11', '5511958000040', 'Eva Nova', 'text', 'Vi o perfil de vocês, quero orçamento', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'importada' and public._negs(t_a, '5511958000040') = 1
                     and (select not revisar_origem and lead_automatico and cliente_id is not null from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000040'),
                     'I11 inicialização concluída: contato realmente novo vira lead no funil do número');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I12', '5511958000030', 'Rui', 'text', 'Agora quero fechar', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'nova_oportunidade' and public._negs(t_a, '5511958000030') = 2
                     and (select count(*) = 1 from public.clientes where tenant_id = t_a and telefone = '5511958000030'),
                     'I12 cliente com negócio encerrado escreve depois da inicialização: nova oportunidade (regra mantida), sem duplicar o cliente');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I13a', '5511958000023', 'Clara', 'text', 'Oi de novo', now());
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.I13b', '5511958000021', 'Ana Antiga', 'text', 'Oi de novo', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'contato_do_app' and public._negs(t_a, '5511958000023') = 0 and public._negs(t_a, '5511958000021') = 0,
                     'I13 contatos confirmados antigos (histórico ou revisão) não viram lead depois');

  -- leads, duplicidade e inflação
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X2', '5511958000001', 'Nina Nova', 'text', 'Oi, quero um orçamento', now());
  perform public._como(null, null);
  v_conv := (v_j ->> 'conversa')::uuid;
  select n.id, n.cliente_id into v_neg, v_cli from public.negociacoes n join public.clientes c on c.id = n.cliente_id
   where c.tenant_id = t_a and c.telefone = '5511958000001';
  perform public._ok(v_j ->> 'lead' = 'importada' and v_neg is not null, 'X2 primeiro contato: cliente e negociação criados');
  perform public._ok((select origem = 'whatsapp' and etapa_id = ea1 from public.negociacoes where id = v_neg), 'X2 ...origem WhatsApp, na etapa do número');
  perform public._ok((select cliente_id = v_cli and lead_automatico and ultima_entrada_em is not null from public.conversas where id = v_conv),
                     'X2 ...conversa vinculada ao cadastro (e janela aberta pela mensagem recebida)');

  select count(*) into v_negs from public.negociacoes where tenant_id = t_a;
  select count(*) into v_eventos from public.ingestao_eventos where fonte_id = v_fonte;
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X2', '5511958000001', 'Nina Nova', 'text', 'Oi, quero um orçamento', now());
  perform public._como(null, null);
  perform public._ok((v_j ->> 'duplicada')::boolean and (select count(*) = 1 from public.mensagens where conversa_id = v_conv)
                     and (select count(*) from public.negociacoes where tenant_id = t_a) = v_negs,
                     'X3 webhook repetido: nem mensagem nem negociação duplicadas');

  select coalesce(jsonb_array_length(atribuicao -> 'origens_adicionais'), 0) into v_origens from public.negociacoes where id = v_neg;
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X4a', '5511958000001', 'Nina Nova', 'text', 'Pode ser amanhã?', now());
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X4b', '5511958000001', 'Nina Nova', 'text', 'Obrigada', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'contato_existente' and (select count(*) = 3 from public.mensagens where conversa_id = v_conv),
                     'X4 mensagens seguintes entram na mesma conversa');
  perform public._ok((select count(*) from public.negociacoes where tenant_id = t_a) = v_negs
                     and (select coalesce(jsonb_array_length(atribuicao -> 'origens_adicionais'), 0) from public.negociacoes where id = v_neg) = v_origens
                     and (select count(*) from public.ingestao_eventos where fonte_id = v_fonte) = v_eventos,
                     'X4 ...sem negociação nova, sem origem nova a cada mensagem, sem registro de entrada repetido');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X5', '5511958000001', 'Nina Nova', 'text', 'Vi o anúncio', now(),
                                           '{"source_type":"ad","source_id":"120200000000581","ctwa_clid":"clid-x5"}');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.negociacoes where tenant_id = t_a) = v_negs
                     and (select atribuicao -> 'origens_adicionais' @> '[{"ctwa_clid":"clid-x5","anuncio_id":"120200000000581"}]' from public.negociacoes where id = v_neg),
                     'X5 mensagem de anúncio Click-to-WhatsApp: anúncio guardado na negociação aberta (sem duplicar)');

  -- eco do app
  perform public._servico();
  v_j := public.whatsapp_registrar_mensagens_app(ph, 'eco_app',
    '[{"id":"wamid.ECOX6","telefone":"5511958000006","tipo":"text","texto":"Olá! Aqui é da Alfa, pelo celular"}]');
  perform public._como(null, null);
  select id into v_conv2 from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000006';
  perform public._ok((v_j ->> 'novas')::integer = 1 and (select not lead_automatico and not revisar_origem and ultima_entrada_em is null from public.conversas where id = v_conv2)
                     and exists (select 1 from public.mensagens where whatsapp_message_id = 'wamid.ECOX6' and direcao = 'saida' and origem_app = 'eco_app'),
                     'X6 eco do app: mensagem ENVIADA na conversa, contato do app, janela fechada');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X6r', '5511958000006', 'Otávio', 'text', 'Oi, tudo bem', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'contato_do_app' and not exists (select 1 from public.clientes where tenant_id = t_a and telefone = '5511958000006'),
                     'X6 contato responde à empresa: mensagem entra, NÃO vira lead (conversa iniciada pelo celular)');
  perform public._ok((select ultima_entrada_em is not null from public.conversas where id = v_conv2),
                     'X7 ...a resposta pela Cloud API abre a janela de 24 h (só ela, não o eco)');

  -- status
  select count(*) into v_negs from public.negociacoes where tenant_id = t_a;
  select count(*) into v_convs from public.conversas where whatsapp_numero_id = n_co;
  perform public._servico();
  perform public.whatsapp_registrar_status(ph, 'wamid.STATUSX12', 'delivered', false, 'service', null, 'free_customer_service');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.negociacoes where tenant_id = t_a) = v_negs
                     and (select count(*) from public.conversas where whatsapp_numero_id = n_co) = v_convs,
                     'X12 evento de status não cria lead nem conversa');

  -- rótulos
  perform public._servico();
  perform public.whatsapp_registrar_entrada(ph, 'wamid.X14a', '5511958000001', 'Nina Nova', 'image', null, now());
  perform public.whatsapp_registrar_entrada(ph, 'wamid.X14b', '5511958000001', 'Nina Nova', 'unsupported', null, now());
  perform public._como(null, null);
  perform public._ok((select conteudo like '[Imagem%' from public.mensagens where whatsapp_message_id = 'wamid.X14a')
                     and (select conteudo like '%não suportada%veja no app%' from public.mensagens where whatsapp_message_id = 'wamid.X14b'),
                     'X14 imagem e mensagem não suportada com rótulo em português');

  -- levar para o funil; fonte pausada
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select contato_do_app and not revisar_origem and not em_inicializacao and negociacao_id is null and pode_levar from public.whatsapp_conversa_no_funil(v_conv2)),
                     'X15 contato do app: sem negociação, Administrador pode levar para o funil');
  perform public._ok((select negociacao_id is not null and not pode_levar from public.whatsapp_conversa_no_funil(
                        (select id from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000030'))),
                     'X15 contato com negociação aberta: a tela mostra a negociação, sem botão');
  perform public._como(c_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_conversa_levar_ao_funil(%L)', v_conv2));
  perform public._ok(v_r like '42501:%' and not exists (select 1 from public.whatsapp_conversa_no_funil(v_conv2)),
                     'X15 Closer não leva para o funil (nem vê o painel do funil da conversa)');
  perform public._como(null, null);
  update public.fontes_leads set status = 'pausada' where id = v_fonte;
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_conversa_levar_ao_funil(%L)', v_conv2));
  perform public._ok(v_r like '23514:%pausada%', 'X16 entrada de leads do número pausada: recusa com motivo claro');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X16a', '5511958000016', 'Quésia', 'text', 'Oi', now());
  perform public._como(null, null);
  perform public._ok(coalesce(v_j ->> 'lead', 'nenhum') = 'nenhum' and v_j ? 'mensagem'
                     and not exists (select 1 from public.clientes where tenant_id = t_a and telefone = '5511958000016'),
                     'X16 fonte pausada: a conversa entra, o lead não');
  update public.fontes_leads set status = 'ativa' where id = v_fonte;
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X16b', '5511958000016', 'Quésia', 'text', 'Ainda quero', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'importada', 'X16 fonte retomada: a próxima mensagem do contato vira lead (não se perde)');

  perform public._como(g_a, 'teste-alfa');
  v_neg := public.whatsapp_conversa_levar_ao_funil(v_conv2);
  perform public._como(null, null);
  perform public._ok((select n.etapa_id = ea1 and n.origem = 'whatsapp' and n.atribuicao ->> 'entrada' = 'conversa_levada_ao_funil'
                        and c.telefone = '5511958000006' and c.tenant_id = t_a
                        from public.negociacoes n join public.clientes c on c.id = n.cliente_id where n.id = v_neg)
                     and (select cliente_id is not null from public.conversas where id = v_conv2),
                     'X15 Administrador leva o contato do app para o funil: cliente e negociação na etapa do número, conversa vinculada');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_conversa_levar_ao_funil(%L)', v_conv2));
  perform public._ok(v_r like '23505:%', 'X15 ...segunda vez: já tem negociação aberta, nada duplicado');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X15c', '5511958000006', 'Otávio', 'text', 'Fechado então', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'contato_do_app' and public._negs(t_a, '5511958000006') = 1,
                     'X15 ...mensagens seguintes do contato não criam outra negociação');

  -- isolamento e permissões
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.whatsapp_conversa_no_funil(v_conv2)), 'X17 outra empresa não vê a conversa no funil');
  v_r := public._recusa(format('select public.whatsapp_conversa_levar_ao_funil(%L)', v_conv2));
  perform public._ok(v_r not like 'aceito', 'X17 ...nem leva a conversa de outra empresa para o funil');
  v_r := public._recusa(format('select public.whatsapp_conversa_revisada(%L)', (select id from public.conversas where whatsapp_numero_id = n_co and telefone = '5511958000020')));
  perform public._ok(v_r not like 'aceito', 'X17 ...nem revisa a origem');
  perform public._ok(not exists (select 1 from public.mensagens_visiveis where conversa_id in (v_conv, v_conv2)), 'X17 view de mensagens: outra empresa não vê nada');
  perform public._ok(not exists (select 1 from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co)
                     and not exists (select 1 from public.whatsapp_conversas_a_revisar()), 'X17 ...nem a inicialização nem a revisão');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) filter (where origem_app = 'eco_app') = 1 from public.mensagens_visiveis where conversa_id = v_conv2),
                     'X17 view de mensagens traz a origem (enviada pelo app) para a caixa');
  v_r := public._recusa(format('select public.whatsapp_registrar_entrada(%L, %L, %L, %L, %L, %L, now())', ph, 'wamid.FORJADO', '5511958000099', 'x', 'text', 'x'));
  perform public._ok(v_r like '42501:%', 'X17 usuário logado não grava mensagem recebida (só o servidor, depois de conferir a assinatura da Meta)');
  v_r := public._recusa(format('select public.whatsapp_registrar_mensagens_app(%L, %L, %L)', ph, 'historico', '[]'));
  perform public._ok(v_r like '42501:%', 'X17 ...nem eco/histórico');
  v_r := public._recusa(format('select public.whatsapp_inicializacao_pendencia(%L)', n_co));
  perform public._ok(v_r like '42501:%', 'X17 ...nem chama as funções internas da inicialização');
  perform public._como(null, null);
  perform set_config('role', 'anon', true);
  v_r := public._recusa(format('select public.whatsapp_inicializacao_concluir(%L)', n_co));
  perform set_config('role', 'postgres', true);
  perform public._ok(v_r like '42501:%', 'X17 anônimo não conclui inicialização');
  perform public._ok(not exists (select 1 from public.mensagens m join public.conversas c on c.id = m.conversa_id
                                  where c.tenant_id = t_b and m.whatsapp_numero_id = n_co), 'X17 nada da empresa A gravado na B');

  -- ======================================================================================== FASE 3
  -- reconexão no app há mais de 24 h (prazo do histórico encerrado); o pedido anterior foi antes dela
  update public.whatsapp_sincronizacoes set pedida_em = now() - interval '26 hours' where numero_id = n_co and tipo = 'historico';
  update public.whatsapp_numeros set conectado_em = now() - interval '25 hours' where id = n_co;
  perform public._ok((select inicializacao_concluida_em is null from public.whatsapp_numeros where id = n_co),
                     'X11 reconexão em coexistência recomeça a inicialização (leads automáticos em espera)');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_historico_autorizar(%L)', n_co));
  perform public._ok(v_r like '23514:%prazo%', 'X11 depois das 24 h da conexão: histórico recusado (regra da Meta)');
  perform public._ok((select not pode_pedir_historico and historico = 'prazo_encerrado' from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co),
                     'X11 ...a tela mostra prazo encerrado');
  perform public._como(null, null);
  update public.whatsapp_numeros set conectado_em = now() - interval '1 hour' where id = n_co;
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select pode_pedir_historico and historico = 'nao_pedido' from public.whatsapp_inicializacao_da_empresa() where numero_id = n_co),
                     'X11 reconexão: o histórico da conexão anterior não segura um novo pedido');
  perform public._ok(public.whatsapp_historico_autorizar(n_co) = ph, 'X11 ...pedido aceito');
  perform public._como(null, null);
  perform public._ok((select situacao = 'pedida' and mensagens = 0 and pedida_em = now() from public.whatsapp_sincronizacoes where numero_id = n_co and tipo = 'historico'),
                     'X11 ...registro reiniciado para a conexão atual');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada(ph, 'wamid.X11n', '5511958000041', 'Fábio', 'text', 'Oi', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'em_inicializacao' and public._negs(t_a, '5511958000041') = 0,
                     'X11 ...e durante a nova inicialização ninguém vira lead sozinho');
end;
$$;

rollback;
