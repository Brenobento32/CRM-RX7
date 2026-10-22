-- ===========================================================================
-- T8 — RPCs e triggers com empresa explícita (depende da T4).
--
-- Regra: policy RESTRICTIVE não protege função SECURITY DEFINER (ela ignora
-- RLS). Toda RPC definer chamada por usuário começa com `tenant_exigir()` e
-- filtra cada leitura/gravação por `tenant_id = v_tenant`. RPCs invoker passam
-- pela RLS, mas gravam o tenant explicitamente nas tabelas-raiz.
-- Integrações sem usuário (service_role) derivam a empresa do próprio
-- registro (formulário, conversa, cliente) e nunca gravam em empresa
-- somente leitura (trigger da T4).
-- Papéis (gerente/sdr/closer) vêm de `tenant_memberships` da empresa,
-- via `papel_comercial`, não mais de `profiles.role`.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.tenant_exigir()') is null then
    raise exception 'T8 exige a T4 (tenant_exigir ausente).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Clientes e negociações
-- ---------------------------------------------------------------------------
create or replace function public.criar_cliente(
  p_tipo_cliente public.tipo_cliente, p_nome text, p_empresa text default null, p_cpf text default null,
  p_cnpj text default null, p_telefone text default null, p_whatsapp text default null,
  p_email text default null, p_responsavel text default null, p_cargo text default null,
  p_observacoes text default null, p_owner_id uuid default null, p_instagram text default null,
  p_funil_id uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant     uuid := public.tenant_exigir();
  v_cliente_id uuid;
  v_funil_id   uuid;
  v_etapa_id   uuid;
begin
  v_funil_id := coalesce(p_funil_id, (select f.id from public.funis f where f.padrao and f.tenant_id = v_tenant));
  if v_funil_id is null then
    raise exception 'Nenhum funil padrão configurado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.funis f where f.id = v_funil_id and f.ativo and f.tenant_id = v_tenant) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  select e.id into v_etapa_id
    from public.etapas_funil e
   where e.funil_id = v_funil_id and e.tenant_id = v_tenant and e.tipo = 'aberta' and e.ativo
   order by e.ordem
   limit 1;
  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.' using errcode = '23514';
  end if;

  v_cliente_id := gen_random_uuid();
  insert into public.clientes (
    id, tenant_id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
    responsavel, cargo, observacoes, owner_id, instagram
  )
  values (
    v_cliente_id, v_tenant, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone,
    p_whatsapp, p_email, p_responsavel, p_cargo, p_observacoes,
    coalesce(p_owner_id, (select auth.uid())), p_instagram
  );

  insert into public.negociacoes (cliente_id, owner_id, etapa_id, origem)
  values (v_cliente_id, coalesce(p_owner_id, (select auth.uid())), v_etapa_id, 'manual');

  return v_cliente_id;
end;
$$;

create or replace function public.criar_negociacao(
  p_cliente_id uuid, p_funil_id uuid, p_valor_estimado numeric default null,
  p_temperatura public.temperatura_negociacao default null,
  p_origem public.origem_negociacao default 'manual')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_tenant        uuid;
  v_tenant_cli    uuid;
  v_negociacao_id uuid;
  v_etapa_id      uuid;
begin
  select c.tenant_id into v_tenant_cli
    from public.clientes c
   where c.id = p_cliente_id and c.deleted_at is null;

  if v_uid is not null then
    v_tenant := public.tenant_exigir();
  else
    v_tenant := v_tenant_cli;  -- integração: empresa do próprio cliente
  end if;

  if v_tenant_cli is null or v_tenant_cli <> v_tenant then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.funis f where f.id = p_funil_id and f.ativo and f.tenant_id = v_tenant) then
    raise exception 'Funil não encontrado ou desativado.' using errcode = 'P0002';
  end if;

  select e.id into v_etapa_id
    from public.etapas_funil e
   where e.funil_id = p_funil_id and e.tenant_id = v_tenant and e.tipo = 'aberta' and e.ativo
   order by e.ordem
   limit 1;
  if v_etapa_id is null then
    raise exception 'O funil não tem etapa aberta disponível para receber a negociação.' using errcode = '23514';
  end if;

  if v_uid is not null
     and not public.is_gerente()
     and not public.pode_mover_etapa(p_funil_id, v_etapa_id)
  then
    raise exception 'Você não tem permissão para criar uma negociação para esse cliente.' using errcode = '42501';
  end if;

  v_negociacao_id := gen_random_uuid();
  insert into public.negociacoes (id, tenant_id, cliente_id, owner_id, etapa_id, valor_estimado, temperatura, origem)
  values (v_negociacao_id, v_tenant, p_cliente_id, v_uid, v_etapa_id, p_valor_estimado, p_temperatura, p_origem);

  return v_negociacao_id;
end;
$$;

create or replace function public.criar_ou_reaproveitar_cliente(
  p_tipo_cliente public.tipo_cliente, p_nome text, p_empresa text default null, p_cpf text default null,
  p_cnpj text default null, p_telefone text default null, p_whatsapp text default null,
  p_email text default null, p_responsavel text default null, p_cargo text default null,
  p_observacoes text default null, p_owner_id uuid default null, p_instagram text default null,
  p_funil_id uuid default null)
returns table (cliente_id uuid, negociacao_id uuid, reaproveitado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant        uuid := public.tenant_exigir();
  v_funil_id      uuid;
  v_candidatos    uuid[];
  v_qtd           int;
  v_cliente_id    uuid;
  v_reaproveitado boolean;
begin
  if not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Você não tem permissão para gravar nesta empresa.' using errcode = '42501';
  end if;

  v_funil_id := coalesce(p_funil_id, (select f.id from public.funis f where f.padrao and f.tenant_id = v_tenant));
  if v_funil_id is null then
    raise exception 'Nenhum funil padrão configurado.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_tenant::text || '|' ||
    lower(coalesce(p_telefone, '') || '|' || coalesce(p_whatsapp, '') || '|' || coalesce(p_email, '')))::bigint);

  -- Dedup só dentro da empresa da requisição (nunca entre empresas).
  select array_agg(distinct c.id) into v_candidatos
    from public.clientes c
   where c.tenant_id = v_tenant
     and c.deleted_at is null
     and (
       (p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
       or (p_whatsapp is not null and (c.telefone = p_whatsapp or c.whatsapp = p_whatsapp))
       or (p_email is not null and lower(c.email) = lower(p_email))
     );
  v_qtd := coalesce(array_length(v_candidatos, 1), 0);

  if v_qtd > 1 then
    raise exception 'Encontramos mais de um cadastro compatível.' using errcode = 'P0003';
  end if;

  if v_qtd = 1 then
    v_cliente_id := v_candidatos[1];
    v_reaproveitado := true;
  else
    v_reaproveitado := false;
    v_cliente_id := gen_random_uuid();
    insert into public.clientes (
      id, tenant_id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
      responsavel, cargo, observacoes, owner_id, instagram
    )
    values (
      v_cliente_id, v_tenant, p_tipo_cliente, p_nome, p_empresa, p_cpf, p_cnpj, p_telefone,
      p_whatsapp, p_email, p_responsavel, p_cargo, p_observacoes,
      coalesce(p_owner_id, (select auth.uid())), p_instagram
    );
  end if;

  cliente_id := v_cliente_id;
  negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'manual');
  reaproveitado := v_reaproveitado;
  return next;
end;
$$;

create or replace function public.mover_negociacao(p_negociacao_id uuid, p_etapa_id uuid, p_posicao numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant           uuid := public.tenant_exigir();
  v_funil_id         uuid;
  v_etapa_atual_id   uuid;
  v_destino_funil_id uuid;
  v_destino_tipo     public.tipo_etapa;
  v_destino_ativo    boolean;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_atual_id
    from public.negociacoes n
   where n.id = p_negociacao_id and n.tenant_id = v_tenant;
  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;

  select e.funil_id, e.tipo, e.ativo into v_destino_funil_id, v_destino_tipo, v_destino_ativo
    from public.etapas_funil e
   where e.id = p_etapa_id and e.tenant_id = v_tenant;
  if v_destino_funil_id is null or not v_destino_ativo then
    raise exception 'Etapa não encontrada ou desativada.' using errcode = '23514';
  end if;
  if v_destino_funil_id <> v_funil_id then
    raise exception 'Não é possível mover uma negociação para outro funil.' using errcode = '23514';
  end if;
  if v_destino_tipo in ('ganha', 'perdida') and p_etapa_id <> v_etapa_atual_id then
    raise exception 'Use o fechamento ou o motivo de perda para entrar nesta etapa.' using errcode = '23514';
  end if;

  if public.papel_comercial((select auth.uid()), v_tenant) is distinct from 'gerente'
     and not (public.pode_mover_etapa(v_funil_id, v_etapa_atual_id)
              and public.pode_mover_etapa(v_funil_id, p_etapa_id))
  then
    raise exception 'Você não tem permissão para mover esta negociação.' using errcode = '42501';
  end if;

  update public.negociacoes
     set etapa_id = p_etapa_id, posicao = p_posicao
   where id = p_negociacao_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.desqualificar_negociacao(p_negociacao_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := public.tenant_exigir();
  v_funil_id uuid;
  v_etapa_id uuid;
  v_motivo   text := btrim(p_motivo);
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_id
    from public.negociacoes n
   where n.id = p_negociacao_id and n.tenant_id = v_tenant and n.arquivada_em is null
     for update;
  if v_funil_id is null then
    raise exception 'Lead não encontrado ou já está arquivado.' using errcode = 'P0002';
  end if;
  if not public.is_gerente() and not public.pode_ver_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para esta operação.' using errcode = '42501';
  end if;
  if v_motivo is null or v_motivo = '' then
    raise exception 'Informe o motivo da desqualificação.' using errcode = '23514';
  end if;

  update public.negociacoes
     set arquivada_em = now(), motivo_arquivamento = v_motivo
   where id = p_negociacao_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.anular_fechamento(p_negociacao_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant     uuid := public.tenant_exigir();
  v_uid        uuid := (select auth.uid());
  v_motivo     text := btrim(p_motivo);
  v_existe     boolean;
  v_ja_anulado boolean;
begin
  if not public.is_gerente() then
    raise exception 'Somente gerentes podem anular um fechamento.' using errcode = '42501';
  end if;

  select true, f.anulado_em is not null into v_existe, v_ja_anulado
    from public.fechamentos f
   where f.negociacao_id = p_negociacao_id and f.tenant_id = v_tenant;
  if v_existe is null then
    raise exception 'Fechamento não encontrado para esta negociação.' using errcode = 'P0002';
  end if;
  if v_ja_anulado then
    raise exception 'Este fechamento já está anulado.' using errcode = '23514';
  end if;
  if v_motivo is null or v_motivo = '' then
    raise exception 'Informe o motivo da anulação.' using errcode = '23514';
  end if;

  update public.fechamentos
     set anulado_em = now(), motivo_anulacao = v_motivo, anulado_por = v_uid
   where negociacao_id = p_negociacao_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.atualizar_dados_operacionais_negociacao(
  p_negociacao_id uuid, p_nicho_id uuid, p_temperatura public.temperatura_negociacao,
  p_valor_estimado numeric, p_data_primeira_reuniao date, p_data_proposta date,
  p_objecao_principal text, p_valor_proposta numeric, p_forma_pagamento public.forma_pagamento)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := public.tenant_exigir();
  v_funil_id uuid;
  v_etapa_id uuid;
begin
  select n.funil_id, n.etapa_id into v_funil_id, v_etapa_id
    from public.negociacoes n
   where n.id = p_negociacao_id and n.tenant_id = v_tenant
     for update;
  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;
  if public.etapa_tipo(v_etapa_id) <> 'aberta' then
    raise exception 'Negociação encerrada: dados comerciais não podem ser alterados.' using errcode = '23514';
  end if;
  if not public.is_gerente() and not public.pode_mover_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para editar esta negociação.' using errcode = '42501';
  end if;
  if p_nicho_id is not null
     and not exists (select 1 from public.nichos ni where ni.id = p_nicho_id and ni.tenant_id = v_tenant) then
    raise exception 'Nicho não encontrado.' using errcode = 'P0002';
  end if;

  update public.negociacoes
     set nicho_id = p_nicho_id, temperatura = p_temperatura, valor_estimado = p_valor_estimado,
         data_primeira_reuniao = p_data_primeira_reuniao, data_proposta = p_data_proposta,
         objecao_principal = p_objecao_principal, valor_proposta = p_valor_proposta,
         forma_pagamento = p_forma_pagamento
   where id = p_negociacao_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.atualizar_cliente_do_card(
  p_cliente_id uuid, p_negociacao_id uuid, p_tipo_cliente public.tipo_cliente, p_nome text,
  p_empresa text, p_cpf text, p_cnpj text, p_telefone text, p_whatsapp text, p_email text,
  p_responsavel text, p_cargo text, p_instagram text, p_observacoes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant         uuid := public.tenant_exigir();
  v_funil_id       uuid;
  v_etapa_id       uuid;
  v_cliente_da_neg uuid;
begin
  select n.funil_id, n.etapa_id, n.cliente_id into v_funil_id, v_etapa_id, v_cliente_da_neg
    from public.negociacoes n
   where n.id = p_negociacao_id and n.tenant_id = v_tenant;
  if v_funil_id is null then
    raise exception 'Negociação não encontrada.' using errcode = 'P0002';
  end if;
  if v_cliente_da_neg <> p_cliente_id then
    raise exception 'Esta negociação não pertence ao cliente informado.' using errcode = '23514';
  end if;
  if not public.is_gerente() and not public.pode_mover_etapa(v_funil_id, v_etapa_id) then
    raise exception 'Você não tem permissão para editar este cliente.' using errcode = '42501';
  end if;

  update public.clientes
     set tipo_cliente = p_tipo_cliente, nome = p_nome, empresa = p_empresa, cpf = p_cpf,
         cnpj = p_cnpj, telefone = p_telefone, whatsapp = p_whatsapp, email = p_email,
         responsavel = p_responsavel, cargo = p_cargo, instagram = p_instagram,
         observacoes = p_observacoes
   where id = p_cliente_id and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funis
-- ---------------------------------------------------------------------------
create or replace function public.criar_funil(
  p_nome text, p_etapa_ganha_nome text, p_etapa_ganha_cor public.cor_etapa,
  p_etapa_perdida_nome text, p_etapa_perdida_cor public.cor_etapa,
  p_etapas_abertas jsonb default '[]'::jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant   uuid := public.tenant_exigir();
  v_funil_id uuid := gen_random_uuid();
  v_ordem    numeric := 1000;
  v_item     jsonb;
begin
  insert into public.funis (id, tenant_id, nome, padrao) values (v_funil_id, v_tenant, p_nome, false);

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
  values (v_funil_id, p_etapa_ganha_nome, p_etapa_ganha_cor, 100000, 'ganha', true);
  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
  values (v_funil_id, p_etapa_perdida_nome, p_etapa_perdida_cor, 100001, 'perdida', false);

  for v_item in select * from jsonb_array_elements(coalesce(p_etapas_abertas, '[]'::jsonb)) loop
    insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, participa_conversao)
    values (v_funil_id, v_item ->> 'nome', (v_item ->> 'cor')::public.cor_etapa, v_ordem, 'aberta', true);
    v_ordem := v_ordem + 1000;
  end loop;

  return v_funil_id;
end;
$$;

create or replace function public.duplicar_funil(p_funil_id uuid, p_novo_nome text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant  uuid := public.tenant_exigir();
  v_novo_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.funis where id = p_funil_id and tenant_id = v_tenant) then
    raise exception 'Funil não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.funis (id, tenant_id, nome, padrao) values (v_novo_id, v_tenant, p_novo_nome, false);

  insert into public.etapas_funil (funil_id, nome, cor, ordem, tipo, pos_fechamento, participa_conversao)
  select v_novo_id, e.nome, e.cor, e.ordem, e.tipo, e.pos_fechamento, e.participa_conversao
    from public.etapas_funil e
   where e.funil_id = p_funil_id and e.tenant_id = v_tenant
   order by e.ordem;

  return v_novo_id;
end;
$$;

create or replace function public.etapa_id_por_chave(p_chave text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select e.id from public.etapas_funil e where e.chave = p_chave and e.tenant_id = public.tenant_atual();
$$;

-- ---------------------------------------------------------------------------
-- Metas e resultados (agregados só da empresa da requisição)
-- ---------------------------------------------------------------------------
create or replace function public.salvar_metas_funis(p_mes date, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant     uuid := public.tenant_exigir();
  v_mes        date;
  v_item       jsonb;
  v_funil_id   uuid;
  v_tipo_meta  text;
  v_valor_meta numeric;
  v_salvos     integer := 0;
  v_vistos     text[] := '{}';
  v_chave      text;
begin
  if not public.is_gerente() or not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Somente gerentes podem definir metas por funil.' using errcode = '42501';
  end if;
  if p_mes is null then
    raise exception 'Informe o mês.' using errcode = '23514';
  end if;
  v_mes := date_trunc('month', p_mes)::date;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Lista de metas inválida.' using errcode = '23514';
  end if;
  if jsonb_array_length(p_itens) = 0 then
    raise exception 'Nenhuma meta para salvar.' using errcode = '23514';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    if not (v_item ? 'funil_id') or not (v_item ? 'tipo_meta') or not (v_item ? 'valor_meta') then
      raise exception 'Item de meta incompleto (funil_id/tipo_meta/valor_meta obrigatórios).' using errcode = '23514';
    end if;
    begin
      v_funil_id := (v_item ->> 'funil_id')::uuid;
    exception when others then
      raise exception 'funil_id inválido: %', v_item ->> 'funil_id' using errcode = '23514';
    end;
    v_tipo_meta := v_item ->> 'tipo_meta';
    if v_tipo_meta not in ('tcv', 'mrr') then
      raise exception 'tipo_meta deve ser "tcv" ou "mrr" (veio %).', coalesce(v_tipo_meta, 'null') using errcode = '23514';
    end if;
    begin
      v_valor_meta := (v_item ->> 'valor_meta')::numeric;
    exception when others then
      raise exception 'valor_meta inválido para o funil % (%): %', v_funil_id, v_tipo_meta, v_item ->> 'valor_meta'
        using errcode = '23514';
    end;
    if v_valor_meta is null or v_valor_meta <= 0 then
      raise exception 'valor_meta deve ser maior que zero (funil %, %).', v_funil_id, v_tipo_meta using errcode = '23514';
    end if;
    if not exists (select 1 from public.funis f where f.id = v_funil_id and f.ativo and f.tenant_id = v_tenant) then
      raise exception 'Funil % não existe ou não está ativo.', v_funil_id using errcode = '23514';
    end if;
    v_chave := v_funil_id::text || ':' || v_tipo_meta;
    if v_chave = any (v_vistos) then
      raise exception 'Funil % duplicado para o tipo % no mesmo envio.', v_funil_id, v_tipo_meta using errcode = '23514';
    end if;
    v_vistos := array_append(v_vistos, v_chave);
  end loop;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    insert into public.metas (tenant_id, usuario_id, funil_id, periodo_mes, tipo_meta, valor_meta)
    values (v_tenant, null, (v_item ->> 'funil_id')::uuid, v_mes,
            (v_item ->> 'tipo_meta')::public.tipo_venda, (v_item ->> 'valor_meta')::numeric)
    on conflict (tenant_id, usuario_id, funil_id, periodo_mes, tipo_meta)
    do update set valor_meta = excluded.valor_meta;
    v_salvos := v_salvos + 1;
  end loop;

  return v_salvos;
end;
$$;

create or replace function public.metas_funis_progresso(p_mes date)
returns table (funil_id uuid, funil_nome text, meta_id_tcv uuid, valor_meta_tcv numeric, realizado_tcv numeric,
               meta_id_mrr uuid, valor_meta_mrr numeric, realizado_mrr numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with
  ctx as (select public.tenant_atual() as t),
  mes as (select date_trunc('month', p_mes)::date as inicio),
  vendas as (
    select n.funil_id, f.tipo_venda, sum(f.valor_vendido) as valor
      from public.fechamentos f
      join public.negociacoes n  on n.id = f.negociacao_id and n.tenant_id = f.tenant_id
      join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
      cross join mes cross join ctx
     where f.tenant_id = ctx.t
       and f.data_fechamento >= mes.inicio
       and f.data_fechamento <  (mes.inicio + interval '1 month')::date
       and f.tipo_venda is not null
       and f.anulado_em is null
     group by n.funil_id, f.tipo_venda
  ),
  vendas_tcv as (select v.funil_id, v.valor from vendas v where v.tipo_venda = 'tcv'),
  vendas_mrr as (select v.funil_id, v.valor from vendas v where v.tipo_venda = 'mrr')
  select fu.id, fu.nome, mt.id, mt.valor_meta, coalesce(vt.valor, 0), mm.id, mm.valor_meta, coalesce(vm.valor, 0)
    from public.funis fu
    cross join mes cross join ctx
    left join public.metas mt
      on mt.tenant_id = ctx.t and mt.funil_id = fu.id and mt.usuario_id is null
     and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
    left join public.metas mm
      on mm.tenant_id = ctx.t and mm.funil_id = fu.id and mm.usuario_id is null
     and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
    left join vendas_tcv vt on vt.funil_id = fu.id
    left join vendas_mrr vm on vm.funil_id = fu.id
   where fu.tenant_id = ctx.t and fu.ativo
   order by fu.ordem;
$$;

create or replace function public.metas_progresso(p_mes date)
returns table (meta_id_tcv uuid, meta_id_mrr uuid, usuario_id uuid, nome text, role public.user_role, ativo boolean,
               valor_meta_tcv numeric, realizado_tcv numeric, qtd_tcv bigint,
               valor_meta_mrr numeric, realizado_mrr numeric, qtd_mrr bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with
  ctx as (select public.tenant_atual() as t),
  mes as (select date_trunc('month', p_mes)::date as inicio),
  membros as (
    select p.id, p.nome, (p.ativo and m.ativo) as ativo,
           (case m.papel when 'sdr' then 'sdr' when 'closer' then 'closer' else 'gerente' end)::public.user_role as role
      from public.tenant_memberships m
      join public.profiles p on p.id = m.user_id
      cross join ctx
     where m.tenant_id = ctx.t
  ),
  vendas as (
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor, count(*) as qtd
      from public.fechamentos f
      join public.negociacoes n  on n.id = f.negociacao_id and n.tenant_id = f.tenant_id
      join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
      cross join mes cross join ctx
     where f.tenant_id = ctx.t
       and f.data_fechamento >= mes.inicio
       and f.data_fechamento <  (mes.inicio + interval '1 month')::date
       and f.tipo_venda is not null
       and f.anulado_em is null
     group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select v.usuario_id, v.valor, v.qtd from vendas v where v.tipo_venda = 'tcv'),
  vendas_mrr as (select v.usuario_id, v.valor, v.qtd from vendas v where v.tipo_venda = 'mrr')
  select mt.id, mm.id, null::uuid, null::text, null::public.user_role, null::boolean,
         mt.valor_meta,
         (select coalesce(sum(v.valor), 0) from vendas_tcv v),
         (select coalesce(sum(v.qtd), 0) from vendas_tcv v),
         mm.valor_meta,
         (select coalesce(sum(v.valor), 0) from vendas_mrr v),
         (select coalesce(sum(v.qtd), 0) from vendas_mrr v)
    from mes cross join ctx
    left join public.metas mt
      on mt.tenant_id = ctx.t and mt.usuario_id is null and mt.funil_id is null
     and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
    left join public.metas mm
      on mm.tenant_id = ctx.t and mm.usuario_id is null and mm.funil_id is null
     and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
   where ctx.t is not null
  union all
  select mt.id, mm.id, p.id, p.nome, p.role, p.ativo,
         mt.valor_meta, coalesce(vt.valor, 0), coalesce(vt.qtd, 0),
         mm.valor_meta, coalesce(vm.valor, 0), coalesce(vm.qtd, 0)
    from membros p
    cross join mes cross join ctx
    left join public.metas mt
      on mt.tenant_id = ctx.t and mt.usuario_id = p.id and mt.funil_id is null
     and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
    left join public.metas mm
      on mm.tenant_id = ctx.t and mm.usuario_id = p.id and mm.funil_id is null
     and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
    left join vendas_tcv vt on vt.usuario_id = p.id
    left join vendas_mrr vm on vm.usuario_id = p.id
   where (public.is_gerente() or (p.id = (select auth.uid()) and p.role = 'closer'))
     and ((p.role = 'closer' and p.ativo) or mt.id is not null or mm.id is not null
          or vt.valor is not null or vm.valor is not null);
$$;

create or replace function public.realizado_periodo(p_inicio date, p_fim date)
returns table (usuario_id uuid, nome text, role public.user_role, ativo boolean, realizado_tcv numeric, realizado_mrr numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with
  ctx as (select public.tenant_atual() as t),
  membros as (
    select p.id, p.nome, (p.ativo and m.ativo) as ativo,
           (case m.papel when 'sdr' then 'sdr' when 'closer' then 'closer' else 'gerente' end)::public.user_role as role
      from public.tenant_memberships m
      join public.profiles p on p.id = m.user_id
      cross join ctx
     where m.tenant_id = ctx.t
  ),
  vendas as (
    select f.responsavel_id as usuario_id, f.tipo_venda, sum(f.valor_vendido) as valor
      from public.fechamentos f
      join public.negociacoes n  on n.id = f.negociacao_id and n.tenant_id = f.tenant_id
      join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
      cross join ctx
     where f.tenant_id = ctx.t
       and f.data_fechamento >= p_inicio
       and f.data_fechamento <= p_fim
       and f.tipo_venda is not null
       and f.anulado_em is null
     group by f.responsavel_id, f.tipo_venda
  ),
  vendas_tcv as (select v.usuario_id, v.valor from vendas v where v.tipo_venda = 'tcv'),
  vendas_mrr as (select v.usuario_id, v.valor from vendas v where v.tipo_venda = 'mrr')
  select null::uuid, null::text, null::public.user_role, null::boolean,
         (select coalesce(sum(v.valor), 0) from vendas_tcv v),
         (select coalesce(sum(v.valor), 0) from vendas_mrr v)
    from ctx
   where ctx.t is not null
  union all
  select p.id, p.nome, p.role, p.ativo, coalesce(vt.valor, 0), coalesce(vm.valor, 0)
    from membros p
    left join vendas_tcv vt on vt.usuario_id = p.id
    left join vendas_mrr vm on vm.usuario_id = p.id
   where (public.is_gerente() or (p.id = (select auth.uid()) and p.role = 'closer'))
     and ((p.role = 'closer' and p.ativo) or vt.valor is not null or vm.valor is not null);
$$;

-- Painel por usuário (invoker; a RLS já limita à empresa). O papel exibido é o
-- da empresa, não mais o global.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.dashboard_por_usuario(date, date)'::regprocedure);
  v_def := regexp_replace(v_def, '\mp\.role\M', 'public.papel_comercial(p.id, public.tenant_atual())', 'g');
  if v_def like '%p.role%' then
    raise exception 'T8 abortada: dashboard_por_usuario ainda lê profiles.role.';
  end if;
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: papel do usuário na empresa do registro
-- ---------------------------------------------------------------------------
create or replace function public.agenda_valida_responsavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.papel_comercial(new.usuario_id, new.tenant_id);
begin
  if v_role is null then
    raise exception 'O responsável precisa ser um usuário ativo desta empresa.' using errcode = '23514';
  end if;
  if v_role <> 'gerente'
     and (select c.owner_id from public.clientes c
           where c.id = new.cliente_id and c.tenant_id = new.tenant_id) is distinct from new.usuario_id
  then
    raise exception 'O responsável precisa ter acesso ao cliente (dono da carteira ou gerente).' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.permissoes_colaborador_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_da_etapa uuid;
  v_role public.user_role;
begin
  if new.etapa_id is not null then
    select e.funil_id into v_funil_da_etapa from public.etapas_funil e where e.id = new.etapa_id;
    if v_funil_da_etapa is null then
      raise exception 'Etapa não encontrada.' using errcode = '23514';
    end if;
    if v_funil_da_etapa <> new.funil_id then
      raise exception 'A etapa informada não pertence ao funil desta permissão.' using errcode = '23514';
    end if;
  end if;

  v_role := public.papel_comercial(new.usuario_id, new.tenant_id);
  if v_role is null then
    raise exception 'O colaborador não pertence a esta empresa.' using errcode = '23514';
  end if;
  if v_role = 'gerente' then
    raise exception 'Gerente já tem acesso total — não é possível configurar permissões para um gerente.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.metas_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.funil_id is not null and new.usuario_id is not null then
    raise exception 'Meta por funil é sempre da empresa (usuário deve ser nulo).' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.usuario_id is not null
       and public.papel_comercial(new.usuario_id, new.tenant_id) is distinct from 'closer' then
      raise exception 'Metas individuais são apenas para closers.' using errcode = '23514';
    end if;
  elsif new.usuario_id is distinct from old.usuario_id
     or new.funil_id is distinct from old.funil_id
     or new.periodo_mes <> old.periodo_mes
     or new.tipo_meta is distinct from old.tipo_meta
     or new.criado_por <> old.criado_por
  then
    raise exception 'Só o valor de uma meta pode ser alterado.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Handoff SDR → CLOSER: teto absoluto, agora pelo papel na empresa do lead.
create or replace function public.negociacoes_valida_handoff_sdr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funil_id      uuid;
  v_ordem_destino numeric;
  v_limite_ordem  numeric;
  v_ordem_atual   numeric;
begin
  if public.papel_comercial((select auth.uid()), new.tenant_id) is distinct from 'sdr' then
    return new;
  end if;

  select funil_id, ordem into v_funil_id, v_ordem_destino
    from public.etapas_funil where id = new.etapa_id;

  select ordem into v_limite_ordem
    from public.etapas_funil
   where funil_id = v_funil_id and chave = 'reuniao_realizada';

  if v_limite_ordem is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select ordem into v_ordem_atual from public.etapas_funil where id = old.etapa_id;
    if v_ordem_atual is not null and v_ordem_atual >= v_limite_ordem then
      raise exception 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
        using errcode = '42501';
    end if;
  end if;

  if v_ordem_destino > v_limite_ordem then
    raise exception 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Integrações (service_role): empresa vem do próprio registro
-- ---------------------------------------------------------------------------
create or replace function public.criar_cliente_whatsapp(p_telefone text, p_nome text, p_conversa_id uuid)
returns table (cliente_id uuid, negociacao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa              public.conversas%rowtype;
  v_funil_id              uuid;
  v_responsavel_padrao_id uuid;
  v_cliente_id            uuid;
  v_negociacao_id         uuid;
begin
  select * into v_conversa from public.conversas where id = p_conversa_id for update;
  if v_conversa.id is null then
    raise exception 'Conversa % não encontrada.', p_conversa_id using errcode = 'P0002';
  end if;
  if v_conversa.telefone <> p_telefone then
    raise exception 'Telefone informado não corresponde à conversa %.', p_conversa_id using errcode = '22023';
  end if;

  if v_conversa.cliente_id is not null then
    select n.id into v_negociacao_id
      from public.negociacoes n
     where n.cliente_id = v_conversa.cliente_id and n.tenant_id = v_conversa.tenant_id
     order by n.created_at
     limit 1;
    return query select v_conversa.cliente_id, v_negociacao_id;
    return;
  end if;

  select c.funil_id, c.responsavel_padrao_id into v_funil_id, v_responsavel_padrao_id
    from public.whatsapp_conexoes c
   where c.id = '00000000-0000-0000-0000-000000000001' and c.tenant_id = v_conversa.tenant_id;
  if v_funil_id is null or v_responsavel_padrao_id is null then
    raise exception 'Configuração do WhatsApp (funil/responsável padrão) não encontrada.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.funis f
                  where f.id = v_funil_id and f.tenant_id = v_conversa.tenant_id and f.ativo and f.whatsapp_habilitado) then
    raise exception 'Funil % não está ativo ou não tem WhatsApp habilitado.', v_funil_id using errcode = '23514';
  end if;

  insert into public.clientes (tenant_id, tipo_cliente, nome, telefone, whatsapp, owner_id)
  values (v_conversa.tenant_id, 'pessoa_fisica', p_nome, p_telefone, p_telefone, v_responsavel_padrao_id)
  returning id into v_cliente_id;

  v_negociacao_id := public.criar_negociacao(v_cliente_id, v_funil_id, null, null, 'whatsapp');

  update public.conversas set cliente_id = v_cliente_id where id = p_conversa_id;

  return query select v_cliente_id, v_negociacao_id;
end;
$$;

create or replace function public.ingerir_lead_formulario(
  p_external_id text, p_formulario_slug text, p_nicho_slug text, p_nome text,
  p_telefone text default null, p_email text default null, p_empresa text default null,
  p_instagram text default null, p_respostas jsonb default '[]'::jsonb, p_atribuicao jsonb default null)
returns table (cliente_id uuid, negociacao_id uuid, criado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_forms          uuid[];
  v_tenant         uuid;
  v_formulario_id  uuid;
  v_nicho_id       uuid;
  v_funil_id       uuid;
  v_responsavel_id uuid;
  v_etapa_id       uuid;
  v_cliente_id     uuid;
  v_negociacao_id  uuid;
  v_criado         boolean := false;
  v_item           jsonb;
  v_pergunta_id    uuid;
  v_resposta       text;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id é obrigatório.' using errcode = '22023';
  end if;
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Nome é obrigatório.' using errcode = '22023';
  end if;
  if p_telefone is null and p_email is null then
    raise exception 'Informe ao menos telefone ou e-mail.' using errcode = '22023';
  end if;
  if p_atribuicao is not null and jsonb_typeof(p_atribuicao) <> 'object' then
    raise exception 'atribuicao precisa ser um objeto JSON.' using errcode = '22023';
  end if;

  -- A empresa é a do formulário. Slug repetido em duas empresas é recusado
  -- (a credencial por empresa resolve isso no próximo bloco).
  select array_agg(f.id) into v_forms
    from public.formularios f
   where f.slug = p_formulario_slug and f.ativo;
  if coalesce(array_length(v_forms, 1), 0) = 0 then
    raise exception 'Formulário "%" não encontrado ou desativado.', p_formulario_slug using errcode = 'P0002';
  end if;
  if array_length(v_forms, 1) > 1 then
    raise exception 'Formulário "%" existe em mais de uma empresa.', p_formulario_slug using errcode = 'P0003';
  end if;
  v_formulario_id := v_forms[1];
  select f.tenant_id into v_tenant from public.formularios f where f.id = v_formulario_id;

  if exists (select 1 from public.tenants t where t.id = v_tenant and t.somente_leitura) then
    raise exception 'A empresa deste formulário está somente leitura.' using errcode = '42501';
  end if;

  select n.id into v_nicho_id
    from public.nichos n
   where n.slug = p_nicho_slug and n.ativo and n.tenant_id = v_tenant;
  if v_nicho_id is null then
    raise exception 'Nicho "%" não encontrado ou desativado.', p_nicho_slug using errcode = 'P0002';
  end if;

  select n.cliente_id, n.id into v_cliente_id, v_negociacao_id
    from public.negociacoes n
   where n.tenant_id = v_tenant and n.origem = 'formulario' and n.external_id = p_external_id
     for update;

  if v_negociacao_id is not null then
    update public.clientes
       set nome = p_nome, empresa = coalesce(p_empresa, empresa), telefone = coalesce(p_telefone, telefone),
           email = coalesce(p_email, email), instagram = coalesce(p_instagram, instagram)
     where id = v_cliente_id and tenant_id = v_tenant and deleted_at is null;
    update public.negociacoes
       set atribuicao = coalesce(p_atribuicao, atribuicao)
     where id = v_negociacao_id and tenant_id = v_tenant;
  else
    select c.id into v_cliente_id
      from public.clientes c
     where c.tenant_id = v_tenant
       and c.deleted_at is null
       and ((p_telefone is not null and (c.telefone = p_telefone or c.whatsapp = p_telefone))
            or (p_email is not null and lower(c.email) = lower(p_email)))
     order by c.created_at
     limit 1
     for update;

    if v_cliente_id is null then
      select c.funil_id, c.responsavel_padrao_id into v_funil_id, v_responsavel_id
        from public.whatsapp_conexoes c
       where c.id = '00000000-0000-0000-0000-000000000001' and c.tenant_id = v_tenant;
      if v_funil_id is null or v_responsavel_id is null then
        raise exception 'Configuração de responsável/funil padrão para leads automáticos não encontrada.'
          using errcode = 'P0002';
      end if;
      insert into public.clientes (tenant_id, tipo_cliente, nome, empresa, telefone, email, instagram, owner_id)
      values (v_tenant, 'pessoa_fisica', p_nome, p_empresa, p_telefone, p_email, p_instagram, v_responsavel_id)
      returning id into v_cliente_id;
    else
      select n.funil_id into v_funil_id
        from public.negociacoes n
       where n.cliente_id = v_cliente_id and n.tenant_id = v_tenant
       order by n.created_at
       limit 1;
      if v_funil_id is null then
        select c.funil_id into v_funil_id
          from public.whatsapp_conexoes c
         where c.id = '00000000-0000-0000-0000-000000000001' and c.tenant_id = v_tenant;
      end if;
    end if;

    select e.id into v_etapa_id
      from public.etapas_funil e
     where e.funil_id = v_funil_id and e.tenant_id = v_tenant and e.etapa_inicial and e.ativo
     limit 1;
    if v_etapa_id is null then
      raise exception 'O funil % não tem etapa inicial configurada (ou ela está desativada).', v_funil_id
        using errcode = 'P0002';
    end if;

    insert into public.negociacoes (tenant_id, cliente_id, owner_id, etapa_id, origem, nicho_id, formulario_id, external_id, atribuicao)
    values (v_tenant, v_cliente_id, (select auth.uid()), v_etapa_id, 'formulario', v_nicho_id, v_formulario_id,
            p_external_id, p_atribuicao)
    returning id into v_negociacao_id;
    v_criado := true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) loop
    select p.id into v_pergunta_id
      from public.perguntas p
     where p.formulario_id = v_formulario_id and p.tenant_id = v_tenant and p.ativo
       and btrim(p.texto) = btrim(v_item ->> 'pergunta_externa');
    continue when v_pergunta_id is null;
    v_resposta := v_item ->> 'resposta';
    continue when v_resposta is null or btrim(v_resposta) = '';

    insert into public.respostas_lead (negociacao_id, pergunta_id, resposta_texto, resposta_opcao)
    select v_negociacao_id, v_pergunta_id,
           case when p.tipo = 'texto_livre' then v_resposta end,
           case when p.tipo <> 'texto_livre' then v_resposta end
      from public.perguntas p
     where p.id = v_pergunta_id
    on conflict (negociacao_id, pergunta_id) do update
      set resposta_texto = excluded.resposta_texto, resposta_opcao = excluded.resposta_opcao;
  end loop;

  return query select v_cliente_id, v_negociacao_id, v_criado;
end;
$$;

-- ---------------------------------------------------------------------------
-- Papéis da empresa para as telas (substitui a leitura de profiles.role)
-- ---------------------------------------------------------------------------
-- Membros da empresa da requisição com o papel comercial. Qualquer membro
-- ativo pode ler (é o que as telas já mostravam do perfil); fora da empresa,
-- vazio.
create function public.membros_empresa_atual()
returns table (usuario_id uuid, papel public.tenant_papel, role public.user_role, ativo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id,
         m.papel,
         (case m.papel when 'sdr' then 'sdr' when 'closer' then 'closer' else 'gerente' end)::public.user_role,
         (m.ativo and p.ativo)
    from public.tenant_memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = public.tenant_atual();
$$;

revoke all on function public.membros_empresa_atual() from public, anon;
grant execute on function public.membros_empresa_atual() to authenticated;

-- Os privilégios de execução das funções recriadas com CREATE OR REPLACE são
-- mantidos (mesma assinatura). As novas helpers da T4 já têm os seus.
