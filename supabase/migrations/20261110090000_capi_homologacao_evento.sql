set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Meta Conversions API (CRM) — homologação de UM evento, fora da fila geral.
-- LOCAL. Ainda NÃO aplicada em produção.
--
-- Por que existe: a fila normal (meta_conversoes_eventos) só envia com a
-- conexão ATIVA, e ativar liga o envio da empresa inteira. Para conferir um
-- único evento (payload, dataset e credencial do AVANTE) sem isso:
--   - só o Super Admin (super_admins) COM a janela auditada do "Acessar CRM"
--     aberta para a empresa (super_admin_acessos), só empresa na lista de
--     homologação da CAPI e só com o envio geral DESLIGADO ("configurando" ou
--     "pausada");
--   - só a negociação, o ID de lead e o formulário expressamente escolhidos (a
--     Edge Function só chama com o secret CAPI_HOMOLOGACAO, desligada por padrão);
--   - só um lead comprovadamente da ferramenta de teste da Meta: dados fictícios
--     gerados pela Meta ("<test lead: dummy data for …>") gravados na entrada,
--     form_id do formulário autorizado, sem anúncio de origem, created_time da
--     Meta nas últimas 72 h. Um nome digitado ("Homologação") NÃO basta: sem a
--     prova da Meta, nada é enviado;
--   - ID de lead da própria negociação, intocada na etapa inicial, não
--     arquivada, que entrou no funil nas últimas 72 h;
--   - um evento de etapa inicial ("Lead recebido"), no horário real da entrada
--     do lead no funil, sem valor e sem dados de contato;
--   - event_id próprio (avante-homologacao-<negociação>): nunca gasta o evento
--     real; uma homologação por negociação, nunca reenviada;
--   - tabela própria: não entra na fila, não muda a conexão, a negociação nem o
--     histórico; auditoria no início e no fim; código de teste e token nunca
--     são gravados.
-- ===========================================================================

create table public.meta_conversoes_homologacoes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  conexao_id     uuid not null,
  negociacao_id  uuid not null references public.negociacoes (id) on delete cascade,
  dataset_id     text not null check (dataset_id ~ '^[0-9]{5,30}$'),
  lead_id        text not null check (lead_id ~ '^[0-9]{15,17}$'),
  formulario_id  text not null check (formulario_id ~ '^[0-9]{5,30}$'),
  evento         text not null check (evento ~ '^[[:alnum:] _À-ÿ-]{2,50}$'),
  event_id       text not null unique,
  event_time     timestamptz not null,
  situacao       text not null default 'enviando' check (situacao in ('enviando', 'enviado', 'rejeitado')),
  resultado      text check (resultado is null or resultado in ('ok', 'temporario', 'permanente', 'autorizacao', 'limite')),
  ultimo_erro    text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  fbtrace_id     text check (fbtrace_id is null or length(fbtrace_id) <= 100),
  solicitado_por uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  concluido_em   timestamptz,
  -- Proteção contra repetição: uma homologação por negociação, para sempre.
  unique (tenant_id, negociacao_id),
  foreign key (tenant_id, conexao_id) references public.meta_conversoes_conexoes (tenant_id, id) on delete cascade
);
-- No máximo um envio de homologação em curso por empresa.
create unique index meta_conversoes_homologacoes_em_curso on public.meta_conversoes_homologacoes (tenant_id) where situacao = 'enviando';
alter table public.meta_conversoes_homologacoes enable row level security;
revoke all on public.meta_conversoes_homologacoes from public, anon, authenticated;

comment on table public.meta_conversoes_homologacoes is
  'Homologação de um único evento da CAPI (Super Admin), fora da fila geral. Sem token, sem código de teste, sem dados de contato.';

-- created_time da Meta (texto da planilha) → timestamptz; inválido = nulo (nunca erro).
create function public.capi_homologacao_momento(p_texto text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_texto is null or btrim(p_texto) !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return btrim(p_texto)::timestamptz;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conferência (p_reservar = false) ou reserva (true) do evento de homologação.
-- Só o servidor (service_role). Devolve a credencial SÓ na reserva.
-- ---------------------------------------------------------------------------
create function public.capi_homologacao_preparar(
  p_tenant uuid, p_usuario uuid, p_negociacao uuid, p_lead_id text, p_dataset text, p_formulario text, p_reservar boolean)
returns table (homologacao uuid, dataset text, negocio text, nome_evento text, id_evento text, momento_unix bigint,
               lead text, credencial text, ja_feita boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_con      public.meta_conversoes_conexoes;
  v_neg      public.negociacoes;
  v_lead     text;
  v_inicial  uuid;
  v_quando   timestamptz;
  v_gerado   timestamptz;
  v_id       uuid;
  v_token    text;
  v_evento   constant text := 'Lead recebido';
  v_marca    constant text := '<test lead: dummy data';
  v_event_id text;
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
  --  a) dados fictícios gerados pela Meta no contato ou nas respostas;
  if not (exists (select 1 from public.clientes cl where cl.id = v_neg.cliente_id
                    and (strpos(lower(coalesce(cl.nome, '')), v_marca) > 0 or strpos(lower(coalesce(cl.email, '')), v_marca) > 0))
          or exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and strpos(lower(r.resposta), v_marca) > 0)) then
    raise exception 'Sem prova de lead da ferramenta de teste da Meta (dados fictícios "<test lead: dummy data…>"). Nada é enviado.' using errcode = '23514';
  end if;
  --  b) do formulário autorizado;
  if p_formulario is null or p_formulario !~ '^[0-9]{5,30}$'
     or not exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta = 'form_id' and btrim(r.resposta) = p_formulario) then
    raise exception 'O lead não veio do formulário autorizado para a homologação.' using errcode = '23514';
  end if;
  --  c) sem anúncio de origem (lead de anúncio é lead comercial);
  if exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta = 'ad_id'
               and btrim(r.resposta) ~ '[0-9]' and strpos(lower(r.resposta), v_marca) = 0) then
    raise exception 'O lead veio de um anúncio: não é um lead de teste.' using errcode = '23514';
  end if;
  --  d) o ID gravado pela Meta na planilha (coluna id), quando existir, é o mesmo;
  if exists (select 1 from public.negociacao_respostas r where r.negociacao_id = v_neg.id and r.pergunta = 'id'
               and regexp_replace(r.resposta, '[^0-9]', '', 'g') <> v_lead) then
    raise exception 'O ID gravado pela Meta não confere com o lead autorizado.' using errcode = '23514';
  end if;
  --  e) gerado pela Meta nas últimas 72 horas (created_time da Meta).
  select public.capi_homologacao_momento(r.resposta) into v_gerado from public.negociacao_respostas r
   where r.negociacao_id = v_neg.id and r.pergunta = 'created_time' order by r.recebida_em desc limit 1;
  if v_gerado is null or v_gerado < now() - interval '72 hours' or v_gerado > now() + interval '10 minutes' then
    raise exception 'Sem horário de criação da Meta nas últimas 72 horas para este lead.' using errcode = '23514';
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

-- Resultado do envio de homologação. Nunca devolve nada para a fila geral.
create function public.capi_homologacao_concluir(p_homologacao uuid, p_resultado text, p_erro text, p_fbtrace text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.meta_conversoes_homologacoes;
  v_r text := case when p_resultado in ('ok', 'temporario', 'permanente', 'autorizacao', 'limite') then p_resultado else 'permanente' end;
begin
  select * into v_h from public.meta_conversoes_homologacoes where id = p_homologacao and situacao = 'enviando' for update;
  if v_h.id is null then return; end if;
  update public.meta_conversoes_homologacoes
     set situacao = case when v_r = 'ok' then 'enviado' else 'rejeitado' end, resultado = v_r,
         ultimo_erro = case when v_r = 'ok' then null else left(coalesce(p_erro, 'Erro da Meta'), 300) end,
         fbtrace_id = left(p_fbtrace, 100), concluido_em = now()
   where id = v_h.id;
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values (v_h.solicitado_por, 'capi_homologacao_concluida', v_h.tenant_id,
          jsonb_build_object('homologacao', v_h.id, 'resultado', v_r, 'fbtrace', left(p_fbtrace, 100)));
end;
$$;

revoke all on function public.capi_homologacao_momento(text) from public, anon, authenticated;
revoke all on function public.capi_homologacao_preparar(uuid, uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.capi_homologacao_concluir(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.capi_homologacao_momento(text) to service_role;
grant execute on function public.capi_homologacao_preparar(uuid, uuid, uuid, text, text, text, boolean) to service_role;
grant execute on function public.capi_homologacao_concluir(uuid, text, text, text) to service_role;
