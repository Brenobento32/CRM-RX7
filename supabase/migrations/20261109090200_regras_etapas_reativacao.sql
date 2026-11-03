-- AVANTE — Pacote 9 (complemento): exigências por funil e etapa e reativação sem "promover" assinatura.
--
-- 1) Regras por etapa (só o Super Admin configura, por empresa → funil → etapa, pelo id real da etapa):
--    - cada campo comercial da negociação: "Não usar" (oculto), "Opcional" (padrão) ou
--      "Obrigatório para entrar na etapa";
--    - checklist de confirmações obrigatórias para entrar na etapa (quem confirmou e quando fica gravado).
--    Sem linha = nenhuma exigência (é o padrão de toda empresa, nova ou existente).
--    Vale só para etapas ABERTAS e que não são a inicial: fechamento (ganha) e perda continuam com as
--    regras próprias (regras comerciais da empresa e motivo de perda). Entrada de leads (planilha,
--    formulários, Meta, WhatsApp) cria na etapa inicial e nunca é bloqueada.
--    A trava fica no banco (gatilho na troca de etapa), então vale para qualquer caminho de movimentação.
--    Exige só para ENTRAR: negociações que já estão na etapa não mudam, nada é reaberto nem apagado.
--    Campo "Não usar" nunca é apagado: enquanto a negociação estiver na etapa, o valor gravado fica.
--
-- 2) Reativação: devolve a assinatura ao estado que ela tinha ANTES da inativação (pelo histórico de
--    assinaturas, que registra toda mudança). Vencida volta vencida; teste volta teste; nada de datas é
--    mexido. Sem registro do estado anterior, o Super Admin escolhe explicitamente (auditado), e mesmo
--    assim a reativação nunca concede Ativa sem período pago em vigor nem estende um teste vencido.

-- ---------------------------------------------------------------------------------------------------
-- 1. Regras por etapa
-- ---------------------------------------------------------------------------------------------------

create function public.regras_etapa_campos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['valor_estimado', 'temperatura', 'data_primeira_reuniao', 'data_proposta',
               'valor_proposta', 'forma_pagamento', 'objecao_principal', 'servicos']::text[]
$$;

create function public.regras_etapa_rotulo(p_campo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_campo
    when 'valor_estimado' then 'Valor estimado'
    when 'temperatura' then 'Temperatura'
    when 'data_primeira_reuniao' then 'Primeira reunião'
    when 'data_proposta' then 'Data da proposta'
    when 'valor_proposta' then 'Valor da proposta'
    when 'forma_pagamento' then 'Forma de pagamento'
    when 'objecao_principal' then 'Objeção principal'
    when 'servicos' then 'Serviços'
    else p_campo
  end
$$;
revoke all on function public.regras_etapa_campos() from public, anon;
revoke all on function public.regras_etapa_rotulo(text) from public, anon;

create table public.etapa_regras (
  etapa_id     uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  -- Só o que difere de "opcional": {"valor_proposta": "obrigatorio", "temperatura": "oculto"}.
  campos       jsonb not null default '{}'::jsonb,
  -- Itens a confirmar: [{"id": "<estável>", "texto": "..."}]. O id deriva do texto: mudar o texto
  -- cria um item novo (que precisa ser confirmado de novo nas próximas entradas).
  checklist    jsonb not null default '[]'::jsonb,
  motivo       text,
  definido_por uuid,
  definido_em  timestamptz not null default now(),
  constraint etapa_regras_etapa_fk foreign key (tenant_id, etapa_id)
    references public.etapas_funil (tenant_id, id) on delete cascade,
  constraint etapa_regras_campos_objeto check (jsonb_typeof(campos) = 'object'),
  constraint etapa_regras_checklist_lista check (jsonb_typeof(checklist) = 'array')
);
create index etapa_regras_tenant_idx on public.etapa_regras (tenant_id);

alter table public.etapa_regras enable row level security;
revoke all on table public.etapa_regras from public, anon, authenticated;
grant select on table public.etapa_regras to authenticated;
-- Os formulários da empresa leem as regras das próprias etapas (o que mostrar e o que exigir).
create policy etapa_regras_leitura on public.etapa_regras
  for select to authenticated
  using (tenant_id = public.tenant_atual());

create table public.negociacao_confirmacoes_etapa (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  negociacao_id  uuid not null references public.negociacoes (id) on delete cascade,
  etapa_id       uuid not null references public.etapas_funil (id) on delete cascade,
  item_id        text not null,
  texto          text not null,
  confirmado_por uuid,
  confirmado_em  timestamptz not null default now(),
  constraint negociacao_confirmacoes_etapa_unica unique (negociacao_id, etapa_id, item_id)
);
create index negociacao_confirmacoes_etapa_tenant_idx on public.negociacao_confirmacoes_etapa (tenant_id);

alter table public.negociacao_confirmacoes_etapa enable row level security;
revoke all on table public.negociacao_confirmacoes_etapa from public, anon, authenticated;
grant select on table public.negociacao_confirmacoes_etapa to authenticated;
-- Lê quem vê a negociação (a RLS de negociacoes vale dentro da subconsulta). Grava só pela função.
create policy negociacao_confirmacoes_etapa_leitura on public.negociacao_confirmacoes_etapa
  for select to authenticated
  using (tenant_id = public.tenant_atual()
         and exists (select 1 from public.negociacoes n where n.id = negociacao_id));

-- O que falta para a negociação (com os valores de p_n) entrar na etapa. Vazio = pode entrar.
create function public.etapa_requisitos_pendentes(p_n public.negociacoes, p_etapa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r      public.etapa_regras;
  v_campos text[] := '{}';
  v_check  jsonb := '[]'::jsonb;
  v_campo  text;
  v_item   jsonb;
  v_vazio  boolean;
begin
  select * into v_r from public.etapa_regras r where r.etapa_id = p_etapa and r.tenant_id = p_n.tenant_id;
  if v_r.etapa_id is null then
    return jsonb_build_object('campos', '[]'::jsonb, 'checklist', '[]'::jsonb);
  end if;

  foreach v_campo in array public.regras_etapa_campos() loop
    continue when coalesce(v_r.campos ->> v_campo, 'opcional') <> 'obrigatorio';
    v_vazio := case v_campo
      when 'valor_estimado' then p_n.valor_estimado is null
      when 'temperatura' then p_n.temperatura is null
      when 'data_primeira_reuniao' then p_n.data_primeira_reuniao is null
      when 'data_proposta' then p_n.data_proposta is null
      when 'valor_proposta' then p_n.valor_proposta is null
      when 'forma_pagamento' then p_n.forma_pagamento is null
      when 'objecao_principal' then nullif(btrim(coalesce(p_n.objecao_principal, '')), '') is null
      when 'servicos' then not exists (select 1 from public.negociacao_servicos s where s.negociacao_id = p_n.id)
    end;
    if v_vazio then v_campos := v_campos || v_campo; end if;
  end loop;

  for v_item in select * from jsonb_array_elements(v_r.checklist) loop
    if not exists (select 1 from public.negociacao_confirmacoes_etapa c
                    where c.negociacao_id = p_n.id and c.etapa_id = p_etapa and c.item_id = v_item ->> 'id') then
      v_check := v_check || jsonb_build_array(v_item);
    end if;
  end loop;

  return jsonb_build_object('campos', to_jsonb(v_campos), 'checklist', v_check);
end;
$$;
revoke all on function public.etapa_requisitos_pendentes(public.negociacoes, uuid) from public, anon, authenticated;

-- Trava ao entrar na etapa: qualquer caminho que troque etapa_id (Kanban, edição, outra função).
create function public.negociacoes_regras_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e     public.etapas_funil;
  v_pend  jsonb;
  v_lista text;
begin
  if new.etapa_id is not distinct from old.etapa_id then return new; end if;
  if not exists (select 1 from public.etapa_regras r where r.etapa_id = new.etapa_id) then return new; end if;
  select * into v_e from public.etapas_funil e where e.id = new.etapa_id;
  if v_e.tipo <> 'aberta' or v_e.etapa_inicial then return new; end if;

  v_pend := public.etapa_requisitos_pendentes(new, new.etapa_id);
  if jsonb_array_length(v_pend -> 'campos') = 0 and jsonb_array_length(v_pend -> 'checklist') = 0 then
    return new;
  end if;

  select string_agg(x, ', ') into v_lista from (
    select public.regras_etapa_rotulo(c) as x from jsonb_array_elements_text(v_pend -> 'campos') c
    union all
    select 'confirmar "' || (i ->> 'texto') || '"' from jsonb_array_elements(v_pend -> 'checklist') i
  ) l;
  raise exception 'Para mover para "%", falta: %.', v_e.nome, v_lista
    using errcode = 'RX101',
          detail = (jsonb_build_object('etapa_id', v_e.id, 'etapa', v_e.nome) || v_pend)::text;
end;
$$;
revoke all on function public.negociacoes_regras_etapa() from public, anon, authenticated;

-- "zz": roda depois das travas de permissão e de handoff (quem não pode mover recebe esse erro antes).
create trigger negociacoes_zz_regras_etapa
  before update of etapa_id on public.negociacoes
  for each row execute function public.negociacoes_regras_etapa();

-- Campo "Não usar" na etapa atual: o valor gravado nunca é apagado (formulários não o mostram).
create function public.negociacoes_preserva_ocultos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c jsonb;
begin
  if new.etapa_id is distinct from old.etapa_id then return new; end if;
  select r.campos into v_c from public.etapa_regras r where r.etapa_id = new.etapa_id;
  if v_c is null or v_c = '{}'::jsonb then return new; end if;
  if v_c ->> 'valor_estimado' = 'oculto' and new.valor_estimado is null then new.valor_estimado := old.valor_estimado; end if;
  if v_c ->> 'temperatura' = 'oculto' and new.temperatura is null then new.temperatura := old.temperatura; end if;
  if v_c ->> 'data_primeira_reuniao' = 'oculto' and new.data_primeira_reuniao is null then
    new.data_primeira_reuniao := old.data_primeira_reuniao;
  end if;
  if v_c ->> 'data_proposta' = 'oculto' and new.data_proposta is null then new.data_proposta := old.data_proposta; end if;
  if v_c ->> 'valor_proposta' = 'oculto' and new.valor_proposta is null then new.valor_proposta := old.valor_proposta; end if;
  if v_c ->> 'forma_pagamento' = 'oculto' and new.forma_pagamento is null then new.forma_pagamento := old.forma_pagamento; end if;
  if v_c ->> 'objecao_principal' = 'oculto' and nullif(btrim(coalesce(new.objecao_principal, '')), '') is null then
    new.objecao_principal := old.objecao_principal;
  end if;
  return new;
end;
$$;
revoke all on function public.negociacoes_preserva_ocultos() from public, anon, authenticated;

create trigger negociacoes_preserva_ocultos
  before update on public.negociacoes
  for each row execute function public.negociacoes_preserva_ocultos();

-- Mover confirmando os itens do checklist da etapa de destino (mesmas travas de mover_negociacao).
create function public.mover_negociacao_requisitos(
  p_negociacao_id uuid, p_etapa_id uuid, p_posicao numeric, p_confirmados text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
  v_r      public.etapa_regras;
  v_item   jsonb;
begin
  if not exists (select 1 from public.negociacoes n where n.id = p_negociacao_id and n.tenant_id = v_tenant) then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_r from public.etapa_regras r where r.etapa_id = p_etapa_id and r.tenant_id = v_tenant;
  if v_r.etapa_id is not null and coalesce(array_length(p_confirmados, 1), 0) > 0 then
    for v_item in select * from jsonb_array_elements(v_r.checklist) loop
      if (v_item ->> 'id') = any (p_confirmados) then
        insert into public.negociacao_confirmacoes_etapa (tenant_id, negociacao_id, etapa_id, item_id, texto, confirmado_por)
        values (v_tenant, p_negociacao_id, p_etapa_id, v_item ->> 'id', v_item ->> 'texto', (select auth.uid()))
        on conflict (negociacao_id, etapa_id, item_id) do nothing;
      end if;
    end loop;
  end if;
  -- Mesmas checagens de sempre (etapa, funil, ganha/perdida, permissão, handoff) e a trava das regras.
  -- Se algo recusar, as confirmações acima são desfeitas junto.
  perform public.mover_negociacao(p_negociacao_id, p_etapa_id, p_posicao);
end;
$$;
revoke all on function public.mover_negociacao_requisitos(uuid, uuid, numeric, text[]) from public, anon;
grant execute on function public.mover_negociacao_requisitos(uuid, uuid, numeric, text[]) to authenticated;

-- Salvar os dados comerciais e mover numa transação só: se a etapa recusar, nada é gravado
-- (o formulário continua com o que foi digitado).
create function public.salvar_e_mover_negociacao(
  p_negociacao_id uuid, p_valor_estimado numeric, p_temperatura public.temperatura_negociacao,
  p_data_primeira_reuniao date, p_data_proposta date, p_objecao_principal text, p_valor_proposta numeric,
  p_forma_pagamento public.forma_pagamento, p_servico_ids uuid[],
  p_etapa_id uuid, p_posicao numeric, p_confirmados text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.salvar_negociacao(p_negociacao_id, p_valor_estimado, p_temperatura, p_data_primeira_reuniao,
    p_data_proposta, p_objecao_principal, p_valor_proposta, p_forma_pagamento, p_servico_ids);
  perform public.mover_negociacao_requisitos(p_negociacao_id, p_etapa_id, p_posicao, p_confirmados);
end;
$$;
revoke all on function public.salvar_e_mover_negociacao(uuid, numeric, public.temperatura_negociacao, date, date, text,
  numeric, public.forma_pagamento, uuid[], uuid, numeric, text[]) from public, anon;
grant execute on function public.salvar_e_mover_negociacao(uuid, numeric, public.temperatura_negociacao, date, date, text,
  numeric, public.forma_pagamento, uuid[], uuid, numeric, text[]) to authenticated;

-- Super Admin: funis e etapas da empresa com as regras de cada etapa.
create function public.admin_regras_etapas(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'nome', f.nome, 'ativo', f.ativo,
             'etapas', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', e.id, 'nome', e.nome, 'tipo', e.tipo, 'ativo', e.ativo,
                        'configuravel', e.tipo = 'aberta' and not e.etapa_inicial,
                        'campos', coalesce(r.campos, '{}'::jsonb),
                        'checklist', coalesce(r.checklist, '[]'::jsonb),
                        'definido_em', r.definido_em,
                        'negociacoes', (select count(*) from public.negociacoes n where n.etapa_id = e.id))
                      order by e.ordem, e.nome)
                 from public.etapas_funil e
                 left join public.etapa_regras r on r.etapa_id = e.id
                where e.funil_id = f.id and e.tenant_id = p_tenant), '[]'::jsonb))
           order by f.ordem, f.nome)
      from public.funis f
     where f.tenant_id = p_tenant), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_regras_etapas(uuid) from public, anon;
grant execute on function public.admin_regras_etapas(uuid) to authenticated;

create function public.admin_definir_regras_etapa(
  p_tenant uuid, p_etapa uuid, p_campos jsonb, p_checklist text[], p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e      public.etapas_funil;
  v_antes  jsonb;
  v_campos jsonb := '{}'::jsonb;
  v_check  jsonb := '[]'::jsonb;
  v_chave  text;
  v_valor  text;
  v_texto  text;
  v_ids    text[] := '{}';
  v_id     text;
begin
  perform public.exigir_super_admin();
  select * into v_e from public.etapas_funil e where e.id = p_etapa and e.tenant_id = p_tenant;
  if v_e.id is null then raise exception 'Etapa não encontrada nesta empresa.' using errcode = 'P0002'; end if;
  if v_e.tipo <> 'aberta' or v_e.etapa_inicial then
    raise exception 'Exigências valem só para etapas abertas que não são a inicial (fechamento e perda têm regras próprias).'
      using errcode = '22023';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Informe o motivo da alteração.' using errcode = '22023';
  end if;
  if p_campos is not null and jsonb_typeof(p_campos) <> 'object' then
    raise exception 'Campos inválidos.' using errcode = '22023';
  end if;

  for v_chave, v_valor in select key, value #>> '{}' from jsonb_each(coalesce(p_campos, '{}'::jsonb)) loop
    if not v_chave = any (public.regras_etapa_campos()) then
      raise exception 'Campo desconhecido: %.', v_chave using errcode = '22023';
    end if;
    if v_valor is null or v_valor not in ('oculto', 'opcional', 'obrigatorio') then
      raise exception 'Uso inválido para %: escolha Não usar, Opcional ou Obrigatório.', public.regras_etapa_rotulo(v_chave)
        using errcode = '22023';
    end if;
    if v_valor <> 'opcional' then v_campos := v_campos || jsonb_build_object(v_chave, v_valor); end if;
  end loop;

  foreach v_texto in array coalesce(p_checklist, '{}') loop
    v_texto := btrim(regexp_replace(coalesce(v_texto, ''), '\s+', ' ', 'g'));
    continue when v_texto = '';
    if length(v_texto) < 3 or length(v_texto) > 200 then
      raise exception 'Cada item do checklist precisa ter de 3 a 200 caracteres.' using errcode = '22023';
    end if;
    v_id := left(md5(lower(v_texto)), 12);
    if v_id = any (v_ids) then raise exception 'Item repetido no checklist: %.', v_texto using errcode = '22023'; end if;
    v_ids := v_ids || v_id;
    v_check := v_check || jsonb_build_array(jsonb_build_object('id', v_id, 'texto', v_texto));
  end loop;
  if jsonb_array_length(v_check) > 10 then
    raise exception 'No máximo 10 itens de checklist por etapa.' using errcode = '22023';
  end if;

  select to_jsonb(r) - 'tenant_id' into v_antes from public.etapa_regras r where r.etapa_id = p_etapa;
  if v_campos = '{}'::jsonb and v_check = '[]'::jsonb then
    delete from public.etapa_regras where etapa_id = p_etapa;
  else
    insert into public.etapa_regras (etapa_id, tenant_id, campos, checklist, motivo, definido_por, definido_em)
    values (p_etapa, p_tenant, v_campos, v_check, btrim(p_motivo), (select auth.uid()), now())
    on conflict (etapa_id) do update
      set campos = excluded.campos, checklist = excluded.checklist, motivo = excluded.motivo,
          definido_por = excluded.definido_por, definido_em = excluded.definido_em;
  end if;

  perform public.registrar_auditoria('regras_etapa_definidas', p_tenant, jsonb_build_object(
    'motivo', btrim(p_motivo), 'funil_id', v_e.funil_id, 'etapa_id', v_e.id, 'etapa', v_e.nome,
    'antes', v_antes, 'depois', jsonb_build_object('campos', v_campos, 'checklist', v_check)));
end;
$$;
revoke all on function public.admin_definir_regras_etapa(uuid, uuid, jsonb, text[], text) from public, anon;
grant execute on function public.admin_definir_regras_etapa(uuid, uuid, jsonb, text[], text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Reativação: volta ao estado de antes da inativação
-- ---------------------------------------------------------------------------------------------------

-- Estado da assinatura logo antes da inativação atual (o histórico registra toda mudança de status).
-- null = sem registro (ex.: assinatura criada já suspensa).
create function public.assinatura_status_antes_inativacao(p_tenant uuid)
returns public.assinatura_status
language sql
stable
security definer
set search_path = ''
as $$
  select h.de_status
    from public.assinaturas_historico h
   where h.tenant_id = p_tenant
     and h.para_status in ('suspensa', 'cancelada')
     and (h.de_status is null or h.de_status not in ('suspensa', 'cancelada'))
   order by h.criado_em desc, h.id desc
   limit 1
$$;
revoke all on function public.assinatura_status_antes_inativacao(uuid) from public, anon, authenticated;

-- Empresa sem assinatura (status direto no tenant): o estado anterior vem da auditoria da inativação.
create function public.tenant_status_antes_inativacao(p_tenant uuid)
returns public.tenant_status
language sql
stable
security definer
set search_path = ''
as $$
  select (a.detalhes ->> 'status_anterior')::public.tenant_status
    from public.admin_auditoria a
   where a.tenant_id = p_tenant
     and a.acao in ('empresa_suspensa', 'empresa_arquivada')
     and a.detalhes ->> 'status_anterior' in ('ativo', 'teste')
   order by a.criado_em desc, a.id desc
   limit 1
$$;
revoke all on function public.tenant_status_antes_inativacao(uuid) from public, anon, authenticated;

-- Como a empresa voltaria (para a tela mostrar antes de confirmar). Mesmas regras de admin_reativar_empresa.
create function public.admin_reativacao_previa(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t   public.tenants;
  v_a   public.assinaturas;
  v_ant text;
  v_op  text[] := '{}';
begin
  perform public.exigir_super_admin();
  select * into v_t from public.tenants where id = p_tenant;
  if v_t.id is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  select * into v_a from public.assinaturas where tenant_id = p_tenant;
  if v_a.tenant_id is not null then
    v_ant := public.assinatura_status_antes_inativacao(p_tenant)::text;
    v_op := array['vencida'];
    if v_ant = 'teste' or (v_a.teste_ate is not null and v_a.teste_ate > now()) then v_op := v_op || 'teste'::text; end if;
    if v_ant = 'ativa' or (v_a.renovacao_em is not null and v_a.renovacao_em > now()) then v_op := v_op || 'ativa'::text; end if;
  else
    v_ant := case public.tenant_status_antes_inativacao(p_tenant) when 'ativo' then 'ativa' when 'teste' then 'teste' end;
    v_op := array['ativa', 'teste'];
  end if;
  return jsonb_build_object(
    'inativa', v_t.status in ('suspenso', 'cancelado'),
    'tem_assinatura', v_a.tenant_id is not null,
    'status_assinatura', v_a.status,
    'estado_anterior', v_ant,
    'opcoes', to_jsonb(v_op),
    'teste_ate', v_a.teste_ate,
    'renovacao_em', v_a.renovacao_em);
end;
$$;
revoke all on function public.admin_reativacao_previa(uuid) from public, anon;
grant execute on function public.admin_reativacao_previa(uuid) to authenticated;

drop function public.admin_reativar_empresa(uuid, text);
create function public.admin_reativar_empresa(
  p_tenant uuid, p_motivo text, p_status_assinatura public.assinatura_status default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo    public.tenant_tipo;
  v_status  public.tenant_status;
  v_ass     public.assinaturas;
  v_ant     public.assinatura_status;
  v_ant_t   public.tenant_status;
  v_novo    public.assinatura_status;
  v_novo_t  public.tenant_status;
  v_decisao text;
begin
  perform public.exigir_super_admin();
  select t.tipo, t.status into v_tipo, v_status from public.tenants t where t.id = p_tenant for update;
  if v_tipo is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_tipo <> 'assinante' then
    raise exception 'A empresa de arquivo e a empresa interna não são reativadas por aqui.' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo da reativação.' using errcode = '22023';
  end if;
  if v_status not in ('suspenso', 'cancelado') then
    raise exception 'A empresa não está inativa: nada a reativar.' using errcode = '22023';
  end if;
  if p_status_assinatura is not null and p_status_assinatura not in ('ativa', 'teste', 'vencida') then
    raise exception 'Escolha como a empresa volta: Ativa, Teste ou Vencida.' using errcode = '22023';
  end if;

  perform set_config('rx7.origem_assinatura', 'super_admin', true);
  perform set_config('rx7.motivo_assinatura', btrim(p_motivo), true);
  select * into v_ass from public.assinaturas a where a.tenant_id = p_tenant for update;

  if v_ass.tenant_id is not null then
    v_ant := public.assinatura_status_antes_inativacao(p_tenant);
    if p_status_assinatura is null then
      if v_ant is null then
        raise exception 'Não há registro de como a assinatura estava antes da inativação. Escolha explicitamente como ela volta (Vencida, Teste ou Ativa).'
          using errcode = '22023', hint = 'escolha_necessaria';
      end if;
      v_novo := v_ant;
    else
      v_novo := p_status_assinatura;
      -- A reativação nunca estende teste nem concede período pago: isso é feito em "Assinatura", com datas e motivo.
      if v_novo = 'teste' and v_ant is distinct from 'teste' and (v_ass.teste_ate is null or v_ass.teste_ate <= now()) then
        raise exception 'Sem teste em vigor: a reativação não cria nem estende teste. Para um novo teste, ajuste a assinatura (datas e motivo).'
          using errcode = '22023';
      end if;
      if v_novo = 'ativa' and v_ant is distinct from 'ativa' and (v_ass.renovacao_em is null or v_ass.renovacao_em <= now()) then
        raise exception 'Sem período pago em vigor: a reativação não concede assinatura Ativa. Para ativar ou renovar, ajuste a assinatura (plano, datas e motivo).'
          using errcode = '22023';
      end if;
    end if;
    v_decisao := case when v_novo is not distinct from v_ant then 'estado_anterior' else 'decisao_explicita' end;
    -- Só o status volta; plano, ciclo, teste_ate e renovacao_em ficam como estão.
    update public.assinaturas set status = v_novo where tenant_id = p_tenant;
  else
    v_ant_t := public.tenant_status_antes_inativacao(p_tenant);
    if p_status_assinatura is null then
      if v_ant_t is null then
        raise exception 'Não há registro de como a empresa estava antes da inativação. Escolha explicitamente como ela volta (Ativa ou Teste).'
          using errcode = '22023', hint = 'escolha_necessaria';
      end if;
      v_novo_t := v_ant_t;
    else
      if p_status_assinatura = 'vencida' then
        raise exception 'Empresa sem assinatura: escolha Ativa ou Teste.' using errcode = '22023';
      end if;
      v_novo_t := case p_status_assinatura when 'ativa' then 'ativo' else 'teste' end::public.tenant_status;
    end if;
    v_decisao := case when v_novo_t is not distinct from v_ant_t then 'estado_anterior' else 'decisao_explicita' end;
    update public.tenants set status = v_novo_t where id = p_tenant;
  end if;

  perform public.registrar_auditoria('empresa_reativada', p_tenant, jsonb_build_object(
    'motivo', btrim(p_motivo), 'status_anterior', v_status, 'decisao', v_decisao,
    'assinatura_antes', v_ass.status, 'assinatura_antes_da_inativacao', v_ant, 'assinatura_depois', v_novo,
    'empresa_antes_da_inativacao', v_ant_t, 'empresa_depois', v_novo_t,
    'escolha_informada', p_status_assinatura, 'teste_ate', v_ass.teste_ate, 'renovacao_em', v_ass.renovacao_em));
end;
$$;
revoke all on function public.admin_reativar_empresa(uuid, text, public.assinatura_status) from public, anon;
grant execute on function public.admin_reativar_empresa(uuid, text, public.assinatura_status) to authenticated, service_role;
