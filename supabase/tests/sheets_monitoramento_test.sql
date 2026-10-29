set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: monitoramento das planilhas pelos avisos do Google Drive
-- (migration 20261102090000). ONDE RODAR: só cópia LOCAL crm_rx7_* com as
-- migrations 20261030100000..20261031100000 + 20261102090000. Termina em ROLLBACK.
--
--  M1 fonte só é monitorável depois da 1ª leitura, ativa, liberada e com conta válida
--  M2 reservar/ativar canal: um por vez; o anterior fica "substituído"
--  M3 aviso: canal/fonte/recurso conferidos; "sync" não lê; "update" marca leitura já
--  M4 fila: reservar limpa o aviso; aviso durante a leitura → próxima imediata
--  M5 concluir sem aviso: próxima periódica com 30 s de folga
--  M6 pausa, liberação removida e conta revogada → "encerrar", nada é lido
--  M7 tarefas: renovar perto do vencimento; vencido vira encerrado; criação interrompida libera
--  M8 recusa do Google: indisponível espera 6 h; erro passageiro 15 min
--  M9 permissões: só service_role nas funções de canal; painel só do Administrador
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


create function public._ok(p_cond boolean, p_nome text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok  %', p_nome;
end;
$$;
create function public._recusa(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'aceito';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function public._ok(boolean, text) to authenticated;
grant execute on function public._recusa(text) to authenticated;

do $$
declare
  t_a uuid := (select id from public.tenants where slug = 'teste-alfa');
  t_b uuid := (select id from public.tenants where slug = 'teste-beta');
  g_a uuid := (select m.user_id from public.tenant_memberships m where m.tenant_id = t_a and m.papel in ('gerente', 'admin_empresa') and m.ativo limit 1);
  sdr uuid := (select m.user_id from public.tenant_memberships m where m.tenant_id = t_a and m.papel = 'sdr' and m.ativo limit 1);
  f_a uuid := (select id from public.funis where tenant_id = t_a order by created_at limit 1);
  e_a uuid;
  v_conta uuid := gen_random_uuid();
  v_fonte uuid := gen_random_uuid();
  v_k1 uuid;
  v_k2 uuid;
  v_r record;
  v_prox timestamptz;
begin
  select id into e_a from public.etapas_funil where funil_id = f_a and etapa_inicial;
  -- Como em produção: chave global desligada, Google liberado só para a alfa.
  update public.plataforma_integracoes set google_sheets = false, whatsapp_oficial = false, meta_conversoes = false;
  delete from public.plataforma_integracoes_empresas;
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('google_sheets', t_a);

  insert into public.integracoes_contas_google (id, tenant_id, conta_email, escopos)
  values (v_conta, t_a, 'monitoramento@alfa.test', array['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);
  insert into public.fontes_leads (id, tenant_id, tipo, nome, funil_id, etapa_id, responsavel_id)
  values (v_fonte, t_a, 'google_sheets', 'Planilha monitorada', f_a, e_a, g_a);
  insert into public.fontes_google_sheets (fonte_id, tenant_id, conta_id, planilha_id, planilha_nome, aba_id, aba_nome, mapeamento, situacao)
  values (v_fonte, t_a, v_conta, 'PLANILHAmonitorada0000000000001', 'Planilha', 0, 'Leads', '{"telefone":"Telefone"}', 'aguardando');

  -- M1
  perform public._ok(not public.sheets_fonte_monitoravel(v_fonte), 'M1 antes da 1ª leitura: não monitorável');
  perform public._ok(public.sheets_canal_reservar(v_fonte) is null, 'M1 ...e não reserva canal');
  update public.fontes_google_sheets set situacao = 'ativa', ultimo_sucesso_em = now() where fonte_id = v_fonte;
  perform public._ok(public.sheets_fonte_monitoravel(v_fonte), 'M1 depois da 1ª leitura, ativa e liberada: monitorável');
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'criar' and t.fonte_id = v_fonte) = 1, 'M1 tarefas: "criar" para a fonte');

  -- M2
  v_k1 := public.sheets_canal_reservar(v_fonte);
  perform public._ok(v_k1 is not null and (select monitoramento from public.fontes_google_sheets where fonte_id = v_fonte) = 'ativando', 'M2 canal reservado; painel "ativando"');
  perform public._ok(public.sheets_canal_reservar(v_fonte) is null, 'M2 um canal em criação por vez');
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'criar' and t.fonte_id = v_fonte) = 0, 'M2 enquanto cria, nada de "criar" de novo');
  perform public._ok(public._recusa(format('select public.sheets_canal_ativar(%L, %L, now() + interval ''1 day'')', v_k1, 'recurso com espaço')) = '22023', 'M2 recurso fora do formato é recusado');
  perform public.sheets_canal_ativar(v_k1, 'recursoA1', now() + interval '3 days');
  perform public._ok((select expira_em <= now() + interval '1 day' from public.fontes_google_sheets_canais where id = v_k1), 'M2 validade limitada a 1 dia (máximo do Google)');
  perform public._ok((select monitoramento from public.fontes_google_sheets where fonte_id = v_fonte) = 'ativo', 'M2 painel "ativo"');

  -- M3
  select * into v_r from public.sheets_canal_notificar(v_k1, v_fonte, 'recursoA1', 'sync');
  perform public._ok(v_r.acao = 'ignorar', 'M3 "sync" só confirma');
  perform public._ok((select notificacao_pendente_em from public.fontes_google_sheets where fonte_id = v_fonte) is null, 'M3 ...e não marca leitura');
  select * into v_r from public.sheets_canal_notificar(v_k1, v_fonte, 'outro-recurso', 'update');
  perform public._ok(v_r.acao = 'desconhecido', 'M3 recurso diferente do canal: desconhecido');
  select * into v_r from public.sheets_canal_notificar(v_k1, gen_random_uuid(), 'recursoA1', 'update');
  perform public._ok(v_r.acao = 'desconhecido', 'M3 fonte diferente da do canal: desconhecido');
  select * into v_r from public.sheets_canal_notificar(gen_random_uuid(), v_fonte, 'recursoA1', 'update');
  perform public._ok(v_r.acao = 'desconhecido', 'M3 canal inexistente: desconhecido');
  update public.fontes_google_sheets set proxima_sincronizacao_em = now() + interval '10 minutes' where fonte_id = v_fonte;
  select * into v_r from public.sheets_canal_notificar(v_k1, v_fonte, 'recursoA1', 'update');
  perform public._ok(v_r.acao = 'sincronizar', 'M3 "update" válido: sincronizar');
  perform public._ok((select notificacao_pendente_em is not null and proxima_sincronizacao_em <= now() from public.fontes_google_sheets where fonte_id = v_fonte), 'M3 ...leitura marcada para já, sem esperar o agendador');
  perform public._ok((select notificacoes from public.fontes_google_sheets_canais where id = v_k1) = 2, 'M3 só avisos válidos contam no canal (sync + update)');

  -- M4
  perform public._ok((select count(*) from public.sheets_reservar(5, 300, v_fonte)) = 1, 'M4 a fila reserva a fonte avisada');
  perform public._ok((select notificacao_pendente_em is null and bloqueado_ate > now() from public.fontes_google_sheets where fonte_id = v_fonte), 'M4 reservar limpa o aviso e trava a fonte (lease)');
  perform public._ok((select count(*) from public.sheets_reservar(5, 300, v_fonte)) = 0, 'M4 ...uma segunda leitura concorrente não pega a mesma fonte');
  perform public.sheets_canal_notificar(v_k1, v_fonte, 'recursoA1', 'update'); -- aviso durante a leitura
  perform public._ok(public.sheets_tem_pendencia(v_fonte), 'M4 aviso durante a leitura fica pendente');
  perform public.sheets_concluir(v_fonte, true, null, 10, false);
  perform public._ok((select proxima_sincronizacao_em <= now() from public.fontes_google_sheets where fonte_id = v_fonte), 'M4 concluir com aviso pendente: próxima leitura imediata');

  -- M5
  perform public.sheets_reservar(5, 300, v_fonte);
  perform public.sheets_concluir(v_fonte, true, null, 10, false);
  select proxima_sincronizacao_em into v_prox from public.fontes_google_sheets where fonte_id = v_fonte;
  perform public._ok(v_prox between now() + interval '9 minutes 29 seconds' and now() + interval '9 minutes 31 seconds', 'M5 sem aviso: próxima periódica = intervalo − 30 s (não pula rodada do agendador)');

  -- M6
  update public.fontes_leads set status = 'pausada' where id = v_fonte;
  update public.fontes_google_sheets set situacao = 'pausada' where fonte_id = v_fonte;
  select * into v_r from public.sheets_canal_notificar(v_k1, v_fonte, 'recursoA1', 'update');
  perform public._ok(v_r.acao = 'encerrar' and v_r.conta_id = v_conta and v_r.resource_id = 'recursoA1', 'M6 pausada: aviso vira "encerrar" (com conta e recurso para parar o canal)');
  perform public._ok((select notificacao_pendente_em from public.fontes_google_sheets where fonte_id = v_fonte) is null, 'M6 ...e nada é marcado para leitura');
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'encerrar' and t.canal_id = v_k1) = 1, 'M6 agendador também lista o canal para encerrar');
  perform public.sheets_canal_encerrado(v_k1, 'teste');
  update public.fontes_leads set status = 'ativa' where id = v_fonte;
  update public.fontes_google_sheets set situacao = 'ativa' where fonte_id = v_fonte;
  delete from public.plataforma_integracoes_empresas where tenant_id = t_a;
  perform public._ok(not public.sheets_fonte_monitoravel(v_fonte), 'M6 liberação removida: não monitorável');
  perform public._ok((select count(*) from public.sheets_reservar(5, 300, v_fonte)) = 0, 'M6 ...e a fila também não lê');
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('google_sheets', t_a);
  update public.integracoes_contas_google set revogada_em = now() where id = v_conta;
  perform public._ok(not public.sheets_fonte_monitoravel(v_fonte), 'M6 conta Google revogada: não monitorável');
  update public.integracoes_contas_google set revogada_em = null where id = v_conta;
  -- empresa sem liberação nunca vira monitorável, mesmo com fonte "ativa"
  perform public._ok(not public.integracao_habilitada('google_sheets', t_b), 'M6 beta continua sem Google');

  -- M7
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'criar' and t.fonte_id = v_fonte) = 1, 'M7 sem canal vivo: "criar"');
  v_k2 := public.sheets_canal_reservar(v_fonte);
  perform public.sheets_canal_ativar(v_k2, 'recursoA1', now() + interval '1 hour');
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'criar' and t.fonte_id = v_fonte) = 1, 'M7 canal vence em 1 h (< 2 h de margem): "criar" para renovar');
  v_k1 := public.sheets_canal_reservar(v_fonte);
  perform public.sheets_canal_ativar(v_k1, 'recursoA1', now() + interval '1 day');
  perform public._ok((select situacao from public.fontes_google_sheets_canais where id = v_k2) = 'substituido', 'M7 renovado: o anterior fica "substituído"');
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'encerrar' and t.canal_id = v_k2) = 1, 'M7 ...e entra em "encerrar"');
  update public.fontes_google_sheets_canais set expira_em = now() - interval '1 minute' where id = v_k2;
  perform public.sheets_canais_tarefas(20, 120);
  perform public._ok((select situacao from public.fontes_google_sheets_canais where id = v_k2) = 'encerrado', 'M7 vencido: registrado como encerrado (o Google já parou)');
  insert into public.fontes_google_sheets_canais (tenant_id, fonte_id, conta_id, criado_em) values (t_a, v_fonte, v_conta, now() - interval '10 minutes') returning id into v_k2;
  perform public.sheets_canais_tarefas(20, 120);
  perform public._ok((select situacao from public.fontes_google_sheets_canais where id = v_k2) = 'falhou', 'M7 criação interrompida há mais de 5 min é liberada');

  -- M8
  perform public.sheets_canal_encerrado(v_k1, 'teste');
  v_k1 := public.sheets_canal_reservar(v_fonte);
  perform public.sheets_canal_falhou(v_k1, 'O Google recusou o endereço.', true);
  perform public._ok((select monitoramento || '|' || monitoramento_erro from public.fontes_google_sheets where fonte_id = v_fonte) = 'indisponivel|O Google recusou o endereço.', 'M8 recusa definitiva: "indisponível" com o motivo');
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'criar' and t.fonte_id = v_fonte) = 0, 'M8 ...não tenta de novo antes de 6 h');
  update public.fontes_google_sheets set monitoramento = 'erro', monitoramento_erro_em = now() - interval '20 minutes' where fonte_id = v_fonte;
  perform public._ok((select count(*) from public.sheets_canais_tarefas(20, 120) t where t.acao = 'criar' and t.fonte_id = v_fonte) = 1, 'M8 erro passageiro: tenta de novo depois de 15 min');
  perform public._ok((select situacao from public.fontes_google_sheets where fonte_id = v_fonte) = 'ativa', 'M8 a planilha segue ativa na leitura periódica');

  -- M9
  perform set_config('request.jwt.claims', json_build_object('sub', g_a, 'role', 'authenticated', 'session_id', 's1')::text, true);
  perform set_config('request.headers', json_build_object('x-rx7-tenant', 'teste-alfa')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public._ok(public._recusa(format('select public.sheets_canal_notificar(%L, %L, %L, %L)', v_k1, v_fonte, 'recursoA1', 'update')) = '42501', 'M9 usuário logado não chama a função de aviso');
  perform public._ok(public._recusa('select public.sheets_canais_tarefas(20, 120)') = '42501', 'M9 ...nem as tarefas dos canais');
  perform public._ok(public._recusa(format('select public.sheets_canal_reservar(%L)', v_fonte)) = '42501', 'M9 ...nem reserva canal');
  perform public._ok(public._recusa('select count(*) from public.fontes_google_sheets_canais') = '42501', 'M9 ...nem lê a tabela de canais');
  perform public._ok((select count(*) from public.sheets_monitoramento_da_empresa() m where m.fonte_id = v_fonte) = 1, 'M9 Administrador vê o estado no painel');
  perform set_config('role', 'postgres', true);
  if sdr is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', sdr, 'role', 'authenticated', 'session_id', 's1')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public._ok(public._recusa('select count(*) from public.sheets_monitoramento_da_empresa()') <> 'aceito', 'M9 SDR não lê o painel de integrações');
    perform set_config('role', 'postgres', true);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', (select m.user_id from public.tenant_memberships m where m.tenant_id = t_b and m.papel in ('gerente', 'admin_empresa') and m.ativo limit 1), 'role', 'authenticated', 'session_id', 's1')::text, true);
  perform set_config('request.headers', json_build_object('x-rx7-tenant', 'teste-beta')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public._ok((select count(*) from public.sheets_monitoramento_da_empresa() m where m.fonte_id = v_fonte) = 0, 'M9 outra empresa não vê o monitoramento da alfa');
  perform set_config('role', 'postgres', true);

  raise notice 'sheets_monitoramento_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
