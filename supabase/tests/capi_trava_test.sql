set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: trava da CAPI por empresa (migration 20261112090000).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  T0      a migration trava a Rio X7, auditado; nenhuma outra empresa travada
--  T1      tabela e funções invisíveis para usuários; só o Super Admin trava
--  T2      travar: motivo obrigatório, sem duplicar, pausa a conexão ativa, auditado
--  T3–T4   empresa travada: "ativar" e "retomar" recusados para todos (inclusive
--          Super Admin); "pausar" e o código de teste continuam
--  T5      fila geral: nada nasce, nada é reservado, token não sai — mesmo com a
--          conexão "ativa" por outro caminho e com evento pendente antigo
--  T6      outra empresa sem trava: ativa, gera evento, reserva e lê o token
--  T7      ninguém apaga, altera ou esvazia a trava por fora do procedimento
--  T8      retirar: só Super Admin, confirmação com o slug, motivo, auditado;
--          não reativa nada (o Administrador ainda precisa clicar em "Retomar")
--  T9      homologação de UM evento continua possível com a empresa travada
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

-- Lead como a planilha nativa da Meta grava (igual a capi_homologacao_test.sql): dados fictícios da ferramenta de teste.
create function public._lead(p_tenant uuid, p_dono uuid, p_etapa uuid, p_nome text, p_tel text, p_lead text, p_form text)
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
    ('id', 'l:' || p_lead, 1),
    ('form_id', 'f:' || p_form, 2),
    ('created_time', to_char((now() - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+0000"'), 3),
    ('is_organic', 'true', 4),
    ('Qual é o nome da sua Empresa?', '<test lead: dummy data for qual_é_o_nome_da_sua_empresa?>', 5),
    ('Qual o maior desafio hoje?', '<test lead: dummy data for qual_o_maior_desafio_hoje?>', 6)
  ) x(c, v, o);
  return v_neg;
end;
$$;

-- Negociação com ID de Lead Ads (como o meta-webhooks grava): na entrada já gera o histórico da etapa inicial.
create function public._negocio_meta(p_tenant uuid, p_dono uuid, p_etapa uuid, p_tel text, p_leadgen text)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid;
begin
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id)
  values (p_tenant, 'pessoa_fisica', 'Lead ' || p_tel, p_tel, p_dono) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, p_etapa, 'formulario', 'trava-' || p_tel, jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', p_leadgen))
  returning id into v_neg;
  return v_neg;
end;
$$;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  sup   uuid := '60000000-0000-4000-8000-0000000000ff';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  t_rio uuid := 'a0000000-0000-4000-8000-000000000002';
  ds_a  text := '800000000000001';
  ds_b  text := '800000000000002';
  form  text := '1459591029473591';
  fa1 uuid; ea1 uuid; ea_real uuid; fb1 uuid; eb1 uuid; eb_real uuid;
  v_con_a uuid; v_con_b uuid; n_a uuid; n_b uuid; n_h uuid;
  v_r text; v_n integer; v_p record; v_aud public.admin_auditoria;
  p_business uuid;
begin
  perform public._como(null, null);

  -- ================================================================= T0 a migration trava a Rio X7
  perform public._ok((select count(*) = 1 from public.meta_conversoes_travas) and public.capi_travada(t_rio),
                     'T0 migration: só a Rio X7 travada');
  perform public._ok(not public.capi_travada(t_a) and not public.capi_travada(t_b), 'T0 ...nenhuma outra empresa travada');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'capi_trava_aplicada' and tenant_id = t_rio
                               and detalhes ->> 'origem' = 'migration 20261112090000'), 'T0 ...trava da Rio X7 auditada');

  -- Cenário: chave global da CAPI ligada, A e B no Business com o recurso, dois datasets conectados, mapeados e ativos.
  update public.plataforma_integracoes set meta_conversoes = true;
  delete from public.meta_conversoes_conexoes where tenant_id in (t_a, t_b);
  select id into p_business from public.planos where codigo = 'business';
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where id = p_business and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_a, p_business, 'ativa'), (t_b, p_business, 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_real from public.etapas_funil where funil_id = fa1 and chave = 'reuniao_realizada';
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;
  select id into eb_real from public.etapas_funil where funil_id = fb1 and chave = 'reuniao_realizada';

  perform public._servico();
  v_con_a := public.capi_salvar_conexao(t_a, g_a, '700000000000001', ds_a, 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx');
  v_con_b := public.capi_salvar_conexao(t_b, g_b, '700000000000002', ds_b, 'Dataset B', 'token-sistema-beta-xxxxxxxxxx');
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_definir_configuracao(array[fa1]::uuid[], jsonb_build_array(
    jsonb_build_object('etapa_id', ea1, 'evento', 'Lead recebido'), jsonb_build_object('etapa_id', ea_real, 'evento', 'Reunião realizada')), false);
  perform public.capi_acao('ativar');
  perform public._como(g_b, 'teste-beta');
  perform public.capi_definir_configuracao(array[fb1]::uuid[], jsonb_build_array(
    jsonb_build_object('etapa_id', eb1, 'evento', 'Lead recebido'), jsonb_build_object('etapa_id', eb_real, 'evento', 'Reunião realizada')), false);
  perform public.capi_acao('ativar');
  perform public._como(null, null);
  perform public._ok((select count(*) = 2 from public.meta_conversoes_conexoes where id in (v_con_a, v_con_b) and situacao = 'ativa'),
                     'T0 cenário: A e B sem trava ativam normalmente');

  -- ================================================================= T1 permissões
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa('select count(*) from public.meta_conversoes_travas');
  perform public._ok(v_r like '42501:%', 'T1 Administrador não lê a tabela de travas');
  v_r := public._recusa(format($q$insert into public.meta_conversoes_travas (tenant_id, motivo) values (%L, 'tentativa de travar')$q$, t_b));
  perform public._ok(v_r like '42501:%', 'T1 ...nem grava nela');
  v_r := public._recusa(format('select public.capi_travada(%L)', t_a));
  perform public._ok(v_r like '42501:%', 'T1 ...nem chama a consulta interna');
  v_r := public._recusa(format($q$select public.admin_capi_travar(%L, 'Administrador tentando travar')$q$, t_a));
  perform public._ok(v_r like '42501:%', 'T1 Administrador da empresa não trava (só Super Admin)');
  perform public._como(null, null);
  perform set_config('role', 'anon', true);
  v_r := public._recusa('select count(*) from public.meta_conversoes_travas');
  perform public._ok(v_r like '42501:%', 'T1 anônimo não lê a tabela');
  v_r := public._recusa(format($q$select public.admin_capi_retirar_trava(%L, 'tentativa anônima', 'RETIRAR TRAVA rio-x7')$q$, t_rio));
  perform public._ok(v_r like '42501:%', 'T1 anônimo não chama o procedimento');
  perform public._como(null, null);

  -- ================================================================= T2 travar (Super Admin)
  perform public._como(sup, null);
  v_r := public._recusa(format($q$select public.admin_capi_travar(%L, 'curto')$q$, t_a));
  perform public._ok(v_r like '22023:%', 'T2 motivo curto: recusado');
  v_r := public._recusa($q$select public.admin_capi_travar('00000000-0000-4000-8000-000000000000', 'Empresa que não existe aqui')$q$);
  perform public._ok(v_r like 'P0002:%', 'T2 empresa inexistente: recusada');
  perform public.admin_capi_travar(t_a, 'Homologação da CAPI pendente (teste local)');
  v_r := public._recusa(format($q$select public.admin_capi_travar(%L, 'Segunda trava da mesma empresa')$q$, t_a));
  perform public._ok(v_r like '23505:%', 'T2 empresa já travada: sem duplicar');
  perform public._como(null, null);
  perform public._ok(public.capi_travada(t_a) and (select travada_por = sup from public.meta_conversoes_travas where tenant_id = t_a),
                     'T2 Super Admin travou A (com autoria)');
  perform public._ok((select situacao = 'pausada' from public.meta_conversoes_conexoes where id = v_con_a), 'T2 ...e a conexão ativa de A foi pausada');
  select * into v_aud from public.admin_auditoria where acao = 'capi_trava_aplicada' and tenant_id = t_a order by id desc limit 1;
  perform public._ok(v_aud.ator_id = sup and (v_aud.detalhes ->> 'pausou_conexao')::boolean, 'T2 ...auditado, com a pausa registrada');
  perform public._ok((select situacao = 'ativa' from public.meta_conversoes_conexoes where id = v_con_b) and not public.capi_travada(t_b),
                     'T2 B intocada');

  -- ================================================================= T3 ativar/retomar recusados
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa($q$select public.capi_acao('retomar')$q$);
  perform public._ok(v_r like '42501:%travado%', 'T3 Administrador: "Retomar" recusado com a mensagem da trava');
  v_r := public._recusa($q$select public.capi_acao('ativar')$q$);
  perform public._ok(v_r like '42501:%travado%', 'T3 Administrador: "Ativar" recusado');
  -- Super Admin pelo "Acessar CRM" (janela auditada aberta): entra como Administrador, mas a trava vale igual.
  perform public._como(null, null);
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_a, 'teste local', 's1', now(), now() + interval '1 hour');
  perform public._como(sup, 'teste-alfa');
  v_r := public._recusa($q$select public.capi_acao('retomar')$q$);
  perform public._ok(v_r like '42501:%travado%', 'T3 nem o Super Admin retoma pelo "Acessar CRM"');
  perform public._como(null, null);
  perform public._ok((select situacao = 'pausada' from public.meta_conversoes_conexoes where id = v_con_a)
                     and not exists (select 1 from public.admin_auditoria where tenant_id = t_a and acao in ('capi_ativar', 'capi_retomar')
                                       and criado_em > (select travada_em from public.meta_conversoes_travas where tenant_id = t_a)),
                     'T3 ...conexão continua pausada; nenhuma ativação registrada');

  -- ================================================================= T4 pausar e código de teste continuam
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa($q$select public.capi_acao('pausar')$q$);
  perform public._ok(v_r = 'aceito', 'T4 "Pausar" sempre disponível');
  v_r := public._recusa($q$select public.capi_acao('definir_codigo_teste', 'TEST123')$q$);
  perform public._ok(v_r = 'aceito', 'T4 código de teste continua configurável');
  perform public.capi_acao('definir_codigo_teste', null);
  perform public._ok((select situacao = 'pausada' and conexao_id = v_con_a from public.capi_da_empresa()), 'T4 a tela da empresa continua carregando');
  perform public._como(null, null);

  -- ================================================================= T5 fila geral respeita a trava
  -- Conexão de A "ativa" por outro caminho (ex.: SQL avulso) + um evento pendente antigo de A.
  update public.meta_conversoes_conexoes set situacao = 'ativa' where id = v_con_a;
  n_a := public._negocio_meta(t_a, g_a, ea1, '5511977770001', '111111111111111');
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_a), 'T5 empresa travada: nenhum evento nasce');
  insert into public.meta_conversoes_eventos (tenant_id, conexao_id, negociacao_id, funil_id, etapa_id, evento, event_id, event_time, lead_id, situacao)
  values (t_a, v_con_a, n_a, fa1, ea1, 'Lead recebido', 'avante-' || n_a || '-' || ea1, now(), '111111111111111', 'pendente');
  n_b := public._negocio_meta(t_b, g_b, eb1, '5511977770002', '222222222222222');
  perform public._ok((select situacao = 'pendente' from public.meta_conversoes_eventos where negociacao_id = n_b), 'T6 B sem trava: evento nasce');
  perform public._servico();
  select count(*) into v_n from public.capi_reservar(50) r where r.tenant_id = t_a;
  perform public._ok(v_n = 0, 'T5 fila não reserva evento da empresa travada (mesmo "ativa")');
  perform public._ok(public.capi_obter_token(v_con_a) is null, 'T5 ...e o token de A não sai');
  perform public._ok(public.capi_obter_token(v_con_b) = 'token-sistema-beta-xxxxxxxxxx', 'T6 token de B sai normalmente');
  perform public._como(null, null);
  perform public._ok((select situacao = 'pendente' and tentativas = 0 from public.meta_conversoes_eventos where negociacao_id = n_a),
                     'T5 ...evento de A fica parado, sem tentativa');
  perform public._ok((select situacao = 'enviando' from public.meta_conversoes_eventos where negociacao_id = n_b), 'T6 evento de B reservado para envio');
  delete from public.meta_conversoes_eventos where negociacao_id = n_a;
  update public.meta_conversoes_conexoes set situacao = 'pausada' where id = v_con_a;

  -- ================================================================= T7 ninguém retira a trava por fora
  v_r := public._recusa(format('delete from public.meta_conversoes_travas where tenant_id = %L', t_a));
  perform public._ok(v_r like '42501:%', 'T7 apagar direto (dono do banco): recusado');
  v_r := public._recusa(format($q$update public.meta_conversoes_travas set motivo = 'motivo trocado por fora' where tenant_id = %L$q$, t_a));
  perform public._ok(v_r like '42501:%', 'T7 alterar direto: recusado');
  v_r := public._recusa('truncate public.meta_conversoes_travas');
  perform public._ok(v_r like '42501:%', 'T7 esvaziar a tabela: recusado');
  perform public._servico();
  v_r := public._recusa(format('delete from public.meta_conversoes_travas where tenant_id = %L', t_a));
  perform public._ok(v_r like '42501:%', 'T7 service_role também não apaga');
  perform public._como(null, null);
  perform public._ok(public.capi_travada(t_a) and public.capi_travada(t_rio), 'T7 ...travas de A e da Rio X7 continuam');

  -- ================================================================= T8 retirar (Super Admin)
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select public.admin_capi_retirar_trava(%L, 'Administrador tentando destravar', 'RETIRAR TRAVA teste-alfa')$q$, t_a));
  perform public._ok(v_r like '42501:%', 'T8 Administrador da empresa não retira a trava');
  perform public._como(sup, null);
  v_r := public._recusa(format($q$select public.admin_capi_retirar_trava(%L, 'Homologação concluída no teste', 'retirar trava teste-alfa')$q$, t_a));
  perform public._ok(v_r like '22023:%', 'T8 confirmação diferente do texto exato: recusada');
  v_r := public._recusa(format($q$select public.admin_capi_retirar_trava(%L, 'Homologação concluída no teste', 'RETIRAR TRAVA rio-x7')$q$, t_a));
  perform public._ok(v_r like '22023:%', 'T8 confirmação com o slug de outra empresa: recusada');
  v_r := public._recusa(format($q$select public.admin_capi_retirar_trava(%L, 'curto', 'RETIRAR TRAVA teste-alfa')$q$, t_a));
  perform public._ok(v_r like '22023:%', 'T8 motivo curto: recusado');
  v_r := public._recusa(format($q$select public.admin_capi_retirar_trava(%L, 'B nunca foi travada aqui', 'RETIRAR TRAVA teste-beta')$q$, t_b));
  perform public._ok(v_r like 'P0002:%', 'T8 empresa sem trava: nada a retirar');
  perform public.admin_capi_retirar_trava(t_a, 'Homologação concluída no teste local', 'RETIRAR TRAVA teste-alfa');
  perform public._como(null, null);
  perform public._ok(not public.capi_travada(t_a) and public.capi_travada(t_rio), 'T8 trava de A retirada; a da Rio X7 continua');
  perform public._ok(coalesce(current_setting('rx7.capi_trava_procedimento', true), '') = '', 'T8 ...a marca do procedimento não fica ligada');
  select * into v_aud from public.admin_auditoria where acao = 'capi_trava_retirada' and tenant_id = t_a order by id desc limit 1;
  perform public._ok(v_aud.ator_id = sup and v_aud.detalhes ->> 'motivo' = 'Homologação concluída no teste local'
                     and v_aud.detalhes ->> 'motivo_da_trava' = 'Homologação da CAPI pendente (teste local)', 'T8 ...auditado (quem, por quê e a trava anterior)');
  perform public._ok((select situacao = 'pausada' from public.meta_conversoes_conexoes where id = v_con_a), 'T8 retirar não reativa: conexão continua pausada');
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_acao('retomar');
  perform public._como(null, null);
  perform public._ok((select situacao = 'ativa' from public.meta_conversoes_conexoes where id = v_con_a), 'T8 ...só o "Retomar" do Administrador volta a ativar');

  -- ================================================================= T9 homologação de UM evento com a empresa travada
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_acao('pausar');
  perform public._como(sup, null);
  perform public.admin_capi_travar(t_a, 'Trava de novo para a homologação local');
  perform public._como(null, null);
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('meta_conversoes', t_a) on conflict do nothing;
  delete from public.super_admin_acessos where user_id = sup and tenant_id = t_a;
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_a, 'teste local', 's1', now(), now() + interval '1 hour');
  n_h := public._lead(t_a, g_a, ea1, 'Lead teste homologação', '5511977770003', '333333333333333', form);
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_h), 'T9 lead de teste não entra na fila geral (empresa travada)');
  perform public._servico();
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_h, '333333333333333', ds_a, form, false);
  perform public._ok(v_p.id_evento = 'avante-homologacao-' || n_h and v_p.credencial is null and not v_p.ja_feita,
                     'T9 conferência da homologação passa com a trava');
  select * into v_p from public.capi_homologacao_preparar(t_a, sup, n_h, '333333333333333', ds_a, form, true);
  perform public._ok(v_p.homologacao is not null and v_p.credencial = 'token-sistema-alfa-xxxxxxxxxx', 'T9 ...e a reserva do evento único também');
  perform public._como(null, null);
  perform public._ok(public.capi_travada(t_a) and (select situacao = 'pausada' from public.meta_conversoes_conexoes where id = v_con_a),
                     'T9 ...sem mexer na trava nem na conexão');
end;
$$;

rollback;
