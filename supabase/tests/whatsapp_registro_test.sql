set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: registro obrigatório do número do WhatsApp oficial (migration
-- 20261103090000). ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK.
--
--  R1–R4  número novo nasce 'pendente_registro': não cria lead, não envia, não retoma
--  R5–R8  resultado do registro: falha conta tentativa (limite 5/h); sucesso conecta
--  R9–R11 coexistência conecta direto; reconexão mantém registro; outra empresa barrada
--  R12–R15 isolamento A×B, permissões (só Administrador, só serviço grava resultado)
--  R16    o PIN não existe em nenhuma coluna
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
  fa1 uuid; ea1 uuid; fb1 uuid; eb1 uuid;
  n_a uuid; n_co uuid; n_b uuid; fw uuid;
  v_j jsonb; v_r text; v_conv uuid; v_s text; v_i integer;
begin
  perform public._como(null, null);
  select id into fa1 from public.funis where tenant_id = t_a and padrao;
  select id into ea1 from public.etapas_funil where funil_id = fa1 and etapa_inicial;
  select id into fb1 from public.funis where tenant_id = t_b and padrao;
  select id into eb1 from public.etapas_funil where funil_id = fb1 and etapa_inicial;
  update public.plataforma_integracoes set whatsapp_oficial = true;

  -- ================================================================= R1–R4 pendente não opera
  perform public._servico();
  n_a := public.whatsapp_salvar_numero(t_a, g_a, '530000000000001', '630000000000001', '+55 11 4300-0001', 'Alfa', 'token-meta-alfa-xxxx', 'WA A', fa1, ea1, c_a);
  perform public._como(null, null);
  perform public._ok((select situacao = 'pendente_registro' and registrado_em is null and modo_conexao = 'cloud_api' from public.whatsapp_numeros where id = n_a),
                     'R1 número novo (Cloud API) nasce PENDENTE de registro, sem data de registro');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'integracao_whatsapp_conectada' and tenant_id = t_a
                                and detalhes ->> 'situacao' = 'pendente_registro' and detalhes ->> 'modo' = 'cloud_api'),
                     'R1 ...auditoria registra modo e situação');

  perform public._servico();
  v_j := public.whatsapp_registrar_entrada('530000000000001', 'wamid.R2', '5511944440001', 'Rita Pendente', 'text', 'Oi', now());
  v_conv := (v_j ->> 'conversa')::uuid;
  perform public._ok(coalesce(v_j ->> 'lead', 'nenhum') = 'nenhum', 'R2 mensagem para número pendente NÃO cria lead');
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.negociacoes ng join public.clientes c on c.id = ng.cliente_id where c.tenant_id = t_a and c.telefone like '%944440001'),
                     'R2 ...nem negociação no funil');

  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select * from public.whatsapp_preparar_envio(%L, %L)', v_conv, 'Olá'));
  perform public._ok(v_r like 'RX020:%', 'R3 número pendente NÃO envia (barrado no banco, antes da Meta)');
  v_r := public._recusa(format('select public.whatsapp_acao(%L, %L)', n_a, 'retomar'));
  perform public._ok(v_r like '23514:%registro%', 'R4 "Retomar" não pula o registro pendente');
  perform public._servico();
  perform public._ok(not exists (select 1 from public.whatsapp_numeros_para_reconciliar(50) where numero_id = n_a),
                     'R4 número pendente fica fora da conferência da franquia com a Meta');
  perform public._como(g_a, 'teste-alfa');

  -- ================================================================= R5–R8 resultado do registro
  perform public._ok(public.whatsapp_preparar_registro(n_a) = '530000000000001', 'R5 Administrador prepara o registro: recebe só o phone_number_id');
  perform public._servico();
  perform public._ok(public.whatsapp_token_registro(n_a) = 'token-meta-alfa-xxxx', 'R5 servidor obtém a credencial só para registrar o número pendente');
  perform public._ok(not exists (select 1 from public.whatsapp_obter_token(n_a)), 'R5 ...a credencial de uso geral (envio) continua negada enquanto pendente');
  for v_i in 1..4 loop
    perform public.whatsapp_registro_reservar(n_a);
    v_s := public.whatsapp_registro_resultado(n_a, false, 'PIN incorreto. Se este número já tem verificação...', '133005');
  end loop;
  perform public._como(null, null);
  perform public._ok(v_s = 'pendente_registro' and (select registro_tentativas = 4 and cardinality(registro_pedidos) = 4 and registro_erro like 'PIN incorreto%'
                                                      from public.whatsapp_numeros where id = n_a),
                     'R6 falha: continua pendente, conta o pedido enviado à Meta e guarda o motivo');
  perform public._ok((select ultimo_erro like 'PIN incorreto%' from public.fontes_leads where id = (select fonte_id from public.whatsapp_numeros where id = n_a)),
                     'R6 ...motivo visível no painel (fonte)');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_a));
  perform public._ok(v_r = 'aceito', 'R7 4 pedidos na hora: ainda pode tentar');
  perform public._servico();
  perform public.whatsapp_registro_reservar(n_a);
  perform public.whatsapp_registro_resultado(n_a, false, 'PIN incorreto.', '133005');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_a));
  perform public._ok(v_r like 'RX010:%1 hora%', 'R7 5 pedidos na hora: novas tentativas bloqueadas (sem chamar a Meta)');
  perform public._servico();
  v_r := public._recusa(format('select public.whatsapp_registro_reservar(%L)', n_a));
  perform public._ok(v_r like 'RX010:%' and (select cardinality(registro_pedidos) = 5 from public.whatsapp_numeros where id = n_a),
                     'R7 ...o servidor também não reserva (nada sai para a Meta, nada é contado)');
  perform public._como(null, null);

  -- janela móvel de 72 h da Meta (10 pedidos; o AVANTE para em 8)
  update public.whatsapp_numeros set registro_pedidos = array[now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours',
                                                               now() - interval '3 hours', now() - interval '3 hours'] where id = n_a;
  perform public._como(g_a, 'teste-alfa');
  perform public._ok(public.whatsapp_preparar_registro(n_a) is not null, 'R7 ...passada 1 h, pode tentar de novo (5 pedidos em 72 h)');
  perform public._como(null, null);
  update public.whatsapp_numeros
     set registro_pedidos = array[now() - interval '71 hours', now() - interval '40 hours', now() - interval '30 hours', now() - interval '20 hours',
                                  now() - interval '10 hours', now() - interval '5 hours', now() - interval '3 hours', now() - interval '2 hours',
                                  now() - interval '80 hours']
   where id = n_a;
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_a));
  perform public._ok(v_r like 'RX010:%8 pedidos de registro em 72 horas%' and v_r like '%a partir de %',
                     'R7b 8 pedidos em 72 h: bloqueado ANTES do limite da Meta (10), com o horário de liberação');
  perform public._servico();
  v_r := public._recusa(format('select public.whatsapp_registro_reservar(%L)', n_a));
  perform public._ok(v_r like 'RX010:%8 pedidos%', 'R7b ...o servidor também não reserva');
  perform public._como(null, null);
  -- o mais antigo sai da janela: volta a ter 7 em 72 h (o de 80 h já não conta)
  update public.whatsapp_numeros set registro_pedidos = registro_pedidos[2:9] where id = n_a;
  perform public._servico();
  perform public._ok(public.whatsapp_registro_reservar(n_a) = '530000000000001', 'R7c pedido antigo saiu da janela móvel: nova tentativa permitida e contada');
  perform public._como(null, null);
  perform public._ok((select cardinality(registro_pedidos) = 8 from public.whatsapp_numeros where id = n_a), 'R7c ...pedidos de mais de 72 h descartados ao contar');

  -- 133016 da Meta: bloqueio de 72 h respeitado
  perform public._servico();
  perform public.whatsapp_registro_resultado(n_a, false, 'limite', '133016');
  perform public._como(null, null);
  perform public._ok((select registro_bloqueado_ate between now() + interval '71 hours' and now() + interval '73 hours'
                             and registro_erro like 'A Meta bloqueou novos pedidos de registro%' from public.whatsapp_numeros where id = n_a),
                     'R7d 133016: bloqueio de 72 h gravado, com o horário de liberação no painel');
  update public.whatsapp_numeros set registro_pedidos = '{}' where id = n_a;
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_a));
  perform public._ok(v_r like 'RX010: A Meta bloqueou%', 'R7d ...mesmo sem pedidos recentes, nenhuma tentativa até acabar o bloqueio');
  perform public._servico();
  v_r := public._recusa(format('select public.whatsapp_registro_reservar(%L)', n_a));
  perform public._ok(v_r like 'RX010: A Meta bloqueou%', 'R7d ...nem pelo servidor');
  perform public._como(null, null);
  update public.whatsapp_numeros set registro_bloqueado_ate = now() - interval '1 minute' where id = n_a;
  perform public._servico();
  perform public.whatsapp_registro_reservar(n_a);
  perform public._ok(public.whatsapp_registro_resultado(n_a, true, null) = 'conectado', 'R8 sucesso confirmado pela Meta: CONECTADO');
  perform public._como(null, null);
  perform public._ok((select situacao = 'conectado' and registrado_em is not null and registro_tentativas = 0 and registro_erro is null and ultimo_erro is null
                        from public.whatsapp_numeros where id = n_a), 'R8 ...com data de registro e contadores limpos');
  perform public._ok(exists (select 1 from public.admin_auditoria where acao = 'integracao_whatsapp_registrada' and tenant_id = t_a), 'R8 ...registro auditado');
  perform public._servico();
  perform public._ok(public.whatsapp_registro_resultado(n_a, false, 'tarde') = 'conectado', 'R8 resultado repetido/atrasado não desfaz o registro');
  perform public._ok(public.whatsapp_token_registro(n_a) is null, 'R8 ...conectado: a credencial de registro deixa de ser liberada');
  v_j := public.whatsapp_registrar_entrada('530000000000001', 'wamid.R8', '5511944440002', 'Rui Conectado', 'text', 'Oi', now());
  perform public._ok(v_j ->> 'lead' = 'importada', 'R8 ...agora a mensagem vira lead');
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_a));
  perform public._ok(v_r like '23514:%', 'R8 número já conectado não é "registrado" de novo');

  -- ================================================================= R9–R11 coexistência, reconexão, outra empresa
  perform public._servico();
  n_co := public.whatsapp_salvar_numero(t_a, g_a, '530000000000003', '630000000000001', '+55 11 4300-0003', 'Alfa', 'token-meta-coex-xxxx', 'WA App', fa1, ea1, c_a, 'coexistencia');
  perform public._como(null, null);
  perform public._ok((select situacao = 'conectado' and modo_conexao = 'coexistencia' and registrado_em is not null from public.whatsapp_numeros where id = n_co),
                     'R9 coexistência (app WhatsApp Business): conectado direto, sem registro');
  perform public._servico();
  perform public._ok(public.whatsapp_token_registro(n_co) is null, 'R9 ...e nunca recebe credencial de registro');
  perform public._como(null, null);
  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000009', '630000000000001', null, null, 'token-xxxxxxxxxxxx', 'X', %L, %L, %L, 'outro')$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like '22023:%', 'R9 modo de conexão desconhecido é recusado');

  perform public.whatsapp_salvar_numero(t_a, g_a, '530000000000001', '630000000000001', '+55 11 4300-0001', 'Alfa', 'token-meta-alfa-novo', 'WA A', fa1, ea1, c_a);
  perform public._como(null, null);
  perform public._ok((select situacao = 'conectado' and registrado_em is not null from public.whatsapp_numeros where id = n_a),
                     'R10 reconexão do número já registrado (mesma empresa): continua conectado, sem novo registro');

  perform public._servico();
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000001', '630000000000009', null, null, 'token-roubo-xxxxxxxx', 'Roubo', %L, %L, %L)$q$, t_b, g_b, fb1, eb1, g_b));
  perform public._ok(v_r like '23505:%', 'R11 número de outra empresa: recusado');
  perform public._como(null, null);
  perform public._ok((select tenant_id = t_a from public.whatsapp_numeros where phone_number_id = '530000000000001'), 'R11 ...e continua da empresa A');

  -- ================================================================= R12–R15 isolamento e permissões
  perform public._servico();
  n_b := public.whatsapp_salvar_numero(t_b, g_b, '530000000000002', '630000000000002', '+55 21 4300-0002', 'Beta', 'token-meta-beta-xxxx', 'WA B', fb1, eb1, g_b);
  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_b));
  perform public._ok(v_r like 'P0002:%', 'R12 Administrador de A não registra número de B');
  perform public._ok(not exists (select 1 from public.whatsapp_conexao_recente('530000000000002')), 'R12 ...nem enxerga a conexão recente de B');
  perform public._ok((select count(*) from public.whatsapp_conexao_recente('530000000000001')) = 1, 'R12 ...mas enxerga a própria');
  perform public._como(g_b, 'teste-beta');
  perform public._ok(public.whatsapp_preparar_registro(n_b) = '530000000000002', 'R13 B registra o próprio número pendente');

  perform public._como(sdr_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_preparar_registro(%L)', n_a));
  perform public._ok(v_r like '42501:%', 'R14 SDR não mexe no registro do número');
  v_r := public._recusa($q$select * from public.whatsapp_conexao_recente('530000000000001')$q$);
  perform public._ok(v_r like '42501:%', 'R14 ...nem consulta conexões');

  perform public._como(g_a, 'teste-alfa');
  v_r := public._recusa(format('select public.whatsapp_registro_resultado(%L, true, null)', n_b));
  perform public._ok(v_r like '42501:%', 'R15 Administrador NÃO marca registro como concluído (só o servidor, após a Meta)');
  v_r := public._recusa(format($q$select public.whatsapp_salvar_numero(%L, %L, '530000000000007', '630000000000001', null, null, 'tok-xxxxxxxxxxxxxx', 'X', %L, %L, %L)$q$, t_a, g_a, fa1, ea1, c_a));
  perform public._ok(v_r like '42501:%', 'R15 ...nem salva número com token direto');
  v_r := public._recusa(format('select public.whatsapp_token_registro(%L)', n_b));
  perform public._ok(v_r like '42501:%', 'R15 ...nem lê a credencial de registro (só o servidor)');
  v_r := public._recusa(format('select public.whatsapp_registro_reservar(%L)', n_b));
  perform public._ok(v_r like '42501:%', 'R15 ...nem mexe na contagem de pedidos de registro');
  v_r := public._recusa($q$select public.whatsapp_registro_bloqueio('{}', null)$q$);
  perform public._ok(v_r like '42501:%', 'R15 ...nem chama a regra interna do limite');
  perform public._como(null, null);
  perform public._ok((select situacao = 'pendente_registro' from public.whatsapp_numeros where id = n_b), 'R15 ...o número de B continua pendente');

  -- ================================================================= R16 PIN não é guardado
  perform public._ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name ilike '%pin%'
                                   and table_name in ('whatsapp_numeros', 'fontes_leads', 'admin_auditoria')),
                     'R16 nenhuma coluna de PIN nas tabelas do WhatsApp');
  perform public._ok(not exists (select 1 from public.admin_auditoria where detalhes::text ~ '"pin"'), 'R16 ...nem na auditoria');

  raise notice 'whatsapp_registro_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
