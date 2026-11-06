set client_encoding = 'UTF8';
-- ===========================================================================
-- Teste do CORTE POR DATA DE ATIVAÇÃO (Opção A da Rio X7: sem históricos).
-- ONDE RODAR: cópia LOCAL crm_rx7_* com 20261115090000..090300 aplicadas.
-- Só dados fictícios. Termina em ROLLBACK. Nada sai para a Meta.
--
--  C0  a migration arma o corte só da Rio X7, ainda sem data (nada sai antes da ativação)
--  C1  antes da ativação: eventos antigos já enfileirados (pendente, retido) viram
--      "descartado" com o motivo; nada da Rio X7 entra no lote; a data real não muda
--  C2  a primeira ativação fixa o início da transmissão (auditado)
--  C3  reprocessar evento antigo rejeitado: recusado, com a mensagem certa
--  C4  evento antigo forçado para "pendente" por fora: vira "descartado" na hora
--  C5  evento com ocorrência depois da ativação: sai normalmente
--  C6  pausar e retomar NÃO move o corte
--  C7  recuperação não cria nada anterior ao corte
--  X1  outra empresa (sem corte): evento antigo na fila sai como hoje
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
  if to_regclass('public.meta_conversoes_corte_empresa') is null then
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
create function public._erro(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function public._erro(text) to authenticated, service_role, anon;
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
create function public._lead(p_tenant uuid, p_tel text, p_leadgen text)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid; v_e uuid;
begin
  select e.id into v_e from public.etapas_funil e join public.funis f on f.id = e.funil_id where f.tenant_id = p_tenant and f.padrao and e.etapa_inicial;
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, owner_id)
  values (p_tenant, 'pessoa_fisica', 'Lead ' || p_tel, p_tel,
          (select m.user_id from public.tenant_memberships m
            where m.tenant_id = p_tenant and m.ativo and m.user_id not in (select s.user_id from public.super_admins s)
            order by m.user_id limit 1)) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, v_e, 'formulario', 'rx-' || p_tel, jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', p_leadgen))
  returning id into v_neg;
  insert into public.negociacao_respostas (tenant_id, negociacao_id, envio, chave, pergunta, resposta, ordem)
  values (p_tenant, v_neg, 'linha-' || p_tel, 'created_time', 'created_time',
          to_char((now() - interval '5 minutes') at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00', 1);
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
create function public._ev(p_neg uuid, p_etapa uuid)
returns text language sql as $$ select 'avante-' || p_neg || '-' || p_etapa $$;

do $$
declare
  sup   uuid := '60000000-0000-4000-8000-0000000000ff';
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  t_rx  uuid := 'a0000000-0000-4000-8000-000000000002';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  f_rx uuid; e_novo uuid; e_ag uuid; e_reu uuid; e_fech uuid; fb uuid; eb_ini uuid;
  c_rx uuid; c_b uuid;
  n_p uuid; n_v uuid; n_r uuid; n_novo uuid; n_rec_antes uuid; n_rec_depois uuid; n_b uuid;
  v_corte timestamptz; v_msg text;
begin
  perform public._como(null, null);

  -- ================================================================= C0
  perform public._ok((select transmitir_desde is null from public.meta_conversoes_corte_empresa where tenant_id = t_rx)
                     and (select count(*) from public.meta_conversoes_corte_empresa) = 1
                     and public.capi_corte_da_empresa(t_rx) = 'infinity'::timestamptz
                     and public.capi_corte_da_empresa(t_b) = '-infinity'::timestamptz,
                     'C0 corte armado só na Rio X7, ainda sem data (nada sai antes da ativação); outras empresas sem corte');

  -- ================================================================= preparação local (fictícia)
  update public.plataforma_integracoes set meta_conversoes = true;
  insert into public.super_admins (user_id) values (sup) on conflict do nothing;
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_rx, 'teste local', 's1', now(), now() + interval '1 hour');
  insert into public.tenant_memberships (tenant_id, user_id, papel, ativo) values (t_rx, g_a, 'gerente', true) on conflict do nothing;
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where codigo = 'business' and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_b, (select id from public.planos where codigo = 'business'), 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  select id into f_rx from public.funis where tenant_id = t_rx and nome = 'Funil Principal';
  select id into e_novo from public.etapas_funil where funil_id = f_rx and etapa_inicial;
  select id into e_ag from public.etapas_funil where funil_id = f_rx and chave = 'reuniao_agendada';
  select id into e_reu from public.etapas_funil where funil_id = f_rx and chave = 'reuniao_realizada';
  select id into e_fech from public.etapas_funil where funil_id = f_rx and tipo = 'ganha';
  select id into fb from public.funis where tenant_id = t_b and padrao;
  select id into eb_ini from public.etapas_funil where funil_id = fb and etapa_inicial;
  perform public._servico();
  perform public.capi_salvar_conexao(t_rx, sup, '700000000000009', '800000000000009', 'Dataset Rio X7 (local)', 'token-sistema-rio-xxxxxxxxxxxx');
  perform public.capi_salvar_conexao(t_b, g_b, '700000000000002', '800000000000002', 'Dataset B', 'token-sistema-beta-xxxxxxxxxx');
  perform public._como(g_b, 'teste-beta');
  perform public.capi_definir_configuracao(array[fb]::uuid[], jsonb_build_array(jsonb_build_object('etapa_id', eb_ini, 'evento', 'Lead recebido', 'enviar_valor', false)), false);
  perform public.capi_acao('ativar');
  perform public._como(null, null);
  select id into c_rx from public.meta_conversoes_conexoes where tenant_id = t_rx;
  select id into c_b from public.meta_conversoes_conexoes where tenant_id = t_b;

  -- Fila "acumulada" ANTES do corte existir (simula o que estivesse lá ao aplicar a migration).
  n_p := public._lead(t_rx, '5524990000301', '903000000000301');
  n_v := public._lead(t_rx, '5524990000302', '903000000000302');
  n_r := public._lead(t_rx, '5524990000303', '903000000000303');
  n_b := public._lead(t_b, '5524990000304', '903000000000304');
  delete from public.meta_conversoes_corte_empresa where tenant_id = t_rx;
  insert into public.meta_conversoes_eventos (tenant_id, conexao_id, negociacao_id, funil_id, etapa_id, evento, event_id, event_time, lead_id, enviar_valor, situacao)
  values (t_rx, c_rx, n_p, f_rx, e_reu, 'Reunião realizada', public._ev(n_p, e_reu), now() - interval '3 hours', '903000000000301', false, 'pendente'),
         (t_rx, c_rx, n_v, f_rx, e_fech, 'Fechado', public._ev(n_v, e_fech), now() - interval '2 hours', '903000000000302', true, 'valor_pendente'),
         (t_rx, c_rx, n_r, f_rx, e_reu, 'Reunião realizada', public._ev(n_r, e_reu), now() - interval '1 hour', '903000000000303', false, 'rejeitado');
  update public.meta_conversoes_eventos set event_time = now() - interval '3 hours' where negociacao_id = n_b;  -- B: antigo na fila
  insert into public.meta_conversoes_corte_empresa (tenant_id, motivo)
  values (t_rx, 'Rio X7, Opção A aprovada pelo proprietário em 06/11/2026: só eventos futuros.');

  -- ================================================================= C1 antes da ativação (o agendador roda a reserva)
  perform public._servico();
  create temp table _l0 on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from _l0 where tenant_id = t_rx), 'C1 antes da ativação: nada da Rio X7 entra no lote');
  perform public._ok((select situacao = 'descartado' and ultimo_erro like 'Anterior ao início da transmissão%' and event_time = now() - interval '3 hours'
                        from public.meta_conversoes_eventos where event_id = public._ev(n_p, e_reu))
                     and (select situacao = 'descartado' and event_time = now() - interval '2 hours' from public.meta_conversoes_eventos where event_id = public._ev(n_v, e_fech)),
                     'C1 pendente e retido antigos viram "descartado" com o motivo, e a data real não muda');
  perform public._ok((select situacao from public.meta_conversoes_eventos where event_id = public._ev(n_r, e_reu)) = 'rejeitado',
                     'C1 rejeitado antigo fica como está (não volta sozinho)');
  -- ================================================================= X1 outra empresa
  perform public._ok(exists (select 1 from _l0 where tenant_id = t_b and event_id = public._ev(n_b, eb_ini)),
                     'X1 outra empresa sem corte: evento antigo na fila sai como hoje');

  -- ================================================================= C2 primeira ativação
  perform public._como(sup, null);
  perform public.admin_capi_retirar_trava(t_rx, 'Teste local do corte da ativação', 'RETIRAR TRAVA rio-x7');
  perform public._como(sup, 'rio-x7');
  perform public.capi_acao('ativar');
  perform public._como(null, null);
  select transmitir_desde into v_corte from public.meta_conversoes_corte_empresa where tenant_id = t_rx;
  perform public._ok(v_corte = now() and public.capi_corte_da_empresa(t_rx) = now(),
                     'C2 a primeira ativação fixa o início da transmissão');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'capi_corte_alterado' and tenant_id = t_rx
                               and detalhes -> 'depois' ->> 'transmitir_desde' is not null and detalhes -> 'antes' ->> 'transmitir_desde' is null),
                     'C2 a fixação do corte fica auditada');

  -- ================================================================= C3 reprocessar antigo
  v_msg := format('select public.capi_reprocessar(%s)', (select id from public.meta_conversoes_eventos where event_id = public._ev(n_r, e_reu)));
  perform public._como(g_a, 'rio-x7');
  v_msg := public._erro(v_msg);
  perform public._como(null, null);
  perform public._ok(v_msg like '23514: Este evento é anterior ao início da transmissão%'
                     and (select situacao from public.meta_conversoes_eventos where event_id = public._ev(n_r, e_reu)) = 'rejeitado',
                     'C3 reprocessar evento anterior à ativação: recusado com a mensagem certa');

  -- ================================================================= C4 forçado por fora
  update public.meta_conversoes_eventos set situacao = 'pendente', ultimo_erro = null where event_id = public._ev(n_r, e_reu);
  perform public._ok((select situacao = 'descartado' and ultimo_erro like 'Anterior ao início%' from public.meta_conversoes_eventos where event_id = public._ev(n_r, e_reu)),
                     'C4 antigo forçado para "pendente" por fora: vira "descartado" na hora');

  -- ================================================================= C5 depois da ativação
  n_novo := public._lead(t_rx, '5524990000305', '903000000000305');
  perform public._mover(n_novo, e_reu, sup, 'rio-x7');
  perform public._servico();
  create temp table _l1 on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);
  perform public._ok(exists (select 1 from _l1 where event_id = public._ev(n_novo, e_reu)) and exists (select 1 from _l1 where event_id = public._ev(n_novo, e_novo)),
                     'C5 eventos com ocorrência depois da ativação (Lead Novo e Reunião realizada) saem normalmente');
  perform public._ok(not exists (select 1 from _l1 where event_id in (public._ev(n_p, e_reu), public._ev(n_v, e_fech), public._ev(n_r, e_reu))),
                     'C5 nenhum evento antigo sai na primeira ativação');

  -- ================================================================= C6 pausar e retomar
  perform public._como(sup, 'rio-x7');
  perform public.capi_acao('pausar');
  perform public.capi_acao('retomar');
  perform public._como(null, null);
  perform public._ok((select transmitir_desde from public.meta_conversoes_corte_empresa where tenant_id = t_rx) = v_corte,
                     'C6 pausar e retomar não move o corte');

  -- ================================================================= C7 recuperação
  n_rec_antes := public._lead(t_rx, '5524990000306', '903000000000306');
  perform public._mover(n_rec_antes, e_reu, sup, 'rio-x7');
  delete from public.meta_conversoes_eventos where negociacao_id = n_rec_antes;                    -- como se não tivesse nascido
  update public.historico_etapas set created_at = now() - interval '2 hours' where negociacao_id = n_rec_antes;  -- ocorrência anterior ao corte
  n_rec_depois := public._lead(t_rx, '5524990000307', '903000000000307');
  perform public._mover(n_rec_depois, e_reu, sup, 'rio-x7');
  delete from public.meta_conversoes_eventos where negociacao_id = n_rec_depois;                   -- ocorrência no corte, sem evento
  perform public._como(sup, null);
  perform public.admin_capi_recuperar_eventos(t_rx, now() - interval '1 day', 'Teste local: recuperação respeita o corte', 'RECUPERAR EVENTOS rio-x7');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_rec_antes),
                     'C7 recuperação não cria nada com ocorrência anterior ao corte');
  perform public._ok(exists (select 1 from public.meta_conversoes_eventos where event_id = public._ev(n_rec_depois, e_reu) and situacao = 'pendente'),
                     'C7 ...e só trata o que ocorreu depois da ativação');
  perform public._ok((select (detalhes ->> 'corte_da_ativacao')::timestamptz = v_corte from public.admin_auditoria
                       where acao = 'capi_eventos_recuperados' and tenant_id = t_rx order by id desc limit 1),
                     'C7 a auditoria da recuperação registra o corte');
end;
$$;

rollback;
