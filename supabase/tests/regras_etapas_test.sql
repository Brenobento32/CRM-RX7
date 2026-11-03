set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: exigências por funil e etapa e reativação de empresa (migration 20261109090200).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  D  padrão: sem regra, nada muda (empresa nova e existentes)
--  S  segurança: só o Super Admin configura; cada empresa lê só as próprias regras
--  V  validação da configuração (etapa inicial/ganha/perdida, campos, checklist, auditoria)
--  R  trava ao mover: campo faltando, tudo preenchido, checklist, outros caminhos, duas empresas,
--     dois funis da mesma empresa, permissões antes da trava, fechamento/perda e entrada de leads intactos
--  A  regra alterada depois de existirem negociações: nada é reaberto, movido ou apagado
--  O  campo "Não usar": valor anterior preservado
--  X  reativação: ativa, vencida, cancelada, teste (em vigor e vencido), sem assinatura;
--     nunca promove, nunca mexe em datas, decisão explícita auditada
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
-- Detalhe estruturado do erro (o site usa para abrir o formulário certo).
create function public._detalhe(p_sql text)
returns jsonb language plpgsql as $$
declare
  v_d text; v_h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_d = pg_exception_detail, v_h = pg_exception_hint;
  return coalesce(nullif(v_d, '')::jsonb, '{}'::jsonb) || jsonb_build_object('sqlstate', sqlstate, 'hint', v_h);
end;
$$;
grant execute on function public._detalhe(text) to authenticated, service_role;

do $$
declare
  sa   uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a  uuid := '60000000-0000-4000-8000-0000000000a1';
  c_a  uuid := '60000000-0000-4000-8000-0000000000a2';
  g_b  uuid := '60000000-0000-4000-8000-0000000000b1';
  t_a  uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b  uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  t_g  uuid;
  fa uuid; fa2 uuid; fb uuid;
  a_ini uuid; a_ag uuid; a_real uuid; a_ganha uuid; a_rec uuid;
  a2_ini uuid; a2_ag uuid;
  b_ini uuid; b_ag uuid;
  v_cli uuid; v_clib uuid; n1 uuid; n2 uuid; n3 uuid; n4 uuid; nf2 uuid; nb uuid; nvelha uuid; ning uuid;
  v_serv uuid;
  v_item text; v_item2 text;
  v_r text; v_j jsonb; v_n integer; v_upd timestamptz;
  v_ass public.assinaturas;
begin
  perform public._como(null, null);
  select id into t_g from public.tenants where slug = 'gama-nova';
  select id into fa from public.funis where tenant_id = t_a and padrao;
  select id into fb from public.funis where tenant_id = t_b and padrao;
  select id into a_ini from public.etapas_funil where funil_id = fa and etapa_inicial;
  select id into a_ag from public.etapas_funil where funil_id = fa and chave = 'reuniao_agendada';
  select id into a_real from public.etapas_funil where funil_id = fa and chave = 'reuniao_realizada';
  select id into a_ganha from public.etapas_funil where funil_id = fa and tipo = 'ganha';
  select id into a_rec from public.etapas_funil where funil_id = fa and nome = 'Recuperação';
  select id into b_ini from public.etapas_funil where funil_id = fb and etapa_inicial;
  select id into b_ag from public.etapas_funil where funil_id = fb and chave = 'reuniao_agendada';

  -- Segundo funil da mesma empresa (cópia do principal: mesmas etapas, ids próprios).
  perform public._como(g_a, 'teste-alfa');
  perform public.duplicar_funil(fa, 'Funil Indicações');
  perform public._como(null, null);
  select id into fa2 from public.funis where tenant_id = t_a and nome = 'Funil Indicações';
  update public.etapas_funil set etapa_inicial = true where funil_id = fa2 and nome = 'Lead Novo' and not etapa_inicial;
  select id into a2_ini from public.etapas_funil where funil_id = fa2 and etapa_inicial;
  select id into a2_ag from public.etapas_funil where funil_id = fa2 and nome = 'Reunião agendada';

  insert into public.clientes (tenant_id, tipo_cliente, nome, owner_id) values (t_a, 'pessoa_fisica', 'Cliente Etapas A', g_a) returning id into v_cli;
  insert into public.clientes (tenant_id, tipo_cliente, nome, owner_id) values (t_b, 'pessoa_fisica', 'Cliente Etapas B', g_b) returning id into v_clib;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a_ini, 'manual', 'et-1') returning id into n1;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a_ini, 'manual', 'et-2') returning id into n2;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a_ini, 'manual', 'et-3') returning id into n3;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a_ini, 'manual', 'et-4') returning id into n4;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a2_ini, 'manual', 'et-f2') returning id into nf2;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_b, v_clib, b_ini, 'manual', 'et-b') returning id into nb;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a_ini, 'manual', 'et-velha') returning id into nvelha;
  insert into public.servicos (tenant_id, nome) values (t_a, 'Serviço de teste etapas') returning id into v_serv;

  -- ================================================================= D. padrão
  perform public._ok(not exists (select 1 from public.etapa_regras), 'D1 nenhuma empresa nasce com exigências por etapa');
  perform public._como(g_a, 'teste-alfa');
  perform public.mover_negociacao(nvelha, a_ag, 1000);
  perform public._ok((select etapa_id = a_ag from public.negociacoes where id = nvelha), 'D2 sem regra, mover funciona como antes (nada preenchido)');

  -- ================================================================= S. segurança
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"valor_estimado":"obrigatorio"}', null, 'tentativa')$q$, t_a, a_ag));
  perform public._ok(v_r like '42501:%', 'S1 Administrador da empresa não configura exigências (só o Super Admin)');
  v_r := public._recusa(format($q$insert into public.etapa_regras (etapa_id, tenant_id, campos) values (%L, %L, '{"valor_estimado":"obrigatorio"}')$q$, a_ag, t_a));
  perform public._ok(v_r like '42501:%', 'S2 ...nem gravando direto na tabela');
  v_r := public._recusa(format($q$insert into public.negociacao_confirmacoes_etapa (tenant_id, negociacao_id, etapa_id, item_id, texto) values (%L, %L, %L, 'x', 'x')$q$, t_a, n1, a_ag));
  perform public._ok(v_r like '42501:%', 'S3 confirmação de checklist não é gravada direto (só ao mover)');
  v_r := public._recusa(format($q$select public.admin_regras_etapas(%L)$q$, t_a));
  perform public._ok(v_r like '42501:%', 'S4 lista de configuração só para o Super Admin');

  -- ================================================================= V. configuração
  perform public._como(sa, null);
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"valor_estimado":"obrigatorio"}', null, 'teste')$q$, t_a, a_ini));
  perform public._ok(v_r like '22023:%etapas abertas%', 'V1 etapa inicial não recebe exigência (entrada de leads nunca bloqueada)');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"valor_estimado":"obrigatorio"}', null, 'teste')$q$, t_a, a_ganha));
  perform public._ok(v_r like '22023:%etapas abertas%', 'V2 etapa ganha não recebe (fechamento tem regras próprias)');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"valor_estimado":"obrigatorio"}', null, 'teste')$q$, t_a, b_ag));
  perform public._ok(v_r like 'P0002:%', 'V3 etapa de outra empresa recusada (id real da etapa, da empresa certa)');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"cpf":"obrigatorio"}', null, 'teste')$q$, t_a, a_ag));
  perform public._ok(v_r like '22023:%desconhecido%', 'V4 campo desconhecido recusado');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"valor_estimado":"talvez"}', null, 'teste')$q$, t_a, a_ag));
  perform public._ok(v_r like '22023:%Uso inválido%', 'V5 uso inválido recusado (só Não usar, Opcional ou Obrigatório)');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{}', array['Item A', 'item a'], 'teste')$q$, t_a, a_ag));
  perform public._ok(v_r like '22023:%repetido%', 'V6 item de checklist repetido recusado');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{}', array['a1x','a2x','a3x','a4x','a5x','a6x','a7x','a8x','a9x','a10','a11'], 'teste')$q$, t_a, a_ag));
  perform public._ok(v_r like '22023:%10 itens%', 'V7 no máximo 10 itens');
  v_r := public._recusa(format($q$select public.admin_definir_regras_etapa(%L, %L, '{"valor_estimado":"obrigatorio"}', null, '')$q$, t_a, a_ag));
  perform public._ok(v_r like '22023:%motivo%', 'V8 motivo obrigatório');

  perform public.admin_definir_regras_etapa(t_a, a_ag,
    '{"valor_estimado":"obrigatorio","temperatura":"oculto","data_proposta":"opcional"}', array['Contato confirmado por telefone'],
    'Agendamento só com valor estimado');
  perform public.admin_definir_regras_etapa(t_a, a2_ag, '{"data_primeira_reuniao":"obrigatorio"}', null, 'Indicações: data da reunião');
  perform public.admin_definir_regras_etapa(t_a, a_rec, '{"servicos":"obrigatorio"}', null, 'Recuperação: serviços');
  perform public.admin_definir_regras_etapa(t_b, b_ag, '{"valor_proposta":"obrigatorio"}', null, 'Beta: proposta antes da reunião');
  perform public._como(null, null);
  select r.checklist -> 0 ->> 'id' into v_item from public.etapa_regras r where r.etapa_id = a_ag;
  perform public._ok((select campos = '{"valor_estimado":"obrigatorio","temperatura":"oculto"}'::jsonb and jsonb_array_length(checklist) = 1
                        from public.etapa_regras where etapa_id = a_ag), 'V9 grava só o que difere de "opcional", com o checklist');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'regras_etapa_definidas' and tenant_id = t_a and ator_id = sa
                              and detalhes ->> 'etapa_id' = a_ag::text and detalhes ->> 'motivo' = 'Agendamento só com valor estimado'),
                     'V10 alteração auditada (Super Admin, etapa e motivo)');
  select count(*) into v_n from public.funis where tenant_id = t_a;
  perform public._como(sa, null);
  v_j := public.admin_regras_etapas(t_a);
  perform public._ok(jsonb_array_length(v_j) = v_n and v_n >= 2
                     and exists (select 1 from jsonb_array_elements(v_j) f, jsonb_array_elements(f -> 'etapas') e
                                  where (e ->> 'id')::uuid = a_ag and (e -> 'campos' ->> 'valor_estimado') = 'obrigatorio')
                     and exists (select 1 from jsonb_array_elements(v_j) f, jsonb_array_elements(f -> 'etapas') e
                                  where (e ->> 'id')::uuid = a_ini and not (e ->> 'configuravel')::boolean),
                     'V11 tela do Super Admin: todos os funis (inclusive o novo), etapas com as regras e quais são configuráveis');

  -- empresa lê só as próprias regras
  perform public._como(g_a, 'teste-alfa');
  perform public._ok((select count(*) from public.etapa_regras) = 3, 'S5 empresa lê as regras das próprias etapas');
  perform public._como(g_b, 'teste-beta');
  perform public._ok((select count(*) from public.etapa_regras) = 1 and not exists (select 1 from public.etapa_regras where tenant_id = t_a),
                     'S6 ...e nunca as de outra empresa');

  -- ================================================================= R. trava ao mover
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, n1, a_ag));
  perform public._ok(v_r like 'RX101:%Reunião agendada%Valor estimado%Contato confirmado por telefone%', 'R1 campo obrigatório faltando: movimento recusado, com o que falta');
  v_j := public._detalhe(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, n1, a_ag));
  perform public._ok(v_j -> 'campos' = '["valor_estimado"]'::jsonb and (v_j -> 'checklist' -> 0 ->> 'id') = v_item and (v_j ->> 'etapa_id')::uuid = a_ag,
                     'R2 ...detalhe estruturado (campos e itens) para o formulário');
  perform public._ok((select etapa_id = a_ini from public.negociacoes where id = n1), 'R3 ...e a negociação continua onde estava');
  v_r := public._recusa(format($q$update public.negociacoes set etapa_id = %L where id = %L$q$, a_ag, n1));
  perform public._ok(v_r like 'RX101:%', 'R4 outro caminho (update direto pela API) também é barrado');
  perform public._como(null, null);
  v_r := public._recusa(format($q$update public.negociacoes set etapa_id = %L where id = %L$q$, a_ag, n1));
  perform public._ok(v_r like '42501:%' or v_r like 'RX101:%', 'R5 ...e sem usuário identificado a troca de etapa também não passa');
  perform public._como(g_a, 'teste-alfa');
  -- só o campo, sem confirmar o checklist: nada é gravado (transação única)
  v_r := public._recusa(format($q$select public.salvar_e_mover_negociacao(%L, 5000, null, null, null, null, null, null, '{}', %L, 1000, '{}')$q$, n1, a_ag));
  perform public._ok(v_r like 'RX101:%confirmar%' and v_r not like '%Valor estimado%', 'R6 campo preenchido, checklist não: recusado só pelo checklist');
  perform public._ok((select valor_estimado is null and etapa_id = a_ini from public.negociacoes where id = n1), 'R7 ...e o valor digitado não foi gravado pela metade');
  v_r := public._recusa(format($q$select public.salvar_e_mover_negociacao(%L, 5000, null, null, null, null, null, null, '{}', %L, 1000, array[%L, 'item-inventado'])$q$, n1, a_ag, v_item));
  perform public._ok(v_r = 'aceito', 'R8 todos os campos preenchidos e checklist confirmado: move');
  perform public._ok((select etapa_id = a_ag and valor_estimado = 5000 from public.negociacoes where id = n1), 'R9 ...na etapa certa, com o valor gravado');
  perform public._ok((select count(*) = 1 and bool_and(confirmado_por = g_a and texto = 'Contato confirmado por telefone')
                        from public.negociacao_confirmacoes_etapa where negociacao_id = n1),
                     'R10 confirmação registrada (quem e o texto); item inventado ignorado');
  -- já preenchido antes: mover direto funciona sem formulário
  update public.negociacoes set valor_estimado = 800 where id = n2;
  v_r := public._recusa(format($q$select public.mover_negociacao_requisitos(%L, %L, 2000, array[%L])$q$, n2, a_ag, v_item));
  perform public._ok(v_r = 'aceito', 'R11 dados já completos: só a confirmação e move');
  -- dois funis da mesma empresa, mesma etapa "Reunião agendada", regras diferentes
  v_r := public._recusa(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, nf2, a2_ag));
  perform public._ok(v_r like 'RX101:%Primeira reunião%' and v_r not like '%Valor estimado%' and v_r not like '%confirmar%',
                     'R12 outro funil da mesma empresa segue a própria regra (data da reunião, sem checklist)');
  update public.negociacoes set data_primeira_reuniao = current_date where id = nf2;
  perform public.mover_negociacao(nf2, a2_ag, 1000);
  perform public._ok((select etapa_id = a2_ag from public.negociacoes where id = nf2), 'R13 ...e com a data preenchida move sem valor estimado');
  -- duas empresas com regras diferentes
  perform public._como(g_b, 'teste-beta');
  update public.negociacoes set valor_estimado = 900 where id = nb;
  v_r := public._recusa(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, nb, b_ag));
  perform public._ok(v_r like 'RX101:%Valor da proposta%' and v_r not like '%Contato confirmado%', 'R14 outra empresa: regra própria (proposta), nada da regra da Alfa');
  perform public.salvar_e_mover_negociacao(nb, 900, null, current_date, current_date, null, 2500, null, '{}', b_ag, 1000, '{}');
  perform public._ok((select etapa_id = b_ag and valor_proposta = 2500 from public.negociacoes where id = nb), 'R15 ...e preenchida move');
  -- serviços obrigatórios (tabela própria)
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, n4, a_rec));
  perform public._ok(v_r like 'RX101:%Serviços%', 'R16 serviço obrigatório: sem serviço não entra');
  perform public.salvar_e_mover_negociacao(n4, null, null, null, null, null, null, null, array[v_serv], a_rec, 1000, '{}');
  perform public._ok((select etapa_id = a_rec from public.negociacoes where id = n4), 'R17 ...com um serviço vinculado entra');
  -- permissão vem antes da exigência: quem não pode mover recebe a recusa de permissão
  perform public._como('60000000-0000-4000-8000-0000000000a3', 'teste-alfa');
  v_r := public._recusa(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, n3, a_rec));
  perform public._ok(v_r like '42501:%' or v_r like 'P0002:%', 'R18 SDR além de Reunião realizada: a recusa do cargo vem antes das exigências');
  -- voltar para a etapa inicial, fechar e perder não são barrados pelas exigências de etapa aberta
  perform public._como(g_a, 'teste-alfa');
  perform public.mover_negociacao(n1, a_ini, 1000);
  perform public._ok((select etapa_id = a_ini from public.negociacoes where id = n1), 'R19 voltar para a etapa inicial nunca é barrado');
  perform public.fechar_negociacao(n2, 1000, 1500, current_date, true, true, 'pago', 'concluido', null, null, null, 'tcv');
  perform public._ok((select e.tipo = 'ganha' from public.negociacoes n join public.etapas_funil e on e.id = n.etapa_id where n.id = n2),
                     'R20 fechamento continua pelas regras comerciais da empresa (agência)');
  v_r := public._recusa(format($q$select public.fechar_negociacao(%L, 1000, 1500, current_date, null, null, null, null, null, null, null, 'tcv')$q$, n3));
  perform public._ok(v_r like '23514:%Contrato enviado%', 'R21 ...inclusive exigindo os itens de agência, como antes');
  -- entrada de leads: cria na etapa inicial, nunca é afetada
  perform public._como(null, null);
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id) values (t_a, v_cli, a_ini, 'formulario', 'et-ingestao') returning id into ning;
  perform public._ok(ning is not null, 'R22 entrada de lead (inserção na etapa inicial) não é afetada');

  -- ================================================================= A. regra alterada com negociações existentes
  perform public._como(null, null);
  select updated_at into v_upd from public.negociacoes where id = nvelha;
  perform public._ok((select etapa_id = a_ag and valor_estimado is null from public.negociacoes where id = nvelha),
                     'A1 negociação que já estava na etapa antes da regra: continua lá, sem nada preenchido');
  perform public._como(g_a, 'teste-alfa');
  perform public.salvar_negociacao(nvelha, null, null, null, null, 'Cliente pediu prazo', null, null, '{}');
  perform public._ok((select etapa_id = a_ag and objecao_principal = 'Cliente pediu prazo' from public.negociacoes where id = nvelha),
                     'A2 ...e continua editável (a exigência é só para entrar na etapa)');
  update public.negociacoes set posicao = 5 where id = nvelha;
  perform public._ok((select posicao = 5 from public.negociacoes where id = nvelha), 'A3 ...e reordenar dentro da etapa não é barrado');
  perform public._como(sa, null);
  perform public.admin_definir_regras_etapa(t_a, a_ag, '{"valor_estimado":"obrigatorio","temperatura":"oculto"}',
    array['Contato confirmado por WhatsApp'], 'Mudou o canal de confirmação');
  perform public._como(null, null);
  select r.checklist -> 0 ->> 'id' into v_item2 from public.etapa_regras r where r.etapa_id = a_ag;
  perform public._ok(v_item2 <> v_item and exists (select 1 from public.negociacao_confirmacoes_etapa where negociacao_id = n1 and item_id = v_item),
                     'A4 item novo no checklist; confirmação antiga preservada como histórico');
  perform public._ok((select count(*) from public.negociacoes where etapa_id = a_ag) = 2, 'A5 mudar a regra não move nem reabre nenhuma negociação');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.mover_negociacao(%L, %L, 1000)$q$, n1, a_ag));
  perform public._ok(v_r like 'RX101:%WhatsApp%' and v_r not like '%Valor estimado%', 'A6 nova entrada na etapa pede o item novo (o valor já estava gravado)');

  -- ================================================================= O. campo "Não usar" preserva o valor
  perform public._como(null, null);
  update public.negociacoes set temperatura = 'quente' where id = nvelha;
  perform public._como(g_a, 'teste-alfa');
  perform public.salvar_negociacao(nvelha, null, null, null, null, 'Cliente pediu prazo', null, null, '{}');
  perform public._ok((select temperatura = 'quente' from public.negociacoes where id = nvelha), 'O1 campo "Não usar" não é apagado ao salvar sem ele');
  perform public._como(sa, null);
  perform public.admin_definir_regras_etapa(t_a, a_ag, '{}', null, 'Etapa sem exigências');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.etapa_regras where etapa_id = a_ag)
                     and (select temperatura = 'quente' from public.negociacoes where id = nvelha),
                     'O2 regra removida: etapa volta ao padrão e o valor continua lá');

  -- ================================================================= X. reativação
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.admin_reativar_empresa(%L, 'tentativa')$q$, t_a));
  perform public._ok(v_r like '42501:%', 'X0 só o Super Admin reativa');
  perform public._como(sa, null);
  v_r := public._recusa(format($q$select public.admin_reativar_empresa(%L, 'sem estar inativa')$q$, t_a));
  perform public._ok(v_r like '22023:%não está inativa%', 'X1 empresa ativa não é "reativada" (não vira Ativa por engano)');

  -- ativa → suspensa → reativar = ativa
  perform public._como(null, null);
  update public.assinaturas set renovacao_em = now() + interval '20 days' where tenant_id = t_a;
  select * into v_ass from public.assinaturas where tenant_id = t_a;
  perform public._como(sa, null);
  perform public.admin_suspender_empresa(t_a, 'Teste ativa');
  perform public._ok((public.admin_reativacao_previa(t_a) ->> 'estado_anterior') = 'ativa', 'X2 prévia mostra o estado anterior (Ativa)');
  perform public.admin_reativar_empresa(t_a, 'Teste ativa');
  perform public._como(null, null);
  perform public._ok((select status = 'ativa' and renovacao_em = v_ass.renovacao_em and plano_id = v_ass.plano_id and ciclo = v_ass.ciclo
                        from public.assinaturas where tenant_id = t_a) and (select status = 'ativo' from public.tenants where id = t_a),
                     'X3 ativa volta ativa, sem mexer em plano, ciclo ou renovação');

  -- vencida → suspensa → reativar = vencida (nunca ativa)
  update public.assinaturas set status = 'vencida', renovacao_em = now() - interval '5 days' where tenant_id = t_a;
  perform public._como(sa, null);
  perform public.admin_suspender_empresa(t_a, 'Inadimplente');
  perform public._ok((public.admin_reativacao_previa(t_a) ->> 'estado_anterior') = 'vencida'
                     and not ((public.admin_reativacao_previa(t_a) -> 'opcoes') ? 'ativa'),
                     'X4 prévia: volta Vencida; Ativa não é oferecida sem período pago');
  perform public.admin_reativar_empresa(t_a, 'Pediu para consultar os dados');
  perform public._como(null, null);
  perform public._ok((select status = 'vencida' and renovacao_em < now() from public.assinaturas where tenant_id = t_a),
                     'X5 vencida volta VENCIDA, com a mesma data (nada renovado)');
  perform public._ok((select detalhes ->> 'decisao' = 'estado_anterior' and detalhes ->> 'assinatura_depois' = 'vencida'
                        and detalhes ->> 'assinatura_antes_da_inativacao' = 'vencida' and ator_id = sa
                        from public.admin_auditoria where acao = 'empresa_reativada' and tenant_id = t_a order by id desc limit 1),
                     'X6 auditoria: estado anterior, resultado e quem fez');
  -- escolher Ativa sem período pago: recusado
  perform public._como(sa, null);
  perform public.admin_suspender_empresa(t_a, 'De novo');
  v_r := public._recusa(format($q$select public.admin_reativar_empresa(%L, 'quero ativa', 'ativa')$q$, t_a));
  perform public._ok(v_r like '22023:%não concede assinatura Ativa%', 'X7 escolher Ativa sem período pago em vigor: recusado');
  v_r := public._recusa(format($q$select public.admin_reativar_empresa(%L, 'quero teste', 'teste')$q$, t_a));
  perform public._ok(v_r like '22023:%não cria nem estende teste%', 'X8 escolher Teste sem teste em vigor: recusado');
  perform public._como(null, null);
  perform public._ok((select status = 'suspensa' from public.assinaturas where tenant_id = t_a), 'X9 ...e a empresa continua suspensa');
  -- vencida → arquivada (cancelada) → reativar = vencida
  perform public._como(sa, null);
  perform public.admin_arquivar_empresa(t_a, 'Arquivada após suspensão');
  perform public.admin_reativar_empresa(t_a, 'Voltou a conversar');
  perform public._como(null, null);
  perform public._ok((select status = 'vencida' and cancelada_em is null from public.assinaturas where tenant_id = t_a),
                     'X10 arquivada depois de suspensa: volta ao estado de antes da inativação (vencida)');

  -- teste em vigor → suspensa → reativar = teste, mesma data
  update public.assinaturas set status = 'teste', teste_ate = now() + interval '7 days', renovacao_em = null where tenant_id = t_a;
  select * into v_ass from public.assinaturas where tenant_id = t_a;
  perform public._como(sa, null);
  perform public.admin_suspender_empresa(t_a, 'Teste em vigor');
  perform public.admin_reativar_empresa(t_a, 'Teste em vigor');
  perform public._como(null, null);
  perform public._ok((select status = 'teste' and teste_ate = v_ass.teste_ate from public.assinaturas where tenant_id = t_a)
                     and (select status = 'teste' from public.tenants where id = t_a), 'X11 teste em vigor volta teste, sem estender a data');
  -- teste vencido → suspensa → reativar = teste (como estava), nunca ativa e sem estender
  update public.assinaturas set teste_ate = now() - interval '3 days' where tenant_id = t_a;
  select * into v_ass from public.assinaturas where tenant_id = t_a;
  perform public._como(sa, null);
  perform public.admin_suspender_empresa(t_a, 'Teste vencido');
  perform public.admin_reativar_empresa(t_a, 'Teste vencido');
  perform public._como(null, null);
  perform public._ok((select status = 'teste' and teste_ate = v_ass.teste_ate from public.assinaturas where tenant_id = t_a),
                     'X12 teste vencido: volta como estava (não vira Ativa, data não muda)');

  -- cancelada sem registro anterior (assinatura criada já cancelada): exige escolha explícita
  perform set_config('rx7.origem_assinatura', 'sistema', true);
  delete from public.assinaturas where tenant_id = t_g;
  insert into public.assinaturas (tenant_id, plano_id, status, renovacao_em)
    select t_g, id, 'cancelada', now() - interval '40 days' from public.planos where codigo = 'starter';
  perform public._como(sa, null);
  v_j := public._detalhe(format($q$select public.admin_reativar_empresa(%L, 'Voltou')$q$, t_g));
  perform public._ok(v_j ->> 'sqlstate' = '22023' and v_j ->> 'hint' = 'escolha_necessaria', 'X13 cancelada sem estado anterior: exige decisão explícita');
  perform public._ok((public.admin_reativacao_previa(t_g) ->> 'estado_anterior') is null
                     and (public.admin_reativacao_previa(t_g) -> 'opcoes') = '["vencida"]'::jsonb,
                     'X14 prévia: sem registro, só Vencida é oferecida (sem pagamento nem teste em vigor)');
  v_r := public._recusa(format($q$select public.admin_reativar_empresa(%L, 'Voltou', 'ativa')$q$, t_g));
  perform public._ok(v_r like '22023:%não concede%', 'X15 ...Ativa recusada');
  perform public.admin_reativar_empresa(t_g, 'Voltou para consultar', 'vencida');
  perform public._como(null, null);
  perform public._ok((select status = 'vencida' and renovacao_em < now() from public.assinaturas where tenant_id = t_g)
                     and (select detalhes ->> 'decisao' = 'decisao_explicita' and detalhes ->> 'escolha_informada' = 'vencida'
                            from public.admin_auditoria where acao = 'empresa_reativada' and tenant_id = t_g order by id desc limit 1),
                     'X16 decisão explícita (Vencida) aplicada e auditada como tal');

  -- empresa sem assinatura: volta ao estado anterior, nenhuma assinatura é criada
  select count(*) into v_n from public.assinaturas;
  select status::text into v_r from public.tenants where id = t_b;
  perform public._como(sa, null);
  perform public.admin_suspender_empresa(t_b, 'Sem assinatura');
  perform public.admin_reativar_empresa(t_b, 'Sem assinatura');
  perform public._como(null, null);
  perform public._ok((select status::text = v_r from public.tenants where id = t_b) and (select count(*) from public.assinaturas) = v_n
                     and not exists (select 1 from public.assinaturas where tenant_id = t_b),
                     'X17 sem assinatura: volta como estava (' || v_r || '), sem criar plano nem assinatura');
  perform public._ok(not exists (select 1 from public.pagamento_eventos), 'X18 nenhuma cobrança ou evento de pagamento gerado');

  raise notice 'regras_etapas_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
