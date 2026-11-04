set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Meta Conversions API (CRM) — homologação de UM evento: correção da trava do
-- formulário, da prova de lead de teste e da ligação com cliente já existente.
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- Corrige 20261110090000 (já aplicada em produção; não é editada):
--
--  1. Formulário. A planilha nativa da Meta grava o form_id como
--     "f:1459591029473591"; a trava comparava o texto com só os dígitos e
--     recusava todo lead da aba. Agora aceita "f:" + dígitos ou só os dígitos,
--     e exige os MESMOS dígitos do formulário autorizado. Qualquer outro valor
--     ("F:", espaço no meio, outro prefixo, dígitos a mais ou a menos) e um
--     segundo form_id diferente no mesmo lead são recusados. O formulário
--     autorizado (secret CAPI_HOMOLOGACAO) continua só com os dígitos.
--
--  2. Prova de lead de teste. A Meta não documenta o texto exato dos dados
--     fictícios da ferramenta de teste; antes se exigia "<test lead: dummy
--     data" (com "<") em UM campo qualquer. Agora vale o valor INTEIRO no
--     formato "<test lead: dummy data for …>" ou "test lead: dummy data for …",
--     em pelo menos DOIS campos diferentes do próprio lead (nome, empresa ou
--     respostas da linha). O e-mail nunca conta (test@fb.com não prova nada) e
--     só o nome não basta. Sem anúncio, conjunto nem campanha de origem: pela
--     Meta, lead de teste não vem de anúncio. Sem essa prova, nada é enviado.
--
--  3. Cliente ou negociação já existente. A ferramenta da Meta repete o e-mail
--     fictício (test@fb.com) e a entrada de leads reaproveita cliente pelo
--     e-mail. A homologação recusa lead ligado a cliente que já existia,
--     cliente com outra negociação, negociação com outro lead anexado (origens
--     adicionais), contato divergente ou respostas de mais de um envio.
--     A deduplicação dos leads (entrada) não muda.
--
-- Continuam iguais: todas as outras travas (Super Admin com a janela do
-- "Acessar CRM", empresa em homologação, envio geral desligado, dataset, ID
-- de lead explicitamente autorizado, ID gravado pela Meta, 72 h, lead intocado,
-- event_id próprio, sem repetição, limite diário), a tabela, a conclusão, a
-- auditoria e os privilégios (só service_role).
-- ===========================================================================

-- form_id da planilha → dígitos do formulário ("f:" + dígitos ou só dígitos); qualquer outro valor = nulo.
create function public.capi_homologacao_formulario(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$ select substring(btrim(coalesce(p_texto, '')) from '^(?:f:)?([0-9]{5,30})$') $$;

-- O valor INTEIRO são os dados fictícios da ferramenta de teste da Meta (com ou sem "<…>").
create function public.capi_homologacao_ficticio(p_texto text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(btrim(p_texto))
                  ~ '^(<test lead: dummy data for [^<>[:cntrl:]]{1,200}>|test lead: dummy data for [^<>[:cntrl:]]{1,200})$', false)
$$;

-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20261110090000; mudam só as travas a), b), c) e a nova f).
-- ---------------------------------------------------------------------------
create or replace function public.capi_homologacao_preparar(
  p_tenant uuid, p_usuario uuid, p_negociacao uuid, p_lead_id text, p_dataset text, p_formulario text, p_reservar boolean)
returns table (homologacao uuid, dataset text, negocio text, nome_evento text, id_evento text, momento_unix bigint,
               lead text, credencial text, ja_feita boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_con       public.meta_conversoes_conexoes;
  v_neg       public.negociacoes;
  v_lead      text;
  v_inicial   uuid;
  v_quando    timestamptz;
  v_gerado    timestamptz;
  v_id        uuid;
  v_token     text;
  v_evento    constant text := 'Lead recebido';
  v_ficticios integer;
  v_event_id  text;
begin
  if p_usuario is null or not exists (select 1 from public.super_admins s where s.user_id = p_usuario) then
    raise exception 'A homologação da CAPI é exclusiva do Super Admin.' using errcode = '42501';
  end if;
  -- A mesma janela auditada do "Acessar CRM" (o servidor já exigiu; aqui, de novo, no banco).
  if not exists (select 1 from public.super_admin_acessos a
                  where a.user_id = p_usuario and a.tenant_id = p_tenant and a.encerrado_em is null and a.expira_em > now()) then
    raise exception 'Abra o "Acessar CRM" desta empresa pelo painel do Super Admin.' using errcode = '42501';
  end if;
  perform public.exigir_integracao_habilitada('meta_conversoes', p_tenant);
  if not public.meta_conversoes_elegivel(p_tenant) then
    raise exception 'Conversões do CRM não liberadas para esta empresa.' using errcode = 'RX003';
  end if;
  if not exists (select 1 from public.plataforma_integracoes_empresas e where e.tipo = 'meta_conversoes' and e.tenant_id = p_tenant) then
    raise exception 'A homologação vale só para empresa liberada em homologação da CAPI.' using errcode = '42501';
  end if;

  select * into v_con from public.meta_conversoes_conexoes c where c.tenant_id = p_tenant and c.situacao <> 'desconectada';
  if v_con.id is null then raise exception 'Nenhuma conexão da CAPI nesta empresa.' using errcode = 'P0002'; end if;
  if v_con.situacao not in ('configurando', 'pausada') then
    raise exception 'A homologação só roda com o envio geral desligado (situação atual: %).', v_con.situacao using errcode = '23514';
  end if;
  if p_dataset is null or v_con.dataset_id <> p_dataset then
    raise exception 'O dataset conectado não é o autorizado para a homologação.' using errcode = '23514';
  end if;
  if v_con.vault_secret_id is null then raise exception 'Conexão sem credencial: conecte o dataset de novo.' using errcode = '23514'; end if;

  select * into v_neg from public.negociacoes n where n.id = p_negociacao and n.tenant_id = p_tenant;
  if v_neg.id is null then raise exception 'Negociação não encontrada nesta empresa.' using errcode = 'P0002'; end if;
  if v_neg.excluida_em is not null or v_neg.arquivada_em is not null then
    raise exception 'Negociação arquivada ou excluída.' using errcode = '23514';
  end if;
  -- O ID tem de ser o da PRÓPRIA negociação (nunca só de uma origem adicional de uma negociação reaproveitada).
  v_lead := case when p_lead_id is not null and (v_neg.atribuicao ->> 'leadgen_id' = p_lead_id or v_neg.atribuicao ->> 'meta_lead_id' = p_lead_id)
                 then p_lead_id end;
  if v_lead is null or v_lead !~ '^[0-9]{15,17}$' then
    raise exception 'O ID de lead da negociação não confere com o lead de homologação autorizado.' using errcode = '23514';
  end if;

  -- Prova de que é um lead da FERRAMENTA DE TESTE da Meta (gravada na entrada, vinda da Meta, nunca digitada aqui):
  --  a) dados fictícios da Meta (o valor inteiro, com ou sem "<…>") em pelo menos DOIS campos diferentes do
  --     próprio lead; o e-mail nunca conta (test@fb.com não prova nada) e só o nome não basta;
  select count(distinct lower(btrim(x.valor))) into v_ficticios
    from (select cl.nome as valor from public.clientes cl where cl.id = v_neg.cliente_id
          union all
          select cl.empresa from public.clientes cl where cl.id = v_neg.cliente_id
          union all
          select r.resposta from public.negociacao_respostas r where r.negociacao_id = v_neg.id) x
   where public.capi_homologacao_ficticio(x.valor);
  if v_ficticios < 2 then
    raise exception 'Sem prova suficiente de lead da ferramenta de teste da Meta (dados fictícios da Meta em pelo menos dois campos do lead). Nada é enviado.' using errcode = '23514';
  end if;
  --  b) do formulário autorizado: form_id "f:" + dígitos (planilha nativa da Meta) ou só os dígitos, os MESMOS
  --     do autorizado; nenhum outro form_id no lead;
  if p_formulario is null or p_formulario !~ '^[0-9]{5,30}$'
     or not exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta = 'form_id'
                      and public.capi_homologacao_formulario(r.resposta) = p_formulario)
     or exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta = 'form_id'
                  and public.capi_homologacao_formulario(r.resposta) is distinct from p_formulario) then
    raise exception 'O lead não veio do formulário autorizado para a homologação.' using errcode = '23514';
  end if;
  --  c) sem anúncio, conjunto ou campanha de origem (lead da ferramenta de teste não vem de anúncio);
  if exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta in ('ad_id', 'adset_id', 'campaign_id')
               and btrim(r.resposta) ~ '[0-9]' and not public.capi_homologacao_ficticio(r.resposta)) then
    raise exception 'O lead veio de um anúncio: não é um lead de teste.' using errcode = '23514';
  end if;
  --  d) o ID gravado pela Meta na planilha (coluna id), quando existir, é o mesmo;
  if exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta = 'id'
               and regexp_replace(r.resposta, '[^0-9]', '', 'g') <> v_lead) then
    raise exception 'O ID gravado pela Meta não confere com o lead autorizado.' using errcode = '23514';
  end if;
  --  e) gerado pela Meta nas últimas 72 horas (created_time da Meta);
  select public.capi_homologacao_momento(r.resposta) into v_gerado from public.negociacao_respostas r
   where r.negociacao_id = v_neg.id and r.pergunta = 'created_time' order by r.recebida_em desc limit 1;
  if v_gerado is null or v_gerado < now() - interval '72 hours' or v_gerado > now() + interval '10 minutes' then
    raise exception 'Sem horário de criação da Meta nas últimas 72 horas para este lead.' using errcode = '23514';
  end if;
  --  f) lead só desta negociação. A Meta repete o e-mail fictício (test@fb.com) e a entrada reaproveita cliente
  --     pelo e-mail: cliente que já existia, cliente com outra negociação, outro lead anexado, contato divergente
  --     ou respostas de mais de um envio = recusado (nada é apagado nem desfeito).
  if v_neg.atribuicao ? 'origens_adicionais'
     or coalesce(v_neg.atribuicao ->> 'contato_divergente', '') = 'true'
     or exists (select 1 from public.negociacoes o where o.cliente_id = v_neg.cliente_id and o.id <> v_neg.id)
     or not exists (select 1 from public.clientes cl where cl.id = v_neg.cliente_id and cl.tenant_id = p_tenant
                      and cl.deleted_at is null and cl.created_at >= v_neg.created_at)
     or (select count(distinct r.envio) from public.negociacao_respostas r where r.negociacao_id = v_neg.id) <> 1 then
    raise exception 'O lead de homologação está ligado a um cliente ou a uma negociação que já existia, ou a outro lead. Nada é enviado.' using errcode = '23514';
  end if;

  -- Horário real da etapa "lead recebido": a entrada da negociação na etapa inicial do funil.
  select e.id into v_inicial from public.etapas_funil e where e.funil_id = v_neg.funil_id and e.etapa_inicial;
  select h.created_at into v_quando from public.historico_etapas h
   where h.negociacao_id = v_neg.id and h.etapa_anterior_id is null and h.etapa_nova_id = v_inicial
   order by h.created_at limit 1;
  if v_quando is null then
    raise exception 'A negociação não tem o registro da entrada na etapa inicial.' using errcode = '23514';
  end if;
  -- Lead intocado: ainda na etapa inicial e sem nenhuma movimentação depois da entrada.
  if v_neg.etapa_id is distinct from v_inicial or (select count(*) from public.historico_etapas h where h.negociacao_id = v_neg.id) <> 1 then
    raise exception 'A negociação já foi movimentada no funil: não é um lead de homologação.' using errcode = '23514';
  end if;
  -- Lead novo: entrou nas últimas 72 horas, depois da criação na Meta (e dentro dos 7 dias da Meta).
  if v_quando < now() - interval '72 hours' or v_quando < v_gerado then
    raise exception 'O lead de homologação precisa ter entrado no funil nas últimas 72 horas, depois da criação na Meta.' using errcode = '23514';
  end if;

  v_event_id := 'avante-homologacao-' || v_neg.id::text;

  -- Envio sem confirmação há mais de 10 minutos: encerra como rejeitado (nunca volta para fila).
  update public.meta_conversoes_homologacoes x
     set situacao = 'rejeitado', resultado = coalesce(x.resultado, 'temporario'),
         ultimo_erro = coalesce(x.ultimo_erro, 'Sem confirmação do envio.'), concluido_em = now()
   where x.tenant_id = p_tenant and x.situacao = 'enviando' and x.created_at < now() - interval '10 minutes';

  if exists (select 1 from public.meta_conversoes_homologacoes x where x.tenant_id = p_tenant and x.negociacao_id = v_neg.id) then
    if p_reservar then
      raise exception 'Esta negociação já teve o evento de homologação. Não há reenvio.' using errcode = '23505';
    end if;
    return query select null::uuid, v_con.dataset_id, v_con.business_id, v_evento, v_event_id,
                        extract(epoch from v_quando)::bigint, v_lead, null::text, true;
    return;
  end if;
  if not p_reservar then
    return query select null::uuid, v_con.dataset_id, v_con.business_id, v_evento, v_event_id,
                        extract(epoch from v_quando)::bigint, v_lead, null::text, false;
    return;
  end if;

  if (select count(*) from public.meta_conversoes_homologacoes x
       where x.tenant_id = p_tenant and x.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'Limite de homologações da CAPI nas últimas 24 horas.' using errcode = 'RX010';
  end if;
  insert into public.meta_conversoes_homologacoes (tenant_id, conexao_id, negociacao_id, dataset_id, lead_id, formulario_id, evento,
                                                   event_id, event_time, solicitado_por)
  values (p_tenant, v_con.id, v_neg.id, v_con.dataset_id, v_lead, p_formulario, v_evento, v_event_id, v_quando, p_usuario)
  returning id into v_id;
  select s.decrypted_secret::text into v_token from vault.decrypted_secrets s where s.id = v_con.vault_secret_id;
  if v_token is null then raise exception 'Credencial da conexão indisponível.' using errcode = '23514'; end if;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (p_usuario, 'capi_homologacao_iniciada', p_tenant,
          jsonb_build_object('homologacao', v_id, 'negociacao', v_neg.id, 'event_id', v_event_id, 'evento', v_evento,
                             'dataset', v_con.dataset_id, 'formulario', p_formulario));
  return query select v_id, v_con.dataset_id, v_con.business_id, v_evento, v_event_id,
                      extract(epoch from v_quando)::bigint, v_lead, v_token, false;
end;
$$;

-- Funções auxiliares: ninguém de fora chama (só usadas dentro da função acima).
revoke all on function public.capi_homologacao_formulario(text) from public, anon, authenticated;
revoke all on function public.capi_homologacao_ficticio(text) from public, anon, authenticated;
-- create or replace mantém dono e privilégios; reafirmados aqui, iguais aos de 20261110090000 (só service_role).
revoke all on function public.capi_homologacao_preparar(uuid, uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.capi_homologacao_preparar(uuid, uuid, uuid, text, text, text, boolean) to service_role;
