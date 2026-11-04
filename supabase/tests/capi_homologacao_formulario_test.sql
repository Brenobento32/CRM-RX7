set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Teste: correção da homologação da CAPI (migration 20261111090000).
-- ONDE RODAR: só cópia LOCAL crm_rx7_*. Termina em ROLLBACK. Nada vai à Meta
-- (só o banco; o envio é da Edge Function, que aqui não roda).
-- Dados fictícios: IDs inventados, e-mails @exemplo.test e o test@fb.com da Meta.
--
--  R0–R3  caminho real: linha da planilha nativa da Meta (form_id "f:…", id
--         "l:…", dados fictícios, test@fb.com) → entrada de leads → homologação
--         aceita; reserva guarda o formulário só com os dígitos
--  F1–F4  formulário: só os dígitos do autorizado também vale; qualquer outro
--         valor, outro form_id no mesmo lead ou o autorizado com prefixo: recusado
--  P1–P9  prova: dados fictícios com ou sem "<…>" em dois campos; só o nome, só
--         test@fb.com, texto dentro de outra resposta, o mesmo valor duas vezes,
--         "<" sem ">", anúncio/conjunto/campanha, outro ID de lead: recusado
--  D1–D3  test@fb.com repetido: a entrada liga o 2º lead de teste ao 1º (como faz
--         com qualquer lead, sem mudança); a homologação recusa lead ligado a
--         cliente ou negociação já existente; nada é apagado nem alterado
--  S1     privilégios: só service_role; funções novas fechadas
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

-- created_time como a planilha nativa da Meta grava (São Paulo, -03:00).
create function public._agora_meta()
returns text language sql as $$
  select to_char((now() - interval '30 minutes') at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00'
$$;
grant execute on function public._agora_meta() to service_role;

-- Linha da aba INST. DE ENSINO como a leitura da planilha entrega ao banco (montarLeads): lead do
-- "Criar lead" da ferramenta de teste da Meta. Nome, telefone e empresa vão para o cadastro (colunas
-- mapeadas); as colunas técnicas e as outras perguntas vão para as respostas.
create function public._linha_meta(p_lead text, p_email text, p_linha integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'chave', 'id:l:' || p_lead, 'linha', p_linha,
    'nome', '<test lead: dummy data for full_name>',
    'telefone', '<test lead: dummy data for phone_number>',
    'email', p_email,
    'empresa', '<test lead: dummy data for qual_é_o_nome_da_sua_empresa?>',
    'meta_lead_id', 'l:' || p_lead,
    'data_envio', to_char((now() - interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'respostas', jsonb_build_array(
      jsonb_build_object('pergunta', 'id', 'resposta', 'l:' || p_lead),
      jsonb_build_object('pergunta', 'created_time', 'resposta', public._agora_meta()),
      jsonb_build_object('pergunta', 'form_id', 'resposta', 'f:1459591029473591'),
      jsonb_build_object('pergunta', 'form_name', 'resposta', 'RX7 - Inst. Ensino'),
      jsonb_build_object('pergunta', 'is_organic', 'resposta', 'false'),
      jsonb_build_object('pergunta', 'platform', 'resposta', 'fb'),
      jsonb_build_object('pergunta', 'Qual o maior desafio hoje?', 'resposta', '<test lead: dummy data for qual_o_maior_desafio_hoje?>'),
      jsonb_build_object('pergunta', 'Quantos alunos você tem atualmente?', 'resposta', '<test lead: dummy data for quantos_alunos_você_tem_atualmente?>')))
$$;
grant execute on function public._linha_meta(text, text, integer) to service_role;

-- Lead montado direto (cliente novo + negociação na etapa inicial + respostas de UM envio da planilha).
create function public._lead_meta(p_tenant uuid, p_dono uuid, p_etapa uuid, p_lead text, p_form text,
                                  p_nome text, p_empresa text, p_email text, p_respostas jsonb)
returns uuid language plpgsql as $$
declare v_cli uuid; v_neg uuid;
begin
  insert into public.clientes (tenant_id, tipo_cliente, nome, empresa, email, owner_id)
  values (p_tenant, 'pessoa_fisica', p_nome, p_empresa, p_email, p_dono) returning id into v_cli;
  insert into public.negociacoes (tenant_id, cliente_id, etapa_id, origem, external_id, atribuicao)
  values (p_tenant, v_cli, p_etapa, 'formulario', 'homolog-f-' || p_lead,
          jsonb_build_object('source', 'google_sheets', 'meta_lead_id', p_lead))
  returning id into v_neg;
  perform public.registrar_respostas_lead(p_tenant, v_neg, null, 'gs:id:l:' || p_lead,
    jsonb_build_array(jsonb_build_object('pergunta', 'id', 'resposta', 'l:' || p_lead),
                      jsonb_build_object('pergunta', 'created_time', 'resposta', public._agora_meta()),
                      jsonb_build_object('pergunta', 'form_id', 'resposta', p_form))
    || coalesce(p_respostas, '[]'::jsonb));
  return v_neg;
end;
$$;

do $$
declare
  g_a    uuid := '60000000-0000-4000-8000-0000000000a1';
  sup    uuid := '60000000-0000-4000-8000-0000000000ff';
  t_a    uuid := 'a9bc5b35-0515-49d7-b5d6-4db635003d35';
  ds_a   text := '800000000000001';
  form   text := '1459591029473591';
  lead1  text := '9100000000000001';
  lead2  text := '9100000000000002';
  lead3  text := '9100000000000003';
  lead4  text := '9100000000000004';
  -- Duas outras perguntas do formulário com os dados fictícios da Meta.
  dummy  jsonb := '[{"pergunta":"Qual o maior desafio hoje?","resposta":"<test lead: dummy data for qual_o_maior_desafio_hoje?>"},
                    {"pergunta":"Quantos alunos você tem atualmente?","resposta":"<test lead: dummy data for quantos_alunos_você_tem_atualmente?>"}]';
  real_r jsonb := '[{"pergunta":"Qual o maior desafio hoje?","resposta":"Captar alunos no segundo semestre"},
                    {"pergunta":"Quantos alunos você tem atualmente?","resposta":"120"}]';
  fa uuid; ea uuid; p_business uuid; conta uuid; fonte uuid; v_con uuid;
  v_j jsonb; v_r text; v_p record; v_linha jsonb;
  v_n1 uuid; v_c1 uuid; v_n3 uuid; v_n4 uuid; v_c4 uuid; v_ok uuid; v_neg uuid;
  v_val text; i integer := 0;
  v_fila integer; v_clientes integer; v_negs integer;
  q text := 'select * from public.capi_homologacao_preparar(%L, %L, %L, %L, %L, %L, %s)';
begin
  -- Mesmo ponto de partida da produção: CAPI global desligada; só a empresa A em homologação, conexão configurando.
  perform public._como(null, null);
  update public.plataforma_integracoes set meta_conversoes = false;
  delete from public.meta_conversoes_conexoes;
  delete from public.plataforma_integracoes_empresas where tipo = 'meta_conversoes';
  delete from public.super_admin_acessos;
  select id into fa from public.funis where tenant_id = t_a and padrao;
  select id into ea from public.etapas_funil where funil_id = fa and etapa_inicial;
  select id into p_business from public.planos where codigo = 'business';
  update public.planos set recursos = array_append(recursos, 'meta_conversoes') where id = p_business and not ('meta_conversoes' = any (recursos));
  insert into public.assinaturas (tenant_id, plano_id, status) values (t_a, p_business, 'ativa')
  on conflict (tenant_id) do update set plano_id = excluded.plano_id, status = 'ativa';
  insert into public.plataforma_integracoes_empresas (tipo, tenant_id) values ('meta_conversoes', t_a), ('google_sheets', t_a)
  on conflict do nothing;
  insert into public.super_admin_acessos (user_id, tenant_id, motivo, sessao_id, iniciado_em, expira_em)
  values (sup, t_a, 'teste local', 's1', now(), now() + interval '1 hour');

  perform public._servico();
  v_con := public.capi_salvar_conexao(t_a, g_a, '700000000000001', ds_a, 'Dataset A', 'token-sistema-alfa-xxxxxxxxxx');
  conta := public.google_salvar_conta(t_a, g_a, 'planilhas-h@alfa.test', 'refresh-token-h-xxxxxxxxx',
                                      array['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);
  perform public._como(g_a, 'teste-alfa');
  -- Mesmo mapeamento da aba INST. DE ENSINO (coluna id como chave).
  fonte := public.sheets_criar_fonte(conta, 'planilha-h-aaaaaaaaaaaaaaaaaaaaaa', 'Automação (teste)', 21, 'INST. DE ENSINO', 1,
             '{"nome":"Nome","telefone":"Telefone","email":"Email","empresa":"Qual é o nome da sua Empresa?","meta_lead_id":"id"}',
             'id', true, 'Ensino', fa, ea, g_a);

  -- ================================================================= R caminho real da planilha
  perform public._como(null, null);
  perform public._ok(not exists (select 1 from public.clientes where tenant_id = t_a and lower(email) = 'test@fb.com'),
                     'R0 pré-condição: nenhum cliente com test@fb.com na empresa');
  select count(*) into v_fila from public.meta_conversoes_eventos;
  v_linha := public._linha_meta(lead1, 'test@fb.com', 2);
  perform public._servico();
  v_j := public.sheets_processar_linhas(fonte, jsonb_build_array(v_linha), false);
  perform public._como(null, null);
  select n.id, n.cliente_id into v_n1, v_c1 from public.negociacoes n where n.tenant_id = t_a and n.atribuicao ->> 'meta_lead_id' = lead1;
  perform public._ok((v_j ->> 'importadas')::integer = 1 and v_n1 is not null, 'R1 lead de teste da Meta entra pela planilha: negociação nova');
  perform public._ok((select telefone is null and lower(email) = 'test@fb.com' from public.clientes where id = v_c1)
                     and exists (select 1 from public.negociacao_respostas where negociacao_id = v_n1 and pergunta = 'form_id' and resposta = 'f:' || form),
                     'R1 ...telefone fictício descartado, e-mail test@fb.com, form_id gravado como "f:" + dígitos');

  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_n1, lead1, ds_a, form, 'false'));
  perform public._ok(v_r = 'aceito', 'R2 form_id "f:1459591029473591" do formulário autorizado: aceito (' || v_r || ')');

  select * into v_p from public.capi_homologacao_preparar(t_a, sup, v_n1, lead1, ds_a, form, true);
  perform public._como(null, null);
  perform public._ok(v_p.homologacao is not null and v_p.lead = lead1 and v_p.nome_evento = 'Lead recebido'
                     and (select formulario_id = form and lead_id = lead1 from public.meta_conversoes_homologacoes where id = v_p.homologacao),
                     'R3 reserva: formulário guardado só com os dígitos, lead e evento certos');
  perform public._ok((select count(*) from public.meta_conversoes_eventos) = v_fila
                     and (select situacao = 'configurando' and enviados = 0 from public.meta_conversoes_conexoes where id = v_con),
                     'R3 ...fila geral e conexão intactas');
  perform public._servico();
  perform public.capi_homologacao_concluir(v_p.homologacao, 'temporario', 'teste local: nada foi enviado', null);

  -- ================================================================= F formulário
  perform public._como(null, null);
  v_ok := public._lead_meta(t_a, g_a, ea, '9200000000000001', form, '<test lead: dummy data for full_name>', null, 'h1@exemplo.test', dummy);
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_ok, '9200000000000001', ds_a, form, 'false'));
  perform public._ok(v_r = 'aceito', 'F1 form_id só com os dígitos do autorizado: aceito (' || v_r || ')');

  foreach v_val in array array['f:1459591029473592', 'F:1459591029473591', 'f: 1459591029473591', 'f:f:1459591029473591',
                               'l:1459591029473591', 'ag:1459591029473591', 'f:1459591029473591x', '1459591029473591f',
                               '01459591029473591', 'f:145959102947359', 'f:', 'form 1459591029473591'] loop
    i := i + 1;
    perform public._como(null, null);
    v_neg := public._lead_meta(t_a, g_a, ea, (9200000000000100 + i)::text, v_val, '<test lead: dummy data for full_name>', null,
                               'f' || i || '@exemplo.test', dummy);
    perform public._servico();
    v_r := public._recusa(format(q, t_a, sup, v_neg, (9200000000000100 + i)::text, ds_a, form, 'false'));
    perform public._ok(v_r like '23514:%formulário autorizado%', 'F2 form_id "' || v_val || '": recusado');
  end loop;

  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000201', 'f:' || form, '<test lead: dummy data for full_name>', null, 'f3@exemplo.test',
                             dummy || '[{"pergunta":"form_id","resposta":"f:999999999999999"}]'::jsonb);
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000201', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%formulário autorizado%', 'F3 lead com um segundo form_id de outro formulário: recusado');

  v_r := public._recusa(format(q, t_a, sup, v_ok, '9200000000000001', ds_a, 'f:' || form, 'false'));
  perform public._ok(v_r like '23514:%formulário autorizado%', 'F4 formulário autorizado com prefixo (o secret leva só os dígitos): recusado');

  -- ================================================================= P prova de lead da ferramenta de teste
  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000301', 'f:' || form, 'test lead: dummy data for full_name', null, 'p1@exemplo.test',
                             '[{"pergunta":"Qual o maior desafio hoje?","resposta":"test lead: dummy data for qual_o_maior_desafio_hoje?"}]');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000301', ds_a, form, 'false'));
  perform public._ok(v_r = 'aceito', 'P1 dados fictícios sem "<…>" em dois campos: aceito (' || v_r || ')');

  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000302', 'f:' || form, '<test lead: dummy data for full_name>',
                             '<test lead: dummy data for qual_é_o_nome_da_sua_empresa?>', 'p2@exemplo.test', real_r);
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000302', ds_a, form, 'false'));
  perform public._ok(v_r = 'aceito', 'P2 nome e empresa fictícios (outras respostas de múltipla escolha): aceito (' || v_r || ')');

  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000303', 'f:' || form, 'Maria <test lead: dummy data for full_name>', null, 'p3@exemplo.test',
                             '[{"pergunta":"Qual o maior desafio hoje?","resposta":"Resposta: test lead: dummy data for qual_o_maior_desafio_hoje?"},
                               {"pergunta":"Quantos alunos você tem atualmente?","resposta":"<test lead: dummy data for quantos_alunos_você_tem_atualmente?> e mais"}]');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000303', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%ferramenta de teste da Meta%', 'P3 texto fictício só dentro de outras respostas (não é o valor inteiro): recusado');

  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000304', 'f:' || form, '<test lead: dummy data for full_name>', null, 'p4@exemplo.test',
                             '[{"pergunta":"Nome completo","resposta":"<TEST LEAD: dummy data for full_name>"}]');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000304', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%ferramenta de teste da Meta%', 'P4 o mesmo valor fictício em dois campos conta uma vez só: recusado');

  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000305', 'f:' || form, '<test lead: dummy data for full_name', null, 'p5@exemplo.test',
                             '[{"pergunta":"Qual o maior desafio hoje?","resposta":"test lead: dummy data for qual_o_maior_desafio_hoje?>"}]');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000305', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%ferramenta de teste da Meta%', 'P5 "<" sem ">" (ou o contrário): recusado');

  foreach v_val in array array['ad_id=ag:120254490122650204', 'adset_id=as:120254490122650205', 'campaign_id=c:120254490122650206'] loop
    i := i + 1;
    perform public._como(null, null);
    v_neg := public._lead_meta(t_a, g_a, ea, (9200000000000400 + i)::text, 'f:' || form, '<test lead: dummy data for full_name>', null,
                               'p6-' || i || '@exemplo.test',
                               dummy || jsonb_build_array(jsonb_build_object('pergunta', split_part(v_val, '=', 1), 'resposta', split_part(v_val, '=', 2))));
    perform public._servico();
    v_r := public._recusa(format(q, t_a, sup, v_neg, (9200000000000400 + i)::text, ds_a, form, 'false'));
    perform public._ok(v_r like '23514:%anúncio%', 'P6 lead com ' || split_part(v_val, '=', 1) || ' (veio de anúncio): recusado');
  end loop;

  v_r := public._recusa(format(q, t_a, sup, v_ok, '9200000000000999', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%lead de homologação autorizado%', 'P7 ID de lead diferente do autorizado (mesmo com a prova): recusado');

  -- ================================================================= D test@fb.com repetido (entrada real)
  perform public._como(null, null);
  select count(*) into v_negs from public.negociacoes where tenant_id = t_a;
  select count(*) into v_clientes from public.clientes where tenant_id = t_a;
  v_linha := public._linha_meta(lead2, 'test@fb.com', 3);
  perform public._servico();
  v_j := public.sheets_processar_linhas(fonte, jsonb_build_array(v_linha), false);
  perform public._como(null, null);
  perform public._ok((v_j ->> 'existentes')::integer = 1
                     and (select count(*) from public.negociacoes where tenant_id = t_a) = v_negs
                     and (select count(*) from public.clientes where tenant_id = t_a) = v_clientes
                     and (select atribuicao -> 'origens_adicionais' @> jsonb_build_array(jsonb_build_object('meta_lead_id', lead2))
                            from public.negociacoes where id = v_n1),
                     'D1 2º lead de teste com o mesmo test@fb.com: a entrada o liga ao 1º (origem adicional), sem negociação nova');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_n1, lead2, ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'D1 ...homologação do 2º lead (só origem adicional): recusada');
  v_r := public._recusa(format(q, t_a, sup, v_n1, lead1, ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%', 'D1 ...e do 1º, agora com outro lead anexado: recusada');
  perform public._como(null, null);
  perform public._ok((select arquivada_em is null and excluida_em is null and etapa_id = ea from public.negociacoes where id = v_n1)
                     and (select nome = '<test lead: dummy data for full_name>' from public.clientes where id = v_c1),
                     'D1 ...nada apagado: negociação e cliente do 1º lead intactos');

  -- Sem negociação aberta do cliente no funil: a entrada cria oportunidade nova no MESMO cliente (pelo e-mail).
  update public.negociacoes set arquivada_em = now(), motivo_arquivamento = 'teste local' where id = v_n1;
  v_linha := public._linha_meta(lead3, 'test@fb.com', 4);
  perform public._servico();
  v_j := public.sheets_processar_linhas(fonte, jsonb_build_array(v_linha), false);
  perform public._como(null, null);
  select id into v_n3 from public.negociacoes where tenant_id = t_a and atribuicao ->> 'meta_lead_id' = lead3;
  perform public._ok(v_n3 is not null and (select cliente_id = v_c1 from public.negociacoes where id = v_n3),
                     'D2 3º lead de teste sem negociação aberta: negociação nova, mas no cliente do 1º (mesmo test@fb.com)');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_n3, lead3, ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%já existia%', 'D2 ...homologação recusada: cliente de outra negociação (' || v_r || ')');

  -- Cliente antigo, sem negociação nenhuma, com o mesmo e-mail do lead.
  perform public._como(null, null);
  insert into public.clientes (tenant_id, tipo_cliente, nome, email, owner_id)
  values (t_a, 'pessoa_fisica', 'Cliente antigo (fictício)', 'cliente-antigo@exemplo.test', g_a) returning id into v_c4;
  update public.clientes set created_at = now() - interval '2 days' where id = v_c4;
  v_linha := public._linha_meta(lead4, 'cliente-antigo@exemplo.test', 5);
  perform public._servico();
  v_j := public.sheets_processar_linhas(fonte, jsonb_build_array(v_linha), false);
  perform public._como(null, null);
  select id into v_n4 from public.negociacoes where tenant_id = t_a and atribuicao ->> 'meta_lead_id' = lead4;
  perform public._ok(v_n4 is not null and (select cliente_id = v_c4 from public.negociacoes where id = v_n4),
                     'D3 lead de teste com o e-mail de um cliente antigo: ligado ao cliente antigo');
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_n4, lead4, ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%já existia%', 'D3 ...homologação recusada: cliente criado antes do lead (' || v_r || ')');
  perform public._como(null, null);
  perform public._ok((select nome = 'Cliente antigo (fictício)' and email = 'cliente-antigo@exemplo.test' and deleted_at is null
                        from public.clientes where id = v_c4), 'D3 ...cliente antigo intacto');

  -- Só test@fb.com ou só o nome fictício nunca provam nada (depois de D: o e-mail já existe na empresa).
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000501', 'f:' || form, '<test lead: dummy data for full_name>', null, 'test@fb.com', real_r);
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000501', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%ferramenta de teste da Meta%', 'P8 só o nome fictício + test@fb.com: recusado');
  perform public._como(null, null);
  v_neg := public._lead_meta(t_a, g_a, ea, '9200000000000502', 'f:' || form, 'Maria Exemplo', 'Escola Exemplo', 'test@fb.com', real_r);
  perform public._servico();
  v_r := public._recusa(format(q, t_a, sup, v_neg, '9200000000000502', ds_a, form, 'false'));
  perform public._ok(v_r like '23514:%ferramenta de teste da Meta%', 'P9 só o e-mail test@fb.com (dados de lead real): recusado');

  -- ================================================================= S privilégios
  perform public._como(null, null);
  perform public._ok(has_function_privilege('service_role', 'public.capi_homologacao_preparar(uuid,uuid,uuid,text,text,text,boolean)', 'execute')
                     and not has_function_privilege('authenticated', 'public.capi_homologacao_preparar(uuid,uuid,uuid,text,text,text,boolean)', 'execute')
                     and not has_function_privilege('anon', 'public.capi_homologacao_preparar(uuid,uuid,uuid,text,text,text,boolean)', 'execute')
                     and (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
                           where p.oid = 'public.capi_homologacao_preparar(uuid,uuid,uuid,text,text,text,boolean)'::regprocedure),
                     'S1 preparar: só service_role, security definer, search_path vazio');
  perform public._ok(not has_function_privilege('authenticated', 'public.capi_homologacao_formulario(text)', 'execute')
                     and not has_function_privilege('anon', 'public.capi_homologacao_formulario(text)', 'execute')
                     and not has_function_privilege('authenticated', 'public.capi_homologacao_ficticio(text)', 'execute')
                     and not has_function_privilege('anon', 'public.capi_homologacao_ficticio(text)', 'execute'),
                     'S1 funções novas: fechadas para anon e authenticated');
  perform public._ok(has_function_privilege('service_role', 'public.capi_homologacao_concluir(uuid,text,text,text)', 'execute')
                     and not has_function_privilege('authenticated', 'public.capi_homologacao_concluir(uuid,text,text,text)', 'execute')
                     and not has_function_privilege('authenticated', 'public.capi_homologacao_momento(text)', 'execute'),
                     'S1 conclusão e horário: privilégios iguais aos de antes');
end;
$$;

rollback;
