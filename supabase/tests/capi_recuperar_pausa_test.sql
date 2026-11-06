set client_encoding = 'UTF8';
-- ===========================================================================
-- Teste da PROPOSTA 20261115090200_capi_recuperar_pausa.sql (recuperação controlada da CAPI).
-- ONDE RODAR: só cópia LOCAL crm_rx7_* com 20261115090000..090200 aplicadas. Termina em ROLLBACK.
-- Nada sai para a Meta: só a fila do banco é exercitada.
--
--  R1  durante a pausa nenhum evento nasce (comportamento atual, preservado)
--  R2  só o Super Admin, com confirmação exata e motivo
--  R3  recusa com a conexão pausada e com a empresa travada
--  R4  com a conexão ativa: recupera a 1ª entrada de cada etapa mapeada, com event_id estável e o horário real;
--      NUNCA recupera o evento de ENTRADA (etapa em que a negociação nasceu, ex.: Lead Novo)
--  R5  sem ID do lead da Meta: fica "sem correspondência"; mais de 7 dias: fora do prazo, não entra
--  R6  chamar de novo não duplica; evento que já existia não muda
--  R7  isolamento: outra empresa não é tocada
--  R8  auditado; capi_reservar entrega os recuperados (sem valor, sem contato) e respeita a trava
-- ===========================================================================
begin;

do $$
begin
  if current_database() not like 'crm_rx7_%' then
    raise exception 'Teste só para cópia local crm_rx7_* (banco atual: %).', current_database();
  end if;
  if to_regprocedure('public.admin_capi_recuperar_eventos(uuid, timestamptz, text, text)') is null then
    raise exception 'Aplique antes as propostas 20261115090000 a 20261115090200 nesta cópia local.';
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

create function public._lead_meta(p_tenant uuid, p_dono uuid, p_tel text, p_leadgen text)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid; v_e uuid;
begin
  select e.id into v_e from public.etapas_funil e join public.funis f on f.id = e.funil_id where f.tenant_id = p_tenant and f.padrao and e.etapa_inicial;
  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, email, owner_id)
  values (p_tenant, 'pessoa_fisica', 'Lead ' || p_tel, p_tel, 'lead' || p_tel || '@exemplo.test', p_dono) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, v_e, 'formulario', 'rec-' || p_tel,
          case when p_leadgen is null then '{"source":"manual"}'::jsonb else jsonb_build_object('source', 'meta_lead_ads', 'leadgen_id', p_leadgen) end)
  returning id into v_neg;
  return v_neg;
end;
$$;

-- Move a negociação de etapa como o próprio funil faz (grava em historico_etapas).
create function public._mover(p_neg uuid, p_etapa uuid, p_uid uuid, p_slug text)
returns void language plpgsql as $$
begin
  perform public._como(p_uid, p_slug);
  update public.negociacoes set etapa_id = p_etapa where id = p_neg;
  perform public._como(null, null);
end;
$$;

do $$
declare
  g_a   uuid := '60000000-0000-4000-8000-0000000000a1';
  g_b   uuid := '60000000-0000-4000-8000-0000000000b1';
  sup   uuid := '60000000-0000-4000-8000-0000000000ff';
  t_a   uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  t_b   uuid := '82c2cd79-b9aa-4b4d-8de9-88d51065ca7f';
  fa1 uuid; ea1 uuid; ea_mql uuid; ea_ganha uuid; fb1 uuid; eb1 uuid; eb2 uuid;
  v_con_a uuid; v_con_b uuid; v_desde timestamptz;
  n1 uuid; n2 uuid; n_sem uuid; n_velho uuid; n_b uuid;
  v_r text; v_n integer; v_antes integer; v_ev public.meta_conversoes_eventos; v_ok boolean;
begin
  perform public._como(null, null);
  update public.plataforma_integracoes set meta_conversoes = true;
  delete from public.meta_conversoes_travas where tenant_id in (t_a, t_b);
  delete from public.meta_conversoes_conexoes where tenant_id in (t_a, t_b);
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where codigo = 'business' and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status)
  select t, (select id from public.planos where codigo = 'business'), 'ativa' from unnest(array[t_a, t_b]) t
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  insert into public.super_admins (user_id) values (sup) on conflict do nothing;

  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into ea_mql from public.etapas_funil where funil_id = fa1 and tipo = 'aberta' and not etapa_inicial order by ordem limit 1;
  select id into ea_ganha from public.etapas_funil where funil_id = fa1 and tipo = 'ganha';
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;
  select id into eb2 from public.etapas_funil where funil_id = fb1 and tipo = 'aberta' and not etapa_inicial order by ordem limit 1;

  perform public._servico();
  v_con_a := public.capi_salvar_conexao(t_a, g_a, '700000000000001', '800000000000001', 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx');
  v_con_b := public.capi_salvar_conexao(t_b, g_b, '700000000000002', '800000000000002', 'Dataset B', 'token-sistema-beta-xxxxxxxxxx');
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_definir_configuracao(array[fa1]::uuid[], jsonb_build_array(
    jsonb_build_object('etapa_id', ea1, 'evento', 'Lead Novo'),
    jsonb_build_object('etapa_id', ea_mql, 'evento', 'MQL'),
    jsonb_build_object('etapa_id', ea_ganha, 'evento', 'Fechado', 'enviar_valor', true)), false);
  perform public.capi_acao('ativar');
  perform public._como(g_b, 'teste-beta');
  perform public.capi_definir_configuracao(array[fb1]::uuid[], jsonb_build_array(jsonb_build_object('etapa_id', eb2, 'evento', 'Qualificado')), false);
  perform public.capi_acao('ativar');

  -- ================================================================= R1 pausa: nada nasce
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_acao('pausar');
  perform public._como(g_b, 'teste-beta');
  perform public.capi_acao('pausar');
  perform public._como(null, null);
  v_desde := now() - interval '1 minute';
  select count(*) into v_antes from public.meta_conversoes_eventos where tenant_id in (t_a, t_b);
  n1 := public._lead_meta(t_a, g_a, '5511987000001', '901000000000001');
  perform public._mover(n1, ea_mql, g_a, 'teste-alfa');
  n2 := public._lead_meta(t_a, g_a, '5511987000002', '901000000000002');
  perform public._mover(n2, ea_mql, g_a, 'teste-alfa');
  perform public._mover(n2, ea1, g_a, 'teste-alfa');
  perform public._mover(n2, ea_mql, g_a, 'teste-alfa');           -- volta à MQL: só a 1ª entrada conta
  n_sem := public._lead_meta(t_a, g_a, '5511987000003', null);
  perform public._mover(n_sem, ea_mql, g_a, 'teste-alfa');
  n_velho := public._lead_meta(t_a, g_a, '5511987000004', '901000000000004');
  perform public._mover(n_velho, ea_mql, g_a, 'teste-alfa');
  -- entrada antiga (mais de 7 dias) na MQL: simulada pelo horário do histórico
  update public.historico_etapas set created_at = now() - interval '8 days' where negociacao_id = n_velho and etapa_nova_id = ea_mql;
  n_b := public._lead_meta(t_b, g_b, '5511987000005', '901000000000005');
  perform public._mover(n_b, eb2, g_b, 'teste-beta');
  perform public._ok((select count(*) from public.meta_conversoes_eventos where tenant_id in (t_a, t_b)) = v_antes,
                     'R1 com a conexão pausada nenhum evento nasce (comportamento atual preservado)');

  -- ================================================================= R2 só Super Admin, com confirmação e motivo
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format($q$select * from public.admin_capi_recuperar_eventos(%L, %L, 'Administrador tentando recuperar', 'RECUPERAR EVENTOS teste-alfa')$q$, t_a, now() - interval '8 days'));
  perform public._ok(v_r like '42501%', 'R2 Administrador da empresa não recupera: ' || v_r);
  perform public._como(null, null);
  perform public._ok(not has_function_privilege('anon', 'public.admin_capi_recuperar_eventos(uuid, timestamptz, text, text)', 'execute'),
                     'R2 anônimo não executa');
  perform public._como(sup, null);
  v_r := public._recusa(format($q$select * from public.admin_capi_recuperar_eventos(%L, %L, 'Campanhas ativas sem devolutiva', 'RECUPERAR teste-alfa')$q$, t_a, now() - interval '8 days'));
  perform public._ok(v_r like '22023%', 'R2 confirmação errada recusada: ' || v_r);
  v_r := public._recusa(format($q$select * from public.admin_capi_recuperar_eventos(%L, %L, 'curto', 'RECUPERAR EVENTOS teste-alfa')$q$, t_a, now() - interval '8 days'));
  perform public._ok(v_r like '22023%', 'R2 motivo curto recusado: ' || v_r);

  -- ================================================================= R3 pausada / travada
  v_r := public._recusa(format($q$select * from public.admin_capi_recuperar_eventos(%L, %L, 'Campanhas ativas sem devolutiva', 'RECUPERAR EVENTOS teste-alfa')$q$, t_a, now() - interval '8 days'));
  perform public._ok(v_r like '55000%', 'R3 conexão pausada: recusado: ' || v_r);
  perform public.admin_capi_travar(t_a, 'Trava para o teste local da recuperação');
  v_r := public._recusa(format($q$select * from public.admin_capi_recuperar_eventos(%L, %L, 'Campanhas ativas sem devolutiva', 'RECUPERAR EVENTOS teste-alfa')$q$, t_a, now() - interval '8 days'));
  perform public._ok(v_r like '42501%', 'R3 empresa travada: recusado: ' || v_r);
  perform public.admin_capi_retirar_trava(t_a, 'Fim da trava do teste local', 'RETIRAR TRAVA teste-alfa');
  perform public._como(g_a, 'teste-alfa');
  perform public.capi_acao('retomar');

  -- ================================================================= R4 recuperação
  perform public._como(sup, null);
  create temp table _r1 on commit drop as
    select * from public.admin_capi_recuperar_eventos(t_a, now() - interval '9 days', 'Campanhas ativas sem devolutiva durante a pausa', 'RECUPERAR EVENTOS teste-alfa');
  perform public._como(null, null);
  raise notice 'R4 resultado: %', (select string_agg(evento || ' entradas=' || entradas || ' fila=' || enfileirados || ' sem=' || sem_correspondencia
                                                     || ' ja=' || ja_existiam || ' prazo=' || fora_do_prazo, ' | ') from _r1);
  perform public._ok((select count(*) from public.meta_conversoes_eventos where negociacao_id in (n1, n2) and etapa_id = ea_mql and situacao = 'pendente') = 2
                     and not exists (select 1 from public.meta_conversoes_eventos where negociacao_id in (n1, n2, n_velho) and etapa_id = ea1)
                     and (select count(*) from public.meta_conversoes_eventos where negociacao_id = n2) = 1,
                     'R4 recupera a 1ª entrada de cada etapa: MQL 2 (com ID da Meta), uma vez por etapa; Lead Novo (entrada) NUNCA');
  perform public._ok((select sum(enfileirados) from _r1) = (select count(*) from public.meta_conversoes_eventos e where e.tenant_id = t_a and e.situacao = 'pendente'
                                                              and e.event_time >= now() - interval '7 days' + interval '2 hours' and e.event_id like 'avante-%')
                     - (select count(*) from public.meta_conversoes_eventos e where e.tenant_id = t_a and e.situacao = 'pendente' and e.created_at < now() - interval '1 minute'),
                     'R4 o resumo devolvido bate com a fila');
  select * into v_ev from public.meta_conversoes_eventos where negociacao_id = n2 and etapa_id = ea_mql;
  perform public._ok(v_ev.situacao = 'pendente' and v_ev.lead_id = '901000000000002' and v_ev.conexao_id = v_con_a
                     and v_ev.event_id = 'avante-' || n2 || '-' || ea_mql
                     and v_ev.event_time = (select min(created_at) from public.historico_etapas where negociacao_id = n2 and etapa_nova_id = ea_mql),
                     'R4 event_id estável e horário real da PRIMEIRA entrada na etapa');

  -- ================================================================= R5 sem ID / fora do prazo
  perform public._ok((select situacao from public.meta_conversoes_eventos where negociacao_id = n_sem and etapa_id = ea_mql) = 'sem_correspondencia'
                     and not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_sem and etapa_id = ea1),
                     'R5 sem ID do lead da Meta: fica sem correspondência (nunca sai)');
  perform public._ok((select fora_do_prazo from _r1 where evento = 'MQL') >= 1
                     and not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_velho and etapa_id = ea_mql),
                     'R5 mais de 7 dias: fora do prazo da Meta, não entra na fila');

  -- ================================================================= R6 sem duplicar
  select count(*) into v_antes from public.meta_conversoes_eventos where tenant_id = t_a;
  perform public._como(sup, null);
  create temp table _r2 on commit drop as
    select * from public.admin_capi_recuperar_eventos(t_a, now() - interval '9 days', 'Segunda chamada da recuperação local', 'RECUPERAR EVENTOS teste-alfa');
  perform public._como(null, null);
  perform public._ok((select count(*) from public.meta_conversoes_eventos where tenant_id = t_a) = v_antes
                     and (select sum(enfileirados) + sum(sem_correspondencia) from _r2) = 0 and (select sum(ja_existiam) from _r2) >= 3,
                     'R6 chamar de novo não duplica nada');

  -- ================================================================= R7 isolamento
  perform public._ok(not exists (select 1 from public.meta_conversoes_eventos where negociacao_id = n_b),
                     'R7 a empresa B (pausada) não foi tocada pela recuperação da A');

  -- ================================================================= R8 auditoria, envio e trava
  perform public._ok((select count(*) from public.admin_auditoria where acao = 'capi_eventos_recuperados' and tenant_id = t_a) = 2,
                     'R8 cada recuperação fica auditada');
  perform public._servico();
  create temp table _lote on commit drop as select * from public.capi_reservar(200);
  perform public._como(null, null);
  perform public._ok((select count(*) from _lote where tenant_id = t_a and event_id in (select e.event_id from public.meta_conversoes_eventos e where e.negociacao_id in (n1, n2, n_velho))) = 2
                     and not exists (select 1 from _lote where email is not null or telefone is not null)
                     and not exists (select 1 from _lote where tenant_id = t_b),
                     'R8 capi_reservar entrega os 2 recuperados da A (MQL), sem contato e sem a B');
  update public.meta_conversoes_eventos set situacao = 'pendente', bloqueado_ate = null where tenant_id = t_a and situacao = 'enviando';
  perform public._como(sup, null);
  perform public.admin_capi_travar(t_a, 'Trava de novo depois da recuperação local');
  perform public._servico();
  perform public._ok(not exists (select 1 from public.capi_reservar(200) where tenant_id = t_a), 'R8 travada de novo: nada da A sai');
  perform public._como(null, null);
end;
$$;

rollback;
