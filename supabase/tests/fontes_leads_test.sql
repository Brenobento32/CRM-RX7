-- ===========================================================================
-- Teste das fontes de leads por empresa (T14).
--
-- ONDE RODAR: só na cópia LOCAL com T1–T13 (+ esqueleto local) e T14.
-- Termina em ROLLBACK. Nenhum provedor é chamado: as Edge Functions são
-- simuladas chamando as mesmas RPCs com a service_role / anon.
--
-- PROVA:
--   1  só admin_empresa cria fonte; funil/etapa/responsável da própria empresa;
--   2  lead entra na empresa da fonte, no funil/etapa/responsável da fonte;
--      telefone normalizado; reenvio não duplica;
--   3  mesmo contato em A e B: clientes independentes; A não vê fontes/eventos de B;
--   4  fonte revogada/pausada e empresa suspensa não recebem (e fica registrado);
--   5  Meta/WhatsApp não recebem antes da validação com o provedor; página
--      já usada por outra empresa é recusada; token do provedor só no Vault;
--   6  formulário RX7 público: idempotente por envio, isca, sem acesso extra;
--   7  limite de integrações e recurso do plano; erros registrados;
--   8  legado intacto.
-- ===========================================================================

begin;

create function public._teste_como(p_uid uuid, p_slug text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_slug is null then '{}' else json_build_object('x-rx7-tenant', p_slug)::text end, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function public._teste_papel(p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  perform set_config('role', p_role, true);
end;
$$;
grant execute on function public._teste_como(uuid, text) to authenticated, service_role, anon;
grant execute on function public._teste_papel(text) to authenticated, service_role, anon;

create temp table _base as
select (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c) as h_cli;
grant select on _base to authenticated, service_role, anon;

do $$
declare
  u_super uuid := '70000000-0000-0000-0000-000000000001';
  u_a     uuid := '70000000-0000-0000-0000-00000000000a';
  u_a2    uuid := '70000000-0000-0000-0000-0000000000a2';
  u_ag    uuid := '70000000-0000-0000-0000-0000000000a9';
  u_b     uuid := '70000000-0000-0000-0000-00000000000b';
  t_a uuid; t_b uuid;
  t_arq uuid := public.tenant_arquivo_id();
  fa uuid; ea_ini uuid; ea_ag uuid; fb uuid; eb_ini uuid;
  f_wa uuid; f_wb uuid; f_meta uuid; f_form uuid; f_x uuid;
  tok_a text; tok_b text;
  v_r record; v_r2 record; v_n bigint; v_ok boolean;
  v_envio uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (u_super, 'super.fl@teste.invalid'), (u_a, 'a.fl@teste.invalid'), (u_a2, 'a2.fl@teste.invalid'),
    (u_ag, 'ag.fl@teste.invalid'), (u_b, 'b.fl@teste.invalid');
  insert into public.profiles (id, nome, email, role)
  select u.id, split_part(u.email, '@', 1), u.email, 'closer' from auth.users u where u.id in (u_super, u_a, u_a2, u_ag, u_b)
  on conflict (id) do nothing;
  update public.profiles set ativo = true where id in (u_super, u_a, u_a2, u_ag, u_b);
  insert into public.super_admins (user_id) values (u_super);
  -- plano com tudo liberado (limites têm teste próprio no fim)
  update public.planos set recursos = public.recursos_validos(), limite_usuarios = null, limite_integracoes = null
   where codigo = 'starter';

  perform public._teste_como(u_super, null);
  t_a := public.provisionar_empresa('Empresa A', 'empresa-a', u_a);
  t_b := public.provisionar_empresa('Empresa B', 'empresa-b', u_b);
  perform public._teste_como(u_a, 'empresa-a');
  perform public.definir_membro_tenant(t_a, u_a2, 'closer');
  perform public.definir_membro_tenant(t_a, u_ag, 'gerente');

  perform public._teste_como(null, null);
  select id into fa from public.funis where tenant_id = t_a and padrao;
  select id into ea_ini from public.etapas_funil where funil_id = fa and etapa_inicial;
  select id into ea_ag from public.etapas_funil where funil_id = fa and chave = 'reuniao_agendada';
  select id into fb from public.funis where tenant_id = t_b and padrao;
  select id into eb_ini from public.etapas_funil where funil_id = fb and etapa_inicial;

  -- ============================================================ 1. criação
  perform public._teste_como(u_ag, 'empresa-a');
  begin
    perform public.criar_fonte_lead('webhook', 'Site', fa, ea_ini, u_a2);
    assert false, 'gerente cria fonte';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(u_a, 'empresa-a');
  begin
    perform public.criar_fonte_lead('webhook', 'Cruzada', fb, eb_ini, u_a2);
    assert false, 'funil de B em fonte de A';
  exception when foreign_key_violation or check_violation then null; end;
  begin
    perform public.criar_fonte_lead('webhook', 'Etapa errada', fa, eb_ini, u_a2);
    assert false, 'etapa de outro funil';
  exception when foreign_key_violation or check_violation then null; end;
  begin
    perform public.criar_fonte_lead('webhook', 'Resp. de fora', fa, ea_ini, u_b);
    assert false, 'responsável de outra empresa';
  exception when check_violation then null; end;
  select * into v_r from public.criar_fonte_lead('webhook', 'Site A', fa, ea_ag, u_a2);
  f_wa := v_r.id; tok_a := v_r.token;
  assert tok_a ~ '^rx7f_[0-9a-f]{32}_[0-9a-f]{64}$', 'token da fonte';
  perform public._teste_como(u_b, 'empresa-b');
  select * into v_r from public.criar_fonte_lead('webhook', 'Site B', fb, eb_ini, u_b);
  f_wb := v_r.id; tok_b := v_r.token;
  raise notice 'ok 1  só admin cria fonte; funil, etapa e responsável sempre da própria empresa';

  -- ============================================================ 2. ingestão e mapeamento
  perform public._teste_papel('service_role');
  select * into v_r from public.fonte_por_token(tok_a);
  assert v_r.id = f_wa, 'token de A resolve a fonte de A';
  assert not exists (select 1 from public.fonte_por_token(left(tok_a, 38) || repeat('0', 64))), 'segredo errado não resolve';
  select * into v_r from public.ingerir_lead_fonte(f_wa, 'ext-1', '  Ana   Souza ', '(21) 99999-0000', 'ANA@Teste.com');
  assert v_r.resultado = 'criado', v_r.resultado;
  select * into v_r2 from public.ingerir_lead_fonte(f_wa, 'ext-1', 'Ana Souza', '21999990000', null);
  assert v_r2.resultado = 'atualizado' and v_r2.negociacao_id = v_r.negociacao_id, 'reenvio não duplica';
  perform public._teste_como(null, null);
  select n.tenant_id, n.etapa_id, n.funil_id, n.owner_id, c.telefone, c.email, c.nome
    into v_r2 from public.negociacoes n join public.clientes c on c.id = n.cliente_id where n.id = v_r.negociacao_id;
  assert v_r2.tenant_id = t_a and v_r2.funil_id = fa and v_r2.etapa_id = ea_ag and v_r2.owner_id = u_a2,
    'empresa, funil, etapa e responsável da fonte';
  assert v_r2.telefone = '5521999990000' and v_r2.email = 'ana@teste.com' and v_r2.nome = 'Ana Souza', 'dados normalizados';
  assert (select count(*) from public.negociacoes where tenant_id = t_a and external_id like '%ext-1') = 1, 'uma negociação';
  raise notice 'ok 2  lead na empresa/funil/etapa/responsável da fonte; normalizado; reenvio não duplica';

  -- ============================================================ 3. A × B
  perform public._teste_papel('service_role');
  select * into v_r2 from public.ingerir_lead_fonte(f_wb, 'ext-1', 'Ana Souza', '21999990000', 'ana@teste.com');
  assert v_r2.resultado = 'criado', 'mesmo contato em B cria lead próprio';
  perform public._teste_como(null, null);
  assert (select tenant_id from public.negociacoes where id = v_r2.negociacao_id) = t_b, 'lead de B em B';
  assert (select count(distinct c.id) from public.clientes c where c.telefone = '5521999990000' and c.tenant_id in (t_a, t_b)) = 2,
    'clientes independentes';
  perform public._teste_como(u_a, 'empresa-a');
  select count(*) into v_n from public.fontes_leads;
  assert v_n = 1, format('A vê só a própria fonte, viu %s', v_n);
  select count(*) into v_n from public.ingestao_eventos where tenant_id <> t_a;
  assert v_n = 0, 'A não vê eventos de B';
  begin perform segredo_hash from public.fontes_leads; assert false, 'hash legível';
  exception when insufficient_privilege then null; end;
  begin perform public.ingerir_lead_fonte(f_wb, 'x', 'X', '21999990001', null); assert false, 'usuário ingere direto';
  exception when insufficient_privilege then null; end;
  begin perform public.fonte_por_token(tok_b); assert false, 'usuário resolve token';
  exception when insufficient_privilege then null; end;
  raise notice 'ok 3  lead de A nunca entra em B; mesmo contato independente; A não vê fontes, eventos ou segredos de B';

  -- ============================================================ 4. revogada, pausada, suspensa
  perform public._teste_como(u_a, 'empresa-a');
  perform public.revogar_fonte_lead(f_wa);
  perform public._teste_papel('service_role');
  assert not exists (select 1 from public.fonte_por_token(tok_a)), 'token revogado não resolve';
  select * into v_r from public.ingerir_lead_fonte(f_wa, 'ext-2', 'Bia', '21988887777', null);
  assert v_r.resultado = 'recusado' and v_r.erro_codigo = 'fonte_revogada', 'revogada recusa';
  perform public._teste_como(u_a, 'empresa-a');
  begin perform public.definir_status_fonte(f_wa, 'ativa'); assert false, 'reativar revogada';
  exception when no_data_found or check_violation then null; end;

  perform public._teste_como(u_b, 'empresa-b');
  perform public.definir_status_fonte(f_wb, 'pausada');
  perform public._teste_papel('service_role');
  select * into v_r from public.ingerir_lead_fonte(f_wb, 'ext-3', 'Caio', '21977776666', null);
  assert v_r.erro_codigo = 'fonte_pausada', 'pausada recusa';
  perform public._teste_como(u_b, 'empresa-b');
  perform public.definir_status_fonte(f_wb, 'ativa');

  perform public._teste_como(u_super, null);
  perform public.admin_suspender_empresa(t_b, 'Teste de suspensão');
  perform public._teste_papel('service_role');
  select * into v_r from public.ingerir_lead_fonte(f_wb, 'ext-4', 'Davi', '21966665555', null);
  assert v_r.erro_codigo = 'empresa_indisponivel', 'empresa suspensa recusa';
  perform public._teste_como(u_super, null);
  perform public.admin_reativar_empresa(t_b, 'Fim do teste');
  perform public._teste_como(null, null);
  assert not exists (select 1 from public.negociacoes where external_id like '%ext-2' or external_id like '%ext-3' or external_id like '%ext-4'),
    'nada gravado';
  assert (select count(*) from public.ingestao_eventos where resultado = 'recusado') = 3, 'recusas registradas';
  raise notice 'ok 4  fonte revogada/pausada e empresa suspensa não recebem; recusas registradas';

  -- ============================================================ 5. Meta / WhatsApp
  perform public._teste_como(u_a, 'empresa-a');
  select id into f_meta from public.criar_fonte_lead('meta_lead_ads', 'Meta A', fa, ea_ini, u_a2, '{"page_id":"1234567890"}');
  perform public._teste_como(u_b, 'empresa-b');
  begin
    perform public.criar_fonte_lead('meta_lead_ads', 'Meta B', fb, eb_ini, u_b, '{"page_id":"1234567890"}');
    assert false, 'B reivindica a mesma página';
  exception when unique_violation then null; end;
  begin
    perform public.criar_fonte_lead('meta_lead_ads', 'Meta sem página', fb, eb_ini, u_b, '{}');
    assert false, 'meta sem page_id';
  exception when invalid_parameter_value then null; end;
  perform public._teste_papel('service_role');
  assert not exists (select 1 from public.fonte_por_provedor('meta_lead_ads', '1234567890')), 'não validada não é localizada';
  select * into v_r from public.ingerir_lead_fonte(f_meta, 'lead-1', 'Eva', '21955554444', null);
  assert v_r.erro_codigo = 'fonte_nao_validada', 'não validada recusa';
  perform public._teste_como(u_a, 'empresa-a');
  perform public.definir_segredo_fonte(f_meta, 'token-de-pagina-ficticio-0123456789');
  perform public._teste_papel('service_role');
  perform public.marcar_fonte_validada(f_meta, true);
  select * into v_r from public.fonte_por_provedor('meta_lead_ads', '1234567890');
  assert v_r.id = f_meta, 'validada é localizada pela página';
  assert public.fonte_segredo_provedor(f_meta) = 'token-de-pagina-ficticio-0123456789', 'segredo no Vault';
  perform public._teste_como(u_a, 'empresa-a');
  begin perform public.fonte_segredo_provedor(f_meta); assert false, 'usuário lê token do provedor';
  exception when insufficient_privilege then null; end;
  perform public.atualizar_fonte_lead(f_meta, 'Meta A', fa, ea_ini, u_a2, '{"page_id":"9999999999"}');
  perform public._teste_papel('service_role');
  assert not exists (select 1 from public.fonte_por_provedor('meta_lead_ads', '9999999999')), 'trocar página exige nova validação';
  raise notice 'ok 5  Meta/WhatsApp só recebem depois da validação; página não é compartilhada; token do provedor só no Vault';

  -- ============================================================ 6. formulário RX7 público
  perform public._teste_como(u_a, 'empresa-a');
  select id into f_form from public.criar_fonte_lead('formulario_rx7', 'Contato do site', fa, ea_ini, u_a2);
  perform public._teste_papel('anon');
  select * into v_r from public.formulario_rx7_publico(f_form);
  assert v_r.ativo and v_r.empresa = 'Empresa A', 'formulário público da fonte';
  v_ok := public.enviar_formulario_rx7(f_form, v_envio, 'Fábio', '21944443333', null, null, 'Quero orçamento');
  assert v_ok, 'envio aceito';
  v_ok := public.enviar_formulario_rx7(f_form, v_envio, 'Fábio', '21944443333', null);
  assert v_ok, 'reenvio aceito (idempotente)';
  v_ok := public.enviar_formulario_rx7(f_form, gen_random_uuid(), 'Robô', '21900000000', null, null, null, 'http://spam');
  assert v_ok, 'isca finge sucesso';
  begin perform public.ingerir_lead_fonte(f_form, 'x', 'X', '21900000001', null); assert false, 'anon ingere direto';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.fontes_leads; assert false, 'anon lê fontes';
  exception when insufficient_privilege then null; end;
  perform public._teste_como(null, null);
  assert (select count(*) from public.negociacoes where external_id = f_form::text || ':' || v_envio::text) = 1, 'um lead por envio';
  assert not exists (select 1 from public.clientes where nome = 'Robô'), 'isca não grava';
  raise notice 'ok 6  formulário RX7: idempotente por envio, isca, anon sem acesso extra';

  -- ============================================================ 7. limites e erros
  perform public._teste_papel('service_role');
  select * into v_r from public.ingerir_lead_fonte(f_wb, 'ext-5', 'Sem contato', 'abc', 'nao-e-email');
  assert v_r.resultado = 'erro' and v_r.erro_codigo = '22023', 'erro de validação';
  perform public._teste_como(null, null);
  assert exists (select 1 from public.ingestao_eventos where fonte_id = f_wb and resultado = 'erro' and erro_codigo = '22023'),
    'erro registrado';
  assert (select ultimo_erro from public.fontes_leads where id = f_wb) is not null, 'último erro na fonte';
  update public.planos set limite_integracoes = public.uso_integracoes(t_a), recursos = array['ingestao_leads']
   where codigo = 'starter';
  perform public._teste_como(u_a, 'empresa-a');
  begin
    perform public.criar_fonte_lead('webhook', 'Acima do limite', fa, ea_ini, u_a2);
    assert false, 'limite de integrações';
  exception when sqlstate 'RX002' then null; end;
  perform public._teste_como(null, null);
  update public.planos set limite_integracoes = null where codigo = 'starter';
  perform public._teste_como(u_a, 'empresa-a');
  begin
    perform public.criar_fonte_lead('whatsapp_cloud', 'WhatsApp', fa, ea_ini, u_a2, '{"phone_number_id":"5551234567"}');
    assert false, 'WhatsApp fora do plano';
  exception when sqlstate 'RX003' then null; end;
  raise notice 'ok 7  erros registrados; limite de integrações e recurso do plano respeitados';

  -- ============================================================ 8. legado
  perform public._teste_como(null, null);
  assert (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.clientes c where tenant_id = t_arq) = (select h_cli from _base),
    'clientes legados';
  raise notice 'ok 8  legado intacto';
  raise notice 'fontes_leads_test.sql: todas as asserções passaram.';
end;
$$;

rollback;
