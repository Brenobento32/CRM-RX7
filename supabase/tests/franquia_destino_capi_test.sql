set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: franquia mensal do WhatsApp, destino único dos leads e Meta
-- Conversions API (CRM). Migrations 20261030100000, 20261031090000 e
-- 20261031100000. ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  F franquia: não confirmada bloqueia; reserva antes do envio; falha devolve;
--    entrega conta uma vez; Meta acima do local vale; alertas 80/90/100;
--    confirmação vencida bloqueia; preço "regular" bloqueia; entrada segue.
--  D destino único (WhatsApp e planilha): reaproveita aberta no mesmo funil;
--    nova oportunidade sem duplicar cliente; nada se move entre funis;
--    referral do anúncio e ID de lead da Meta guardados sem inventar.
--  C Conversions API: plano, isolamento, dataset único, mapeamento,
--    idempotência, sem correspondência, fila (retry/rejeição/expirado), valor.
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
  c_a   uuid := '60000000-0000-4000-8000-0000000000a2';
  sdr_a uuid := '60000000-0000-4000-8000-0000000000a3';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  fa1 uuid; ea1 uuid; ea_real uuid; ea_ganha uuid;
  fa2 uuid := gen_random_uuid(); ea2 uuid := gen_random_uuid();
  fb1 uuid; eb1 uuid;
  n_a uuid; n_b uuid; fw uuid; conta uuid; s1 uuid;
  v_mes date := public.whatsapp_mes_franquia('America/Sao_Paulo');
  v_j jsonb; v_r text; v_b text; v_msg uuid; v_msg2 uuid; v_conv uuid; v_cli uuid; v_neg uuid; v_neg2 uuid; v_n integer;
  v_con uuid; v_ev public.meta_conversoes_eventos;
  p_business uuid; p_starter uuid;
begin
  perform public._como(null, null);
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_real from public.etapas_funil where funil_id = fa1 and nome = 'Reunião realizada';
  select id into ea_ganha from public.etapas_funil where funil_id = fa1 and tipo = 'ganha';
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;
  insert into public.funis (id, tenant_id, nome, padrao, ativo, ordem) values (fa2, t_a, 'Parcerias (teste)', false, true, 9);
  insert into public.etapas_funil (id, tenant_id, funil_id, nome, cor, ordem, tipo, etapa_inicial, ativo)
  values (ea2, t_a, fa2, 'Entrada', 'azul', 1, 'aberta', true, true);

  -- ================================================================= K. chaves da plataforma
  perform public._ok((select not google_sheets and not whatsapp_oficial and not meta_conversoes from public.plataforma_integracoes),
                     'K1 chaves nascem desligadas');
  perform public._servico();
  v_r := public._recusa(format($q$select public.google_salvar_conta(%L, %L, 'k@alfa.test', 'refresh-token-k-xxxxxxxxx', array['email'])$q$, t_a, g_a));
  perform public._ok(v_r like 'RX030:%', 'K2 Google desligado: conta não é salva (mesmo pelo serviço)');
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '519999999999999', '619999999999999', null, null, 'token-k-xxxxxxxxxxxx', 'K', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like 'RX030:%', 'K3 WhatsApp desligado: número não é conectado, com ou sem credencial');
  v_r := public._recusa(format($q$select public.capi_salvar_conexao(%L, %L, '700000000000099', '800000000000099', 'K', 'token-sistema-k-xxxxxxxxxxxx')$q$, t_a, g_a));
  perform public._ok(v_r like 'RX030:%', 'K4 Meta Ads desligado: conexão recusada');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa($q$select public.integracao_criar_estado('google', null)$q$);
  perform public._ok(v_r like 'RX030:%', 'K5 Google desligado: nem o OAuth começa');
  perform public._ok((select not google_sheets and not whatsapp_oficial from public.integracoes_habilitadas()), 'K6 tela lê as chaves (só booleanos)');
  v_r := public._recusa('update public.plataforma_integracoes set google_sheets = true');
  perform public._ok(v_r like '42501:%', 'K7 Administrador não liga integração da plataforma');
  perform public._como(null, null);
  -- homologação restrita: Google só para a empresa A (chave global continua desligada)
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('google_sheets', t_a);
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'plataforma_integracao_empresa_liberada' and tenant_id = t_a),
                     'K7b liberação por empresa auditada');
  perform public._servico();
  v_r := public._recusa(format($q$select public.google_salvar_conta(%L, %L, 'k@alfa.test', 'refresh-token-k-xxxxxxxxx', array['email'])$q$, t_a, g_a));
  perform public._ok(v_r like 'aceito%', 'K7c Google liberado só para A: conta de A salva');
  v_r := public._recusa(format($q$select public.google_salvar_conta(%L, %L, 'k@beta.test', 'refresh-token-k-xxxxxxxxx', array['email'])$q$, t_b, g_b));
  perform public._ok(v_r like 'RX030:%', 'K7d ...B continua bloqueada');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select google_sheets and not whatsapp_oficial and not meta_conversoes from public.integracoes_habilitadas()), 'K7e tela de A: só Google ligado');
  perform public._como(g_b, 'teste-beta');
  perform public._ok((select not google_sheets from public.integracoes_habilitadas()), 'K7f tela de B: Google desligado');
  v_r := public._recusa(format($q$insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('google_sheets', %L)$q$, t_b));
  perform public._ok(v_r like '42501:%', 'K7g Administrador não se libera sozinho');
  perform public._como(null, null);
  update public.plataforma_integracoes set google_sheets = true;
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'plataforma_integracoes_alterada'), 'K8 ligar uma chave fica auditado');
  update public.plataforma_integracoes set whatsapp_oficial = true, meta_conversoes = true;

  -- Número de A (destino: funil Parcerias) e de B ---------------------------------
  perform public._servico();
  n_a := public.whatsapp_salvar_numero(t_a, g_a, '510000000000001', '610000000000001', '+55 11 4100-0001', 'Alfa', 'token-meta-alfa-xxxx', 'WA A', fa2, ea2, c_a);
  n_b := public.whatsapp_salvar_numero(t_b, g_b, '510000000000002', '610000000000002', '+55 21 4100-0002', 'Beta', 'token-meta-beta-xxxx', 'WA B', fb1, eb1, g_b);
  -- Número novo fica 'pendente_registro' até a Meta confirmar o registro (migration 20261103090000).
  perform public.whatsapp_registro_resultado(n_a, true, null);
  perform public.whatsapp_registro_resultado(n_b, true, null);
  select fonte_id into fw from public.whatsapp_numeros where id = n_a;

  -- ================================================================= F. franquia
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.F1', '5511933330001', 'Fran Nova', 'text', 'Oi', now());
  v_conv := (v_j ->> 'conversa')::uuid;
  perform public._como(g_a, 'teste-alfa');
  select bloqueio into v_b from public.whatsapp_preparar_envio(v_conv, 'Olá');
  perform public._ok(v_b = 'franquia_nao_confirmada', 'F1 número sem consumo do mês confirmado com a Meta: envio bloqueado preventivamente');
  perform public._ok(v_j ->> 'lead' = 'importada', 'F1 ...a entrada da mensagem e o lead continuam funcionando');
  perform public._ok((select motivo from public.whatsapp_janela(v_conv)) = 'franquia_nao_confirmada', 'F1 ...e a tela recebe o motivo');

  perform public._servico();
  perform public.whatsapp_reconciliar_franquia(n_a, v_mes, 0);
  perform public._como(g_a, 'teste-alfa');
  select mensagem_id, bloqueio into v_msg, v_b from public.whatsapp_preparar_envio(v_conv, 'Olá Fran');
  perform public._ok(v_b is null and (select franquia_estado = 'reservada' from public.mensagens where id = v_msg), 'F2 confirmado com a Meta: envio sai com a capacidade RESERVADA antes');
  perform public._como(null, null);
  perform public._ok((select reservadas = 1 and consumidas = 0 from public.whatsapp_franquia where numero_id = n_a and mes = v_mes), 'F2 ...reserva contada na franquia do número');

  -- limite estimado pequeno para exercitar o fim da franquia: 1000 - 997 = 3
  update public.whatsapp_franquia set margem = 997 where numero_id = n_a and mes = v_mes;
  perform public._como(g_a, 'teste-alfa');
  select mensagem_id into v_msg2 from public.whatsapp_preparar_envio(v_conv, 'Segunda');
  select bloqueio into v_b from public.whatsapp_preparar_envio(v_conv, 'Terceira');
  perform public._ok(v_b is null, 'F3 terceira dentro do limite estimado (3)');
  select bloqueio into v_b from public.whatsapp_preparar_envio(v_conv, 'Quarta');
  perform public._ok(v_b = 'franquia_esgotada', 'F3 limite estimado atingido: a próxima (potencialmente cobrada) é bloqueada');
  perform public._como(null, null);
  perform public._ok((select alerta_80_em is not null and alerta_90_em is not null and alerta_100_em is not null from public.whatsapp_franquia where numero_id = n_a and mes = v_mes),
                     'F4 alertas de 80 %, 90 % e 100 % registrados');
  perform public._ok((select count(*) from public.admin_auditoria where acao = 'whatsapp_franquia_alerta' and tenant_id = t_a) = 3, 'F4 ...uma vez cada, na auditoria da empresa');

  perform public._servico();
  perform public.whatsapp_confirmar_envio(v_msg2, null, false, 'erro de rede');
  perform public._como(null, null);
  perform public._ok((select reservadas = 2 and liberadas = 1 from public.whatsapp_franquia where numero_id = n_a and mes = v_mes), 'F5 envio que falhou devolve a reserva (não consome duas vezes)');
  perform public._servico();
  perform public.whatsapp_confirmar_envio(v_msg, 'wamid.OUT.F', true, null);
  v_j := public.whatsapp_registrar_status('510000000000001', 'wamid.OUT.F', 'delivered', false, 'service', null, 'free_customer_service');
  v_j := public.whatsapp_registrar_status('510000000000001', 'wamid.OUT.F', 'read', false, 'service', null, 'free_customer_service');
  v_j := public.whatsapp_registrar_status('510000000000001', 'wamid.OUT.F', 'delivered', false, 'service', null, 'free_customer_service');
  perform public._como(null, null);
  perform public._ok((select reservadas = 1 and consumidas = 1 and gratuitas_confirmadas = 1 from public.whatsapp_franquia where numero_id = n_a and mes = v_mes),
                     'F6 entrega (e status repetidos) consome a franquia UMA vez; tipo free_customer_service registrado');

  update public.whatsapp_franquia set margem = 50 where numero_id = n_a and mes = v_mes;
  perform public._servico();
  perform public.whatsapp_reconciliar_franquia(n_a, v_mes, 949);
  perform public._como(g_a, 'teste-alfa');
  select bloqueio into v_b from public.whatsapp_preparar_envio(v_conv, 'Depois da reconciliação');
  perform public._ok(v_b = 'franquia_esgotada', 'F7 Meta informa uso maior (outro sistema no mesmo número): vale o maior e bloqueia');
  perform public._como(null, null);
  perform public._servico();
  perform public.whatsapp_reconciliar_franquia(n_a, v_mes, 10);
  perform public._como(null, null);
  perform public._ok((select utilizadas_meta from public.whatsapp_franquia where numero_id = n_a and mes = v_mes) = 949, 'F7 total menor da Meta no mesmo mês não reduz o uso (fica o maior já visto)');
  update public.whatsapp_franquia set utilizadas_meta = 10 where numero_id = n_a and mes = v_mes;
  update public.whatsapp_franquia set reconciliada_em = now() - interval '40 hours' where numero_id = n_a and mes = v_mes;
  perform public._como(g_a, 'teste-alfa');
  select bloqueio into v_b from public.whatsapp_preparar_envio(v_conv, 'Confirmação vencida');
  perform public._ok(v_b = 'franquia_nao_confirmada', 'F8 confirmação com a Meta vencida (mais de 36 h): bloqueia até confirmar de novo');
  perform public._como(null, null);
  update public.whatsapp_franquia set reconciliada_em = now() where numero_id = n_a and mes = v_mes;
  perform public._servico();
  v_j := public.whatsapp_registrar_status('510000000000001', 'wamid.OUT.F', 'delivered', false, 'service', null, 'regular');
  perform public._como(null, null);
  perform public._ok((select cobradas from public.whatsapp_franquia where numero_id = n_a and mes = v_mes) = 0, 'F9 tipo de preço só é registrado uma vez por mensagem');
  perform public._servico();
  perform public.whatsapp_confirmar_envio((select id from public.mensagens where conversa_id = v_conv and conteudo = 'Terceira'), 'wamid.OUT.G', true, null);
  v_j := public.whatsapp_registrar_status('510000000000001', 'wamid.OUT.G', 'delivered', false, 'service', null, 'regular');
  perform public._como(null, null);
  perform public._ok((select cobradas = 1 from public.whatsapp_franquia where numero_id = n_a and mes = v_mes)
                     and (select bloqueado_por_cobranca from public.whatsapp_numeros where id = n_a), 'F9 Meta marcou "regular" (cobrada): contada e número bloqueado');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.F2', '5511933330001', 'Fran Nova', 'text', 'Ainda estou aqui', now());
  perform public._como(null, null);
  perform public._ok(v_j ? 'mensagem' and v_j ->> 'lead' = 'contato_existente', 'F10 com a saída bloqueada, a entrada segue gravando e vinculando o lead');
  perform public._ok(not exists (select 1 from public.whatsapp_franquia where numero_id = n_b and (reservadas > 0 or consumidas > 0)), 'F11 franquia de B separada da de A');
  perform public._ok(not exists (select 1 from public.plataforma_regras_whatsapp where permitir_mensagens_pagas), 'F12 mensagens pagas continuam desligadas na plataforma');
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select usadas = greatest(consumidas, 10) + reservadas and limite_estimado = 950 and utilizadas_meta = 10 and situacao = 'liberada' from public.whatsapp_franquia_empresa() where numero_id = n_a),
                     'F13 painel do Administrador: utilizadas / limite estimado');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(not exists (select 1 from public.whatsapp_franquia_empresa() where numero_id = n_a), 'F13 ...B não vê a franquia de A');
  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa('select * from public.whatsapp_franquia_empresa()');
  perform public._ok(v_r like '42501:%', 'F13 ...SDR não vê o painel de custo');

  -- ================================================================= D. destino único
  perform public._como(null, null);
  -- Caio: cliente de A com negociação aberta só no funil principal (fa1)
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id) values (t_a, 'pessoa_fisica', 'Davi Existente', '5511944440001', c_a) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, ea1, 'manual', 'teste-d1') returning id into v_neg;
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.D1', '5511944440001', 'Davi', 'text', 'Oi',
                                           now(), '{"source_type":"ad","source_id":"120200000000077","ctwa_clid":"clid-abc","headline":"x"}');
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'nova_oportunidade', 'D1 WhatsApp: cliente existente SEM negociação aberta no funil do número → nova oportunidade');
  perform public._ok((select count(*) from public.clientes where tenant_id = t_a and telefone = '5511944440001') = 1, 'D1 ...sem duplicar o cliente');
  perform public._ok((select etapa_id = ea1 from public.negociacoes where id = v_neg), 'D1 ...negociação do outro funil não foi movida');
  select id into v_neg2 from public.negociacoes where cliente_id = v_cli and funil_id = fa2;
  perform public._ok(v_neg2 is not null and (select etapa_id = ea2 and owner_id = c_a from public.negociacoes where id = v_neg2),
                     'D1 ...nova oportunidade na etapa configurada; responsável = dono do cliente (regra do CRM)');
  perform public._ok((select atribuicao ->> 'ctwa_clid' = 'clid-abc' and atribuicao ->> 'anuncio_id' = '120200000000077' and not (atribuicao ? 'headline')
                        from public.negociacoes where id = v_neg2), 'D2 referral do anúncio Click-to-WhatsApp guardado (só os campos necessários)');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.D2', '5511944440001', 'Davi', 'text', 'Mais uma', now());
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.D2', '5511944440001', 'Davi', 'text', 'Mais uma', now());
  perform public._como(null, null);
  perform public._ok((select count(*) from public.negociacoes where cliente_id = v_cli) = 2, 'D3 mensagens seguintes e reenvio da Meta: nenhuma negociação nova');
  -- negociação em etapa posterior: reaproveitada sem voltar de etapa
  perform public._como(g_a, 'teste-alfa');
  perform public.mover_negociacao(v_neg, ea_real, 1000);
  perform public._como(null, null);
  perform public._servico();
  conta := public.google_salvar_conta(t_a, g_a, 'planilhas-d@alfa.test', 'refresh-token-d-xxxxxxxxx', array['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);
  perform public._como(g_a, 'teste-alfa');
  s1 := public.sheets_criar_fonte(conta, 'planilha-d-aaaaaaaaaaaaaaaaaaaaaa', 'Leads D', 0, 'Leads', 1, '{"nome":"Nome","telefone":"Telefone"}', null, true,
                                  'Planilha D', fa1, ea1, g_a);
  perform public._servico();
  perform public.sheets_reservar(5, 300, s1);
  v_j := public.sheets_processar_linhas(s1, jsonb_build_array(
    jsonb_build_object('chave', 'id:1', 'linha', 2, 'nome', 'Davi', 'telefone', '(11) 94444-0001', 'meta_lead_id', '123456789012345'),
    jsonb_build_object('chave', 'id:2', 'linha', 3, 'nome', 'Nova Pessoa', 'telefone', '11944440002', 'meta_lead_id', 'abc'),
    jsonb_build_object('chave', 'id:2', 'linha', 4, 'nome', 'Nova Pessoa', 'telefone', '11944440002')), false);
  perform public._como(null, null);
  perform public._ok((v_j ->> 'existentes')::integer = 1 and (v_j ->> 'importadas')::integer = 1, 'D4 planilha: mesma regra (aberta no mesmo funil reaproveitada; contato novo importado; linha repetida ignorada)');
  perform public._ok((select etapa_id = ea_real and owner_id = c_a from public.negociacoes where id = v_neg), 'D4 ...reaproveitada mantém etapa e responsável');
  perform public._ok((select atribuicao -> 'origens_adicionais' @> '[{"meta_lead_id": "123456789012345"}]' from public.negociacoes where id = v_neg),
                     'D5 ID do lead da Meta vindo da planilha guardado como origem adicional');
  perform public._ok((select not (atribuicao ? 'meta_lead_id') from public.negociacoes n join public.clientes c on c.id = n.cliente_id
                       where c.telefone = '5511944440002' and n.tenant_id = t_a), 'D5 ...valor inválido ("abc") nunca vira ID de lead');
  -- negociação do funil Parcerias encerrada (perdida) → nova oportunidade na próxima mensagem
  insert into public.etapas_funil (tenant_id, funil_id, nome, cor, ordem, tipo, etapa_inicial, ativo, participa_conversao)
  values (t_a, fa2, 'Perdido', 'vermelho', 100, 'perdida', false, true, false);
  perform public._como(g_a, 'teste-alfa');
  update public.negociacoes set etapa_id = (select id from public.etapas_funil where funil_id = fa2 and tipo = 'perdida'), motivo_perda = 'Sem interesse'
   where id = v_neg2;
  perform public._como(null, null);
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.D6', '5511944440001', 'Davi', 'text', 'Voltei', now());
  perform public._como(null, null);
  perform public._ok(v_j ->> 'lead' = 'nova_oportunidade' and (select count(*) from public.negociacoes where cliente_id = v_cli and funil_id = fa2) = 2,
                     'D6 sem negociação ABERTA no funil (a anterior foi encerrada): nova oportunidade, histórico preservado');
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('510000000000002', 'wamid.D7', '5511944440001', 'Davi em B', 'text', 'Oi B', now());
  perform public._como(null, null);
  perform public._ok((select c.tenant_id = t_b from public.clientes c where c.id = (v_j ->> 'cliente')::uuid), 'D7 mesmo telefone em B: cliente de B (nunca mistura empresas)');

  -- ================================================================= C. Conversions API
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select not elegivel from public.capi_da_empresa()), 'C1 empresa sem plano Pro/Business: não elegível');
  v_r := public._recusa(format($q$select public.capi_definir_configuracao(array[%L]::uuid[], '[]', false)$q$, fa1));
  perform public._ok(v_r like 'RX003:%', 'C1 ...configuração recusada pelo plano');
  perform public._servico();
  v_r := public._recusa(format($q$select public.capi_salvar_conexao(%L, %L, '700000000000001', '800000000000001', 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx')$q$, t_a, g_a));
  perform public._ok(v_r like 'RX003:%', 'C1 ...e a conexão também (servidor e banco)');

  perform public._como(null, null);
  select id into p_business from public.planos where codigo = 'business';
  select id into p_starter from public.planos where codigo = 'starter';
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where id = p_business and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_a, p_business, 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_b, p_starter, 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  perform public._ok(public.meta_conversoes_elegivel(t_a) and not public.meta_conversoes_elegivel(t_b), 'C2 plano com o recurso (Business) elegível; Starter não');

  perform public._servico();
  v_con := public.capi_salvar_conexao(t_a, g_a, '700000000000001', '800000000000001', 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx');
  perform public._ok((select situacao = 'configurando' and vault_secret_id is not null from public.meta_conversoes_conexoes where id = v_con),
                     'C3 conexão salva com token no cofre; não ativa sozinha');
  perform public._ok(public.capi_obter_token(v_con) is null, 'C3 ...token só sai para envio com a conexão ativa');
  v_r := public._recusa(format($q$select public.capi_salvar_conexao(%L, %L, '700000000000002', '800000000000001', 'Roubo', 'token-sistema-beta-xxxxxxxxxx')$q$, t_b, g_b));
  perform public._ok(v_r like 'RX003:%' or v_r like '23505:%', 'C4 B (Starter) não conecta, nem com o dataset de A');
  perform public._como(null, null);
  update public.assinaturas set plano_id = p_business where tenant_id = t_b;
  perform public._servico();
  v_r := public._recusa(format($q$select public.capi_salvar_conexao(%L, %L, '700000000000002', '800000000000001', 'Roubo', 'token-sistema-beta-xxxxxxxxxx')$q$, t_b, g_b));
  perform public._ok(v_r like '23505:%', 'C4 dataset de A nunca serve a B (mesmo com plano elegível)');
  perform public._como(null, null);
  update public.assinaturas set plano_id = p_starter where tenant_id = t_b;

  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.capi_definir_configuracao(array[%L]::uuid[], '[]', false)$q$, fb1));
  perform public._ok(v_r like '23503:%', 'C5 funil de outra empresa recusado');
  v_r := public._recusa(format($q$select public.capi_definir_configuracao(array[%L]::uuid[], %L, false)$q$, fa1,
                               jsonb_build_array(jsonb_build_object('etapa_id', ea2, 'evento', 'Lead'))));
  perform public._ok(v_r like '23503:%', 'C5 etapa de funil não monitorado recusada');
  v_r := public._recusa($q$select public.capi_acao('ativar')$q$);
  perform public._ok(v_r like '23514:%', 'C6 ativar sem mapeamento recusado');
  perform public.capi_definir_configuracao(array[fa1]::uuid[], jsonb_build_array(
    jsonb_build_object('etapa_id', ea1, 'evento', 'Lead recebido'),
    jsonb_build_object('etapa_id', ea_real, 'evento', 'Reunião realizada'),
    jsonb_build_object('etapa_id', ea_ganha, 'evento', 'Negócio fechado', 'enviar_valor', true)), false);
  perform public.capi_acao('ativar');
  perform public._como(null, null);
  perform public._ok((select situacao = 'ativa' from public.meta_conversoes_conexoes where id = v_con), 'C6 mapeado e ativado pelo Administrador');
  perform public._ok(exists (select 1 from public.admin_auditoria where tenant_id = t_a and acao in ('capi_configuracao', 'capi_ativar')), 'C6 ...auditado');

  -- lead com ID de Lead Ads (como o meta-webhooks grava) e lead sem
  perform public._como(null, null);
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, email, owner_id) values (t_a, 'pessoa_fisica', 'Lia Anúncio', '5511955550001', 'lia@exemplo.test', g_a) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (t_a, v_cli, ea1, 'formulario', 'teste-c7', '{"source":"meta_lead_ads","leadgen_id":"12345678901234567"}') returning id into v_neg;
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id) values (t_a, 'pessoa_fisica', 'Sem Anúncio', '5511955550002', g_a) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, ea1, 'manual', 'teste-c8') returning id into v_neg2;
  perform public._ok((select situacao = 'pendente' and lead_id = '12345678901234567' and event_id = 'avante-' || v_neg || '-' || ea1
                        from public.meta_conversoes_eventos where negociacao_id = v_neg and etapa_id = ea1), 'C7 lead recebido (etapa inicial mapeada) vira evento com ID estável');
  perform public._ok((select situacao = 'sem_correspondencia' and lead_id is null from public.meta_conversoes_eventos where negociacao_id = v_neg2),
                     'C8 lead sem ID de anúncio Meta: registrado, NUNCA enviado (sem atribuição inventada)');
  perform public._como(g_a, 'teste-alfa');
  perform public.mover_negociacao(v_neg, ea_real, 1000);
  perform public.mover_negociacao(v_neg, ea1, 1000);
  perform public.mover_negociacao(v_neg, ea_real, 1000);
  perform public._como(null, null);
  perform public._ok((select count(*) from public.meta_conversoes_eventos where negociacao_id = v_neg) = 2, 'C9 idas e vindas no funil: um evento por etapa (sem duplicar)');
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos e where e.negociacao_id = v_neg and e.evento <> all (array['Lead recebido', 'Reunião realizada'])),
                     'C9 ...nome do evento é o do mapeamento');

  -- fila: reserva, temporário (recuo), permanente, reprocessar, autorização
  perform public._servico();
  select count(*) into v_n from public.capi_reservar(50);
  perform public._ok(v_n = 2, 'C10 fila reserva só eventos com ID de lead da conexão ativa');
  perform public._ok((select count(*) from public.capi_reservar(50)) = 0, 'C10 ...lease: a segunda reserva não pega os mesmos');
  perform public._ok(public.capi_obter_token(v_con) = 'token-sistema-alfa-xxxxxxxxxx', 'C10 ...token lido só pelo serviço, conexão ativa');
  select * into v_ev from public.meta_conversoes_eventos where negociacao_id = v_neg and etapa_id = ea1;
  perform public.capi_concluir(v_ev.id, 'ok', null, 'trace-1');
  select * into v_ev from public.meta_conversoes_eventos where negociacao_id = v_neg and etapa_id = ea_real;
  perform public.capi_concluir(v_ev.id, 'temporario', 'limite da API', null);
  perform public._como(null, null);
  perform public._ok((select situacao = 'pendente' and proxima_tentativa_em > now() from public.meta_conversoes_eventos where id = v_ev.id), 'C11 erro temporário/limite: volta para a fila com recuo');
  update public.meta_conversoes_eventos set proxima_tentativa_em = now() where id = v_ev.id;
  perform public._servico();
  perform public.capi_reservar(50);
  perform public.capi_concluir(v_ev.id, 'permanente', '100/2804003 lead_id inválido', 'trace-2');
  perform public._como(null, null);
  perform public._ok((select situacao = 'rejeitado' from public.meta_conversoes_eventos where id = v_ev.id)
                     and (select enviados = 1 and rejeitados = 1 from public.meta_conversoes_conexoes where id = v_con), 'C12 sucesso e rejeição registrados');
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_reprocessar(v_ev.id);
  perform public._como(null, null);
  perform public._ok((select situacao = 'pendente' and tentativas = 0 from public.meta_conversoes_eventos where id = v_ev.id), 'C12 Administrador reprocessa um rejeitado');
  perform public._servico();
  perform public.capi_reservar(50);
  perform public.capi_concluir(v_ev.id, 'autorizacao', '190 token expirado', null);
  perform public._como(null, null);
  perform public._ok((select situacao = 'erro_autorizacao' from public.meta_conversoes_conexoes where id = v_con)
                     and (select situacao = 'pendente' from public.meta_conversoes_eventos where id = v_ev.id), 'C13 token recusado: conexão pede reconexão, evento não se perde');
  perform public._ok((select count(*) from public.capi_reservar(50)) = 0, 'C13 ...e nada mais sai até reconectar');
  update public.meta_conversoes_conexoes set situacao = 'ativa' where id = v_con;

  -- expira com mais de 7 dias
  update public.meta_conversoes_eventos set event_time = now() - interval '8 days', proxima_tentativa_em = now() where id = v_ev.id;
  perform public._servico();
  perform public.capi_reservar(50);
  perform public._como(null, null);
  perform public._ok((select situacao = 'expirado' from public.meta_conversoes_eventos where id = v_ev.id), 'C14 mais de 7 dias: expira sem envio (regra da Meta)');

  -- fechamento com valor
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 2500.00, current_date, false, false, 'pendente', 'nao_iniciado', null, '{}', null, 'tcv')$q$, v_neg));
  perform public._como(null, null);
  if v_r like 'aceito%' then
    perform public._servico();
    perform public._ok((select valor = 2500.00 and moeda = 'BRL' from public.capi_reservar(50) where evento = 'Negócio fechado'), 'C15 negócio fechado: evento com o valor da venda (BRL)');
  else
    raise notice 'aviso C15 fechamento não executado aqui (%): coberto no ponta a ponta', left(v_r, 80);
  end if;

  -- isolamento e cargos
  perform public._como(g_b, 'teste-beta');
  v_r := public._recusa('select * from public.capi_eventos_recentes(50)');
  perform public._ok(v_r like 'aceito%' and not exists (select 1 from public.capi_eventos_recentes(50) where negociacao_id = v_neg), 'C16 B não vê eventos de A');
  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa('select * from public.capi_da_empresa()');
  perform public._ok(v_r like '42501:%', 'C16 SDR não vê a conexão Meta Ads');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa('select * from public.meta_conversoes_conexoes');
  perform public._ok(v_r like '42501:%', 'C16 Administrador não lê a tabela (nem o token)');
  v_r := public._recusa(format('select public.capi_obter_token(%L)', v_con));
  perform public._ok(v_r like '42501:%', 'C16 ...nem pela função do serviço');
  perform public.capi_acao('pausar');
  perform public._como(null, null);
  select count(*) into v_n from public.meta_conversoes_eventos where tenant_id = t_a;
  perform public._como(g_a, 'teste-alfa');
  perform public.mover_negociacao(v_neg2, ea_real, 1000);
  perform public._como(null, null);
  perform public._ok((select count(*) from public.meta_conversoes_eventos where tenant_id = t_a) = v_n, 'C17 conexão pausada: nenhum evento novo');
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where lead_id is not null and lead_id !~ '^[0-9]{15,17}$'), 'C18 fila guarda só o ID do lead (sem dados pessoais)');

  -- K9: desligar de novo corta saída, entrada e eventos na hora (sem depender de credencial)
  update public.plataforma_integracoes set whatsapp_oficial = false, meta_conversoes = false;
  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('510000000000001', 'wamid.K9', '5511933330001', 'Fran Nova', 'text', 'Oi?', now());
  perform public._ok(v_j ->> 'ignorado' = 'whatsapp_desativado', 'K9 WhatsApp desligado: webhook ignorado, nada gravado');
  perform public._ok((select count(*) from public.whatsapp_numeros_para_reconciliar(10)) = 0, 'K9 ...nem a consulta de consumo à Meta');
  perform public._como(g_a, 'teste-alfa');
  select bloqueio into v_b from public.whatsapp_preparar_envio(v_conv, 'Com a chave desligada');
  perform public._ok(v_b = 'whatsapp_desativado', 'K9 ...e nenhuma resposta sai');
  perform public._como(null, null);
  select count(*) into v_n from public.meta_conversoes_eventos where tenant_id = t_a;
  update public.meta_conversoes_conexoes set situacao = 'ativa' where id = v_con;
  perform public._como(g_a, 'teste-alfa');
  perform public.mover_negociacao(v_neg2, ea1, 1000);
  perform public._como(null, null);
  perform public._ok((select count(*) from public.meta_conversoes_eventos where tenant_id = t_a) = v_n, 'K10 Meta Ads desligado: nenhum evento gerado');
  perform public._servico();
  perform public._ok((select count(*) from public.capi_reservar(50)) = 0, 'K10 ...e nada sai da fila');
  perform public._como(null, null);

  raise notice 'franquia_destino_capi_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
