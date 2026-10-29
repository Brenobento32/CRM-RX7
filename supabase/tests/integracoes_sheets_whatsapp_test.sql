set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: integrações Google Sheets + WhatsApp oficial (banco).
-- ONDE RODAR: só numa cópia LOCAL (crm_rx7_*) com 20261030100000 aplicada e o
-- seed local (teste-alfa, teste-beta, Super Admin ...ff e híbrido ...fe).
-- Termina em ROLLBACK.
--
--  1 destino: só funil/etapa/responsável da própria empresa; Super Admin nunca
--  2 duas planilhas + WhatsApp no MESMO funil; e em funis DIFERENTES
--  3 sincronização: base inicial, importação, idempotência, contato existente
--  4 erro reprocessável, linha inválida, fonte pausada não importa
--  5 fila: lease + SKIP LOCKED (sem dupla reserva)
--  6 WhatsApp: número único, entrada idempotente, lead só para contato novo
--  7 envio: janela 24 h, bloqueio de pago, limite diário, cobrança detectada
--  8 isolamento A × B e permissões por cargo
--  9 destino protegido (sem órfão) e mudança de destino auditada
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
end;
$$;

-- Ambiente local: os planos locais não têm quantidades; com a migration 20261104090000 (limite vazio =
-- a definir = bloqueia novas conexões), o teste define limites por empresa. Sem ela, nada muda.
do $lim$
begin
  if to_regclass('public.empresa_limites') is not null then
    execute $x$insert into public.empresa_limites (tenant_id, recurso, limite, motivo)
             select t.id, r, 100, 'ambiente local de teste' from public.tenants t cross join unnest(array['fontes', 'numeros_whatsapp', 'funis']) r
              where t.tipo = 'assinante' on conflict (tenant_id, recurso) do nothing$x$;
  end if;
end;
$lim$;


create function public._como(p_uid uuid, p_slug text, p_sessao text default 'sessao-1')
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessao)::text, true);
  perform set_config('request.headers', case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function public._como(uuid, text, text) to authenticated;
create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated;
create function public._recusa(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'aceito';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function public._recusa(text) to authenticated;

-- Contexto de serviço (Edge Function): role service_role, sem usuário.
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
  g_a    uuid := '60000000-0000-4000-8000-0000000000a1';
  c_a    uuid := '60000000-0000-4000-8000-0000000000a2';
  sdr_a  uuid := '60000000-0000-4000-8000-0000000000a3';
  g_b    uuid := '60000000-0000-4000-8000-0000000000b1';
  sa     uuid := '60000000-0000-4000-8000-0000000000ff';
  t_a    uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b    uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  fa1    uuid; ea1 uuid; ea_ag uuid;     -- funil principal A, Lead Novo, Reunião agendada
  fa2    uuid := gen_random_uuid(); ea2 uuid := gen_random_uuid();  -- Funil Parcerias A → Entrada
  fb1    uuid; eb1 uuid;
  conta_a uuid; conta_b uuid;
  s1 uuid; s2 uuid; s3 uuid; w_a uuid; n_a uuid; n_b uuid; fw uuid;
  v_r    text; v_j jsonb; v_n bigint; v_cli bigint; v_neg bigint; v_conv uuid; v_msg uuid; v_hist text; v_txt text;
begin
  perform public._como(null, null);
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_ag from public.etapas_funil where funil_id = fa1 and nome = 'Reunião agendada';
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;
  insert into public.funis (id, tenant_id, nome, padrao, ativo, ordem) values (fa2, t_a, 'Parcerias', false, true, 2);
  insert into public.etapas_funil (id, tenant_id, funil_id, nome, cor, ordem, tipo, etapa_inicial, ativo)
  values (ea2, t_a, fa2, 'Entrada', 'azul', 1, 'aberta', true, true);
  v_hist := (select count(*) from public.clientes) || '/' || (select count(*) from public.negociacoes) || '/' || (select count(*) from public.fechamentos);
  update public.plataforma_integracoes set google_sheets = true, whatsapp_oficial = true, meta_conversoes = true;

  -- Contas Google (como a Edge Function, depois do OAuth) ----------------------
  perform public._servico();
  conta_a := public.google_salvar_conta(t_a, g_a, 'planilhas@alfa.test', 'refresh-token-alfa-xxxxxxxx', array['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);
  conta_b := public.google_salvar_conta(t_b, g_b, 'planilhas@beta.test', 'refresh-token-beta-xxxxxxxx', array['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);
  v_r := public._recusa(format($q$select public.google_salvar_conta(%L, %L, 'x@x.test', 'refresh-token-xxxxxxxxxx', array['email'])$q$, t_b, g_a));
  perform public._ok(v_r like '42501:%', '0 conta Google: só quem administra a empresa conecta (A não conecta em B)');
  perform public._ok(public.google_obter_refresh_token(conta_a) = 'refresh-token-alfa-xxxxxxxx', '0 refresh token guardado no Vault e lido só pelo serviço');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa('select * from public.integracoes_contas_google');
  perform public._ok(v_r like '42501:%', '0 Administrador não lê a tabela de credenciais');
  v_r := public._recusa(format('select public.google_obter_refresh_token(%L)', conta_a));
  perform public._ok(v_r like '42501:%', '0 ...nem o token pela função do serviço');

  -- 1 Destino ------------------------------------------------------------------
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads A', 0, 'Página1', 1, '{"nome":"Nome","telefone":"Telefone"}', null, false, 'Planilha B?', %L, %L, %L)$q$, conta_a, fb1, eb1, c_a));
  perform public._ok(v_r not like 'aceito%', '1a funil/etapa de OUTRA empresa recusados (' || left(v_r, 40) || ')');
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads A', 0, 'Página1', 1, '{"nome":"Nome","telefone":"Telefone"}', null, false, 'Mistura', %L, %L, %L)$q$, conta_a, fa1, ea2, c_a));
  perform public._ok(v_r like '23514:%', '1b etapa de outro funil da mesma empresa recusada');
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads A', 0, 'Página1', 1, '{"nome":"Nome","telefone":"Telefone"}', null, false, 'SA dono', %L, %L, %L)$q$, conta_a, fa1, ea1, sa));
  perform public._ok(v_r like '23514:%', '1c Super Admin como responsável recusado');
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads A', 0, 'Página1', 1, '{"nome":"Nome","telefone":"Telefone"}', null, false, 'Resp B', %L, %L, %L)$q$, conta_a, fa1, ea1, g_b));
  perform public._ok(v_r like '23514:%', '1d responsável de outra empresa recusado');
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-bbbbbbbbbbbbbbbbbbbb', 'Leads B', 0, 'Página1', 1, '{"nome":"Nome","telefone":"Telefone"}', null, false, 'Conta B', %L, %L, %L)$q$, conta_b, fa1, ea1, c_a));
  perform public._ok(v_r like 'P0002:%', '1e conta Google de outra empresa recusada');
  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads A', 0, 'Página1', 1, '{"nome":"Nome","telefone":"Telefone"}', null, false, 'SDR tenta', %L, %L, %L)$q$, conta_a, fa1, ea1, sdr_a));
  perform public._ok(v_r like '42501:%', '1f SDR não conecta integração');

  -- 2 Duas planilhas no mesmo funil + uma em funil diferente --------------------
  perform public._como(g_a, 'teste-alfa');
  s1 := public.sheets_criar_fonte(conta_a, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads Site', 0, 'Respostas', 1,
                                  '{"nome":"Nome","telefone":"Telefone","email":"E-mail"}', null, false, 'Site', fa1, ea1, sdr_a);
  s2 := public.sheets_criar_fonte(conta_a, 'planilha-id-cccccccccccccccccccc', 'Leads Evento', 0, 'Página1', 1,
                                  '{"nome":"Nome","telefone":"Celular"}', 'ID', true, 'Evento', fa1, ea_ag, c_a);
  s3 := public.sheets_criar_fonte(conta_a, 'planilha-id-dddddddddddddddddddd', 'Parceiros', 0, 'Página1', 1,
                                  '{"nome":"Nome","telefone":"Telefone"}', null, true, 'Parceiros', fa2, ea2, g_a);
  perform public._ok(s1 is not null and s2 is not null and s3 is not null, '2a duas planilhas no Funil Principal (etapas diferentes) e uma no Funil Parcerias');
  v_r := public._recusa(format($q$select public.sheets_criar_fonte(%L, 'planilha-id-aaaaaaaaaaaaaaaaaaaa', 'Leads Site', 0, 'Respostas', 1, '{"telefone":"Telefone"}', null, false, 'Repetida', %L, %L, %L)$q$, conta_a, fa1, ea1, sdr_a));
  perform public._ok(v_r like '23505:%', '2b a mesma aba não é conectada duas vezes');
  perform public._ok((select count(*) from public.integracoes_da_empresa()) = 3, '2c Administrador vê as 3 integrações da empresa');

  -- 3 Sincronização ---------------------------------------------------------------
  perform public._servico();
  select count(*) into v_n from public.sheets_reservar(10, 300, null);
  perform public._ok(v_n = 3, '3a fila reserva as 3 planilhas novas');
  select count(*) into v_n from public.sheets_reservar(10, 300, null);
  perform public._ok(v_n = 0, '5 lease: a mesma rodada não é reservada duas vezes');
  -- s1 (não importa existentes): primeira leitura só marca a base
  v_j := public.sheets_processar_linhas(s1, '[{"chave":"fp:1","linha":2,"nome":"Ana Antiga","telefone":"21911110001"},{"chave":"fp:2","linha":3,"nome":"Beto Antigo","telefone":"21911110002"}]', true);
  perform public._ok((v_j ->> 'ignoradas_inicio')::int = 2 and (v_j ->> 'importadas')::int = 0, '3b linhas que já existiam não viram lead (importar existentes desligado)');
  perform public.sheets_concluir(s1, true, null, 2);
  select count(*) into v_cli from public.clientes where tenant_id = t_a;
  select count(*) into v_neg from public.negociacoes where tenant_id = t_a;
  v_j := public.sheets_processar_linhas(s1, '[{"chave":"fp:1","linha":2,"nome":"Ana Antiga","telefone":"21911110001"},{"chave":"fp:3","linha":4,"nome":"Caio Novo","telefone":"21911110003","email":"caio@novo.test"}]', false);
  perform public._ok((v_j ->> 'importadas')::int = 1, '3c linha nova importada; a antiga continua ignorada');
  perform public._ok((select count(*) from public.clientes where tenant_id = t_a) = v_cli + 1 and (select count(*) from public.negociacoes where tenant_id = t_a) = v_neg + 1, '3c ...1 cliente e 1 negociação');
  perform public._ok((select n.etapa_id = ea1 and c.owner_id = sdr_a from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.telefone = '5521911110003' and n.tenant_id = t_a), '3d lead no funil/etapa da fonte com o SDR como dono');
  perform public._ok((select n.atribuicao ->> 'fonte' = 'google_sheets' and n.atribuicao ->> 'planilha' = 'Leads Site' from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.telefone = '5521911110003' and n.tenant_id = t_a), '3d origem registrada no lead (planilha)');
  v_j := public.sheets_processar_linhas(s1, '[{"chave":"fp:3","linha":9,"nome":"Caio Mudou","telefone":"21911110003"}]', false);
  perform public._ok((v_j ->> 'importadas')::int = 0 and (select count(*) from public.negociacoes where tenant_id = t_a) = v_neg + 1, '3e reordenar/reenviar a mesma linha não duplica');
  perform public._ok((select nome from public.clientes where telefone = '5521911110003' and tenant_id = t_a) = 'Caio Novo', '3e ...nem sobrescreve o cliente porque a linha mudou');
  -- mesmo contato chegando por OUTRA planilha do MESMO funil: não abre outra negociação
  v_j := public.sheets_processar_linhas(s2, '[{"chave":"id:77","linha":2,"nome":"Caio","telefone":"(21) 91111-0003"}]', true);
  perform public._ok((v_j ->> 'existentes')::int = 1 and (select count(*) from public.negociacoes where tenant_id = t_a) = v_neg + 1, '3f contato existente com negociação aberta no mesmo funil: sem duplicar');
  perform public._ok((select jsonb_array_length(n.atribuicao -> 'origens_adicionais') from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.telefone = '5521911110003' and n.tenant_id = t_a) = 1, '3f ...origem adicional preservada na negociação existente');
  -- ...e por planilha de OUTRO funil: nova negociação naquele funil, mesmo cliente
  v_j := public.sheets_processar_linhas(s3, '[{"chave":"fp:p1","linha":2,"nome":"Caio","telefone":"21911110003"}]', true);
  perform public._ok((v_j ->> 'importadas')::int = 1 and (select count(*) from public.clientes where telefone = '5521911110003' and tenant_id = t_a) = 1
                     and exists (select 1 from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.telefone = '5521911110003' and n.etapa_id = ea2),
                     '3g funil diferente: nova negociação no Funil Parcerias, sem duplicar o cliente');

  -- 4 Erros e reprocessamento --------------------------------------------------
  v_j := public.sheets_processar_linhas(s1, '[{"chave":"fp:ruim","linha":5,"nome":"Sem contato","telefone":"abc"}]', false);
  perform public._ok((v_j ->> 'invalidas')::int = 1, '4a linha sem telefone/e-mail válidos marcada como inválida');
  perform public._como(g_a, 'teste-alfa');
  perform public.sheets_acao(s2, 'pausar');
  perform public._servico();
  v_j := public.sheets_processar_linhas(s2, '[{"chave":"id:78","linha":3,"nome":"Dora","telefone":"21911110004"}]', false);
  perform public._ok((v_j ->> 'erros')::int = 1 and not exists (select 1 from public.clientes where telefone = '5521911110004'), '4b fonte pausada não importa (erro registrado para reprocessar)');
  perform public._ok(exists (select 1 from public.ingestao_eventos where fonte_id = s2 and resultado = 'erro'), '4b ...erro rastreável em ingestao_eventos');
  select count(*) into v_n from public.sheets_reservar(10, 300, s2);
  perform public._ok(v_n = 0, '4c fonte pausada fora da fila');
  perform public._como(g_a, 'teste-alfa');
  perform public.sheets_acao(s2, 'retomar');
  perform public.sheets_acao(s2, 'reprocessar_erros');
  perform public._servico();
  v_j := public.sheets_processar_linhas(s2, '[{"chave":"id:78","linha":3,"nome":"Dora","telefone":"21911110004"}]', false);
  perform public._ok((v_j ->> 'importadas')::int = 1, '4d depois de retomar e reprocessar, a linha com erro entra');
  perform public.sheets_concluir(s3, false, 'Colunas mudaram', null, false);
  perform public._ok((select situacao = 'erro' and falhas_seguidas = 1 and proxima_sincronizacao_em > now() from public.fontes_google_sheets where fonte_id = s3), '4e falha da rodada: situação de erro e próxima tentativa com recuo');
  perform public.sheets_concluir(s1, false, 'invalid_grant', null, true);
  perform public._ok((select situacao from public.fontes_google_sheets where fonte_id = s1) = 'erro_autorizacao', '4f autorização expirada: pede reconexão');

  -- 6 WhatsApp -----------------------------------------------------------------
  perform public._servico();
  n_a := public.whatsapp_salvar_numero(t_a, g_a, '100000000000001', '200000000000001', '+55 21 3000-0001', 'Alfa', 'token-meta-alfa', 'WhatsApp Alfa', fa1, ea1, sdr_a);
  n_b := public.whatsapp_salvar_numero(t_b, g_b, '100000000000002', '200000000000002', '+55 21 3000-0002', 'Beta', 'token-meta-beta', 'WhatsApp Beta', fb1, eb1, g_b);
  -- Número novo fica 'pendente_registro' até a Meta confirmar o registro (migration 20261103090000).
  perform public.whatsapp_registro_resultado(n_a, true, null);
  perform public.whatsapp_registro_resultado(n_b, true, null);
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '100000000000001', '200000000000009', null, null, 'tok', 'Roubo', %L, %L, %L)$q$, t_b, g_b, fb1, eb1, g_b));
  perform public._ok(v_r like '23505:%', '6a número já conectado a A não vai para B');
  select fonte_id into fw from public.whatsapp_numeros where id = n_a;
  perform public._ok((select funil_id = fa1 and etapa_id = ea1 from public.fontes_leads where id = fw), '6b WhatsApp de A no MESMO funil da planilha "Site"');
  select count(*) into v_neg from public.negociacoes where tenant_id = t_a;
  v_j := public.whatsapp_registrar_entrada('100000000000001', 'wamid.A1', '5521922220001', 'Eva Nova', 'text', 'Oi, quero saber o preço', now());
  perform public._ok(v_j ->> 'lead' = 'importada' and (select count(*) from public.negociacoes where tenant_id = t_a) = v_neg + 1, '6c contato novo: conversa + lead no destino do WhatsApp');
  v_conv := (v_j ->> 'conversa')::uuid;
  perform public._ok((select tenant_id = t_a and whatsapp_numero_id = n_a and cliente_id is not null from public.conversas where id = v_conv), '6c ...conversa da empresa A, do número A, ligada ao cliente');
  v_j := public.whatsapp_registrar_entrada('100000000000001', 'wamid.A1', '5521922220001', 'Eva Nova', 'text', 'Oi, quero saber o preço', now());
  perform public._ok((v_j ->> 'duplicada')::boolean and (select count(*) from public.mensagens where conversa_id = v_conv) = 1, '6d evento repetido da Meta não duplica a mensagem');
  select count(*) into v_neg from public.negociacoes where tenant_id = t_a;
  v_j := public.whatsapp_registrar_entrada('100000000000001', 'wamid.A2', '5521911110003', 'Caio', 'text', 'Bom dia', now());
  perform public._ok(v_j ->> 'lead' = 'contato_existente' and (select count(*) from public.negociacoes where tenant_id = t_a) = v_neg, '6e cliente já existente: conversa vinculada, nenhuma negociação nova');
  v_j := public.whatsapp_registrar_entrada('100000000000002', 'wamid.B1', '5521911110003', 'Caio', 'text', 'Oi B', now());
  perform public._ok((select tenant_id = t_b from public.conversas where id = (v_j ->> 'conversa')::uuid)
                     and not exists (select 1 from public.conversas cv join public.clientes c on c.id = cv.cliente_id where cv.id = (v_j ->> 'conversa')::uuid and c.tenant_id = t_a),
                     '6f mesmo telefone em B: conversa e cliente de B, nunca o cliente de A');
  v_j := public.whatsapp_registrar_entrada('999999999999999', 'wamid.X', '5521900000000', 'Ninguém', 'text', 'x', now());
  perform public._ok(v_j ->> 'ignorado' = 'numero_desconhecido', '6g número desconhecido ignorado');

  -- 7 Envio e custo --------------------------------------------------------------
  -- franquia mensal confirmada com a Meta (o agendador faz isso; ver franquia_destino_capi_test.sql)
  perform public._servico();
  perform public.whatsapp_reconciliar_franquia(n_a, public.whatsapp_mes_franquia('America/Sao_Paulo'), 0);
  perform public._como(g_a, 'teste-alfa');
  select mensagem_id into v_msg from public.whatsapp_preparar_envio(v_conv, 'Olá Eva, o preço é...');
  perform public._ok((select status = 'enviando' and direcao = 'saida' and not cobravel from public.mensagens where id = v_msg), '7a dentro da janela de 24 h: envio gratuito preparado (nasce "enviando", nunca "pendente")');
  perform public._ok((select aberta from public.whatsapp_janela(v_conv)), '7a janela aberta informada à tela');
  perform public._como(null, null);
  update public.conversas set ultima_entrada_em = now() - interval '25 hours' where id = v_conv;
  perform public._como(g_a, 'teste-alfa');
  select bloqueio, mensagem into v_r, v_txt from public.whatsapp_preparar_envio(v_conv, 'Oi de novo');
  perform public._ok(v_r = 'fora_da_janela', '7b fora da janela: BLOQUEADO (seria modelo pago) — ' || left(v_txt, 60));
  perform public._ok(not exists (select 1 from public.mensagens where conversa_id = v_conv and conteudo = 'Oi de novo'), '7b ...nenhuma mensagem criada');
  perform public._como(null, null);
  perform public._ok((select bloqueadas from public.whatsapp_consumo where numero_id = n_a) = 1, '7b ...bloqueio contado no indicador de consumo');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select motivo from public.whatsapp_janela(v_conv)) = 'fora_da_janela', '7b ...motivo informado à tela');
  perform public._como(null, null);
  update public.conversas set ultima_entrada_em = now() where id = v_conv;
  update public.whatsapp_numeros set limite_envios_dia = 1 where id = n_a;
  perform public._como(g_a, 'teste-alfa');
  select bloqueio into v_r from public.whatsapp_preparar_envio(v_conv, 'Segunda');
  perform public._ok(v_r = 'limite_diario', '7c limite diário local respeitado');
  perform public._servico();
  perform public.whatsapp_confirmar_envio(v_msg, 'wamid.OUT1', true, null);
  v_j := public.whatsapp_registrar_status('100000000000001', 'wamid.OUT1', 'delivered', false, 'service', null);
  perform public._ok((select status::text from public.mensagens where id = v_msg) = 'entregue', '7d status de entrega atualizado');
  v_j := public.whatsapp_registrar_status('100000000000001', 'wamid.OUT1', 'sent', false, 'service', null);
  perform public._ok((select status::text from public.mensagens where id = v_msg) = 'entregue', '7d status não regride (sent depois de delivered)');
  v_j := public.whatsapp_registrar_status('100000000000001', 'wamid.OUT1', 'read', true, 'marketing', null);
  perform public._ok((select bloqueado_por_cobranca from public.whatsapp_numeros where id = n_a), '7e Meta indicou cobrança: número bloqueado automaticamente');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'whatsapp_cobranca_detectada' and tenant_id = t_a), '7e ...e auditado');
  perform public._como(null, null);
  update public.whatsapp_numeros set limite_envios_dia = 200 where id = n_a;
  perform public._como(g_a, 'teste-alfa');
  select bloqueio into v_r from public.whatsapp_preparar_envio(v_conv, 'Depois da cobrança');
  perform public._ok(v_r = 'bloqueado_por_cobranca', '7f com cobrança detectada, nenhum envio sai até revisão do Administrador');
  v_r := public._recusa('select * from public.plataforma_regras_whatsapp');
  perform public._ok(v_r like '42501:%', '7g regras comerciais da plataforma fechadas para usuários');
  perform public._como(null, null);
  perform public._ok((select not permitir_mensagens_pagas from public.plataforma_regras_whatsapp), '7g mensagens pagas desligadas na plataforma');
  -- caminho antigo (insert 'pendente' liberado pela RLS) não serve para o número oficial
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$insert into public.mensagens (tenant_id, conversa_id, direcao, tipo, conteudo, status, autor_id) values (%L, %L, 'saida', 'texto', 'atalho', 'pendente', %L)$q$, t_a, v_conv, g_a));
  perform public._ok(v_r like '42501:%', '7h inserir mensagem "pendente" direto na conversa oficial: recusado (sem atalho para o controle de custo)');
  v_r := public._recusa($q$select public.integracao_criar_estado('google', '//site-malicioso.example/x')$q$);
  perform public._ok(v_r like '23514:%', '7i retorno do OAuth para outro site recusado (sem redirecionamento aberto)');
  perform public._como(null, null);

  -- 8 Isolamento e cargos ---------------------------------------------------------
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.integracoes_da_empresa() where fonte_id in (s1, s2, s3, fw)), '8a B não vê integrações de A');
  perform public._ok(not exists (select 1 from public.conversas where id = v_conv), '8b B não vê conversa de A');
  v_r := public._recusa(format($q$select * from public.whatsapp_preparar_envio(%L, 'Invasão')$q$, v_conv));
  perform public._ok(v_r like 'P0002:%', '8c B não envia pela conversa de A');
  v_r := public._recusa(format($q$select public.sheets_acao(%L, 'pausar')$q$, s1));
  perform public._ok(v_r like 'P0002:%', '8d B não mexe na planilha de A');
  v_r := public._recusa(format($q$select public.integracao_alterar_destino(%L, %L, %L, %L)$q$, s1, fb1, eb1, g_b));
  perform public._ok(v_r like 'P0002:%', '8e B não altera destino de A');
  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa('select * from public.integracoes_da_empresa()');
  perform public._ok(v_r like '42501:%', '8f SDR não vê credenciais/configurações de integração');
  perform public._como(c_a, 'teste-alfa');
  v_r := public._recusa(format($q$select * from public.whatsapp_preparar_envio(%L, 'Closer sem carteira')$q$, v_conv));
  perform public._ok(v_r like '42501:%', '8g Closer sem a carteira do cliente não atende a conversa (' || left(v_r, 30) || ')');
  perform public._ok(not exists (select 1 from public.whatsapp_caixa_entrada() where conversa_id = v_conv), '8g ...nem a vê na caixa de entrada');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(exists (select 1 from public.whatsapp_caixa_entrada() where conversa_id = v_conv), '8g Administrador vê a conversa na caixa de entrada');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.whatsapp_caixa_entrada() where conversa_id = v_conv), '8g caixa de entrada de B não mostra conversa de A');
  perform public._como(sa, 'teste-alfa');
  v_r := public._recusa('select * from public.integracoes_da_empresa()');
  perform public._ok(v_r like '42501:%', '8h Super Admin sem "Acessar CRM" não administra integração da empresa');
  perform public._ok((select count(*) from public.admin_integracoes_empresa(t_a)) = 4, '8i Super Admin acompanha pelo painel global (4 integrações de A, sem segredos)');

  -- 9 Destino protegido e auditado -------------------------------------------------
  perform public._como(g_a, 'teste-alfa');
  perform public.integracao_alterar_destino(s1, fa2, ea2, g_a);
  perform public._ok((select funil_id = fa2 and etapa_id = ea2 from public.fontes_leads where id = s1), '9a destino alterado');
  perform public._ok((select n.etapa_id = ea1 from public.negociacoes n join public.clientes c on c.id = n.cliente_id where c.telefone = '5521911110003' and n.tenant_id = t_a and n.atribuicao ->> 'fonte_id' = s1::text), '9a ...sem mover o lead antigo');
  perform public._como(null, null);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'integracao_destino_alterado' and detalhes ->> 'fonte' = s1::text and detalhes ? 'antes' and detalhes ? 'depois'), '9b mudança de destino auditada (antes/depois)');
  -- etapa SEM negociações, usada só como destino (a regra antiga cobre etapa com negociações)
  insert into public.etapas_funil (tenant_id, funil_id, nome, cor, ordem, tipo, etapa_inicial, ativo)
  values (t_a, fa2, 'Triagem', 'verde', 2, 'aberta', false, true) returning id into v_msg;
  perform public._como(g_a, 'teste-alfa');
  perform public.integracao_alterar_destino(s3, fa2, v_msg, g_a);
  perform public._como(null, null);
  v_r := public._recusa(format('update public.etapas_funil set ativo = false where id = %L', v_msg));
  perform public._ok(v_r like '23514:%Em uso pela integração%', '9c etapa usada por integração não é desativada (orienta trocar o destino)');
  v_r := public._recusa(format('update public.funis set ativo = false where id = %L', fa2));
  perform public._ok(v_r like '23514:%Em uso pela integração%', '9d funil usado por integração não é desativado');
  v_r := public._recusa(format('update public.tenant_memberships set ativo = false where tenant_id = %L and user_id = %L', t_a, sdr_a));
  perform public._ok(v_r like '23514:%Em uso pela integração%', '9e responsável em uso não é desativado sem trocar o destino');
  perform public._ok((select count(*) from public.fechamentos) || '' = split_part(v_hist, '/', 3), '9f fechamentos e históricos intactos');
end;
$$;

rollback;
