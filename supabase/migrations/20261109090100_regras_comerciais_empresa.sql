-- ===========================================================================
-- Regras comerciais por empresa (Super Admin configura; a empresa usa).
--
--  1. empresa_regras_comerciais: menu Metas ligado/desligado, tipos de venda e
--     de meta liberados (TCV, MRR, Venda comum) e o que o fechamento pede
--     (contrato, pagamento, onboarding, serviços, observações).
--     - Empresa SEM linha = perfil "genérico": Venda comum, fechamento sem
--       itens de agência. Nada presume que a empresa é agência.
--     - Empresas que já existem ganham uma linha "agência" com exatamente o
--       comportamento de hoje (TCV/MRR e todos os itens obrigatórios): nenhuma
--       exigência some sozinha; o Super Admin muda quando quiser, auditado.
--  2. fechamentos: itens de agência passam a aceitar "não se aplica" (NULL).
--     Nenhum dado existente muda. Regras da empresa conferidas no banco
--     (gatilho), além do formulário e da Server Action.
--  3. metas: tipo liberado e menu ligado conferidos no banco.
--  4. metas_progresso / metas_funis_progresso / realizado_periodo /
--     salvar_metas_funis: Venda comum em colunas próprias, nunca somada a TCV
--     nem a MRR (cada fechamento conta uma vez, só no seu tipo).
--  5. Empresas: arquivar (somente leitura, dados preservados) e exclusão
--     definitiva só de cadastro sem nenhum dado comercial, com confirmação
--     pelo endereço e auditoria.
--  6. Conversions API: nome de evento de venda só em etapa "ganha"; sugestão
--     de mapeamento pelas etapas de cada empresa (nada é gravado nem enviado).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Regras comerciais
-- ---------------------------------------------------------------------------
create function public.regras_comerciais_campos()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['contrato_enviado', 'contrato_assinado', 'link_contrato', 'status_pagamento', 'status_onboarding', 'servicos', 'observacoes'] $$;

-- Padrões por perfil. "agencia" = comportamento anterior a esta migration.
create function public.regras_comerciais_padrao(p_perfil text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_perfil = 'agencia' then
    jsonb_build_object(
      'tipos_venda', jsonb_build_array('tcv', 'mrr'),
      'campos', jsonb_build_object(
        'contrato_enviado', 'obrigatorio', 'contrato_assinado', 'obrigatorio', 'link_contrato', 'opcional',
        'status_pagamento', 'obrigatorio', 'status_onboarding', 'obrigatorio', 'servicos', 'opcional', 'observacoes', 'opcional'))
  else
    jsonb_build_object(
      'tipos_venda', jsonb_build_array('venda'),
      'campos', jsonb_build_object(
        'contrato_enviado', 'oculto', 'contrato_assinado', 'oculto', 'link_contrato', 'oculto',
        'status_pagamento', 'opcional', 'status_onboarding', 'oculto', 'servicos', 'opcional', 'observacoes', 'opcional'))
  end
$$;

create table public.empresa_regras_comerciais (
  tenant_id          uuid primary key references public.tenants (id) on delete cascade,
  perfil             text not null check (perfil in ('generico', 'agencia')),
  metas_ativo        boolean not null default true,
  tipos_venda        public.tipo_venda[] not null check (cardinality(tipos_venda) between 1 and 3),
  -- Só o que difere do padrão do perfil: {"campo": "oculto"|"opcional"|"obrigatorio"|"confirmar"}.
  campos_fechamento  jsonb not null default '{}'::jsonb check (jsonb_typeof(campos_fechamento) = 'object'),
  motivo             text check (motivo is null or length(motivo) <= 500),
  definido_por       uuid references auth.users (id) on delete set null,
  definido_em        timestamptz not null default now()
);
alter table public.empresa_regras_comerciais enable row level security;
revoke all on public.empresa_regras_comerciais from public, anon, authenticated;
comment on table public.empresa_regras_comerciais is
  'Regras comerciais de cada empresa (menu Metas, tipos de venda/meta, itens do fechamento). Sem linha = perfil genérico. '
  'Só o Super Admin grava (admin_definir_regras_comerciais); a empresa lê por minhas_regras_comerciais().';

-- Regras efetivas (linha da empresa sobre o padrão do perfil). Uso interno: gatilhos e funções SECURITY DEFINER.
create function public.regras_comerciais_da_empresa(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'perfil', r.perfil,
              'metas_ativo', r.metas_ativo,
              'tipos_venda', to_jsonb(r.tipos_venda),
              'campos', (public.regras_comerciais_padrao(r.perfil) -> 'campos') || r.campos_fechamento,
              'configurado', true)
       from public.empresa_regras_comerciais r where r.tenant_id = p_tenant),
    jsonb_build_object(
      'perfil', 'generico',
      'metas_ativo', true,
      'tipos_venda', public.regras_comerciais_padrao('generico') -> 'tipos_venda',
      'campos', public.regras_comerciais_padrao('generico') -> 'campos',
      'configurado', false))
$$;
revoke all on function public.regras_comerciais_da_empresa(uuid) from public, anon, authenticated;

-- A empresa da requisição (CRM): só as próprias regras.
create function public.minhas_regras_comerciais()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.tenant_atual() is null then null
              else public.regras_comerciais_da_empresa(public.tenant_atual()) end
$$;
revoke all on function public.minhas_regras_comerciais() from public, anon;
grant execute on function public.minhas_regras_comerciais() to authenticated;

-- Super Admin: regras + o que a empresa já tem por tipo (para não esconder histórico sem aviso).
create function public.admin_regras_comerciais(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  return public.regras_comerciais_da_empresa(p_tenant) || jsonb_build_object(
    'uso', jsonb_build_object(
      'fechamentos', coalesce((select jsonb_object_agg(coalesce(x.tipo, 'nao_classificado'), x.n)
                                 from (select f.tipo_venda::text as tipo, count(*) as n from public.fechamentos f
                                        where f.tenant_id = p_tenant and f.anulado_em is null group by 1) x), '{}'::jsonb),
      'metas', coalesce((select jsonb_object_agg(x.tipo, x.n)
                           from (select m.tipo_meta::text as tipo, count(*) as n from public.metas m
                                  where m.tenant_id = p_tenant group by 1) x), '{}'::jsonb)));
end;
$$;
revoke all on function public.admin_regras_comerciais(uuid) from public, anon;
grant execute on function public.admin_regras_comerciais(uuid) to authenticated;

create function public.admin_definir_regras_comerciais(
  p_tenant uuid, p_perfil text, p_metas_ativo boolean, p_tipos_venda text[], p_campos jsonb, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo   public.tenant_tipo;
  v_campos jsonb := coalesce(p_campos, '{}'::jsonb);
  v_chave  text;
  v_valor  text;
  v_final  jsonb;
  v_tipos  public.tipo_venda[];
  v_antes  jsonb;
begin
  perform public.exigir_super_admin();
  select t.tipo into v_tipo from public.tenants t where t.id = p_tenant for update;
  if v_tipo is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  if v_tipo = 'arquivo' then raise exception 'A empresa de arquivo é somente leitura.' using errcode = '22023'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Informe o motivo da alteração.' using errcode = '22023';
  end if;
  if p_perfil is null or p_perfil not in ('generico', 'agencia') then
    raise exception 'Perfil inválido (use genérico ou agência).' using errcode = '22023';
  end if;
  if p_tipos_venda is null or cardinality(p_tipos_venda) = 0 then
    raise exception 'Escolha ao menos um tipo de venda/meta (TCV, MRR ou Venda comum).' using errcode = '22023';
  end if;
  begin
    select array_agg(distinct x::public.tipo_venda order by x::public.tipo_venda) into v_tipos from unnest(p_tipos_venda) x;
  exception when invalid_text_representation then
    raise exception 'Tipo de venda inválido.' using errcode = '22023';
  end;
  if jsonb_typeof(v_campos) <> 'object' then raise exception 'Campos do fechamento inválidos.' using errcode = '22023'; end if;
  for v_chave, v_valor in select key, value #>> '{}' from jsonb_each(v_campos) loop
    if not (v_chave = any (public.regras_comerciais_campos())) then
      raise exception 'Campo do fechamento desconhecido: %.', v_chave using errcode = '22023';
    end if;
    if v_valor is null or v_valor not in ('oculto', 'opcional', 'obrigatorio', 'confirmar') then
      raise exception 'Regra inválida para %: use oculto, opcional, obrigatório ou confirmar.', v_chave using errcode = '22023';
    end if;
    if v_valor = 'confirmar' and v_chave not in ('contrato_enviado', 'contrato_assinado') then
      raise exception '"Confirmar" só vale para contrato enviado e contrato assinado.' using errcode = '22023';
    end if;
  end loop;
  v_final := (public.regras_comerciais_padrao(p_perfil) -> 'campos') || v_campos;
  -- Mesma regra da constraint fechamentos_assinatura_exige_envio.
  if v_final ->> 'contrato_assinado' <> 'oculto' and v_final ->> 'contrato_enviado' = 'oculto' then
    raise exception 'Para pedir "contrato assinado", o fechamento também precisa mostrar "contrato enviado".' using errcode = '22023';
  end if;

  v_antes := public.regras_comerciais_da_empresa(p_tenant);
  insert into public.empresa_regras_comerciais (tenant_id, perfil, metas_ativo, tipos_venda, campos_fechamento, motivo, definido_por, definido_em)
  values (p_tenant, p_perfil, coalesce(p_metas_ativo, true), v_tipos, v_campos, btrim(p_motivo), (select auth.uid()), now())
  on conflict (tenant_id) do update
    set perfil = excluded.perfil, metas_ativo = excluded.metas_ativo, tipos_venda = excluded.tipos_venda,
        campos_fechamento = excluded.campos_fechamento, motivo = excluded.motivo,
        definido_por = excluded.definido_por, definido_em = excluded.definido_em;

  perform public.registrar_auditoria('regras_comerciais_definidas', p_tenant,
    jsonb_build_object('motivo', btrim(p_motivo), 'antes', v_antes, 'depois', public.regras_comerciais_da_empresa(p_tenant)));
end;
$$;
revoke all on function public.admin_definir_regras_comerciais(uuid, text, boolean, text[], jsonb, text) from public, anon;
grant execute on function public.admin_definir_regras_comerciais(uuid, text, boolean, text[], jsonb, text) to authenticated;

-- Empresas existentes: o comportamento de hoje, explícito (nenhuma exigência some sozinha).
insert into public.empresa_regras_comerciais (tenant_id, perfil, metas_ativo, tipos_venda, campos_fechamento, motivo)
select t.id, 'agencia', true, array['tcv', 'mrr']::public.tipo_venda[], '{}'::jsonb,
       'Preservado ao criar as regras por empresa (comportamento anterior: TCV/MRR e itens de agência obrigatórios).'
  from public.tenants t
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fechamentos: itens de agência aceitam "não se aplica"
-- ---------------------------------------------------------------------------
alter table public.fechamentos
  alter column contrato_enviado drop not null,
  alter column contrato_assinado drop not null,
  alter column status_pagamento drop not null,
  alter column status_onboarding drop not null;
alter table public.fechamentos drop constraint fechamentos_assinatura_exige_envio;
alter table public.fechamentos add constraint fechamentos_assinatura_exige_envio
  check (not coalesce(contrato_assinado, false) or contrato_enviado is true);
comment on column public.fechamentos.contrato_enviado is
  'NULL = não se aplica à empresa (regras comerciais). Quando a regra pede, o fechamento responde explicitamente.';

-- Regras da empresa no banco. INSERT: tipo liberado e itens exigidos. UPDATE: só o que mudou
-- (editar outro campo de um fechamento antigo nunca força nada) e item oculto nunca é apagado.
create function public.fechamentos_regras_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      jsonb := public.regras_comerciais_da_empresa(new.tenant_id);
  v_campos jsonb := v_r -> 'campos';
  v_regra  text;
  v_rotulo text;
  v_novo   text;
  v_velho  text;
  v_campo  text;
begin
  if tg_op = 'UPDATE' then
    -- Item oculto para a empresa: o formulário não manda, o valor antigo fica.
    if v_campos ->> 'contrato_enviado' = 'oculto' and new.contrato_enviado is null then new.contrato_enviado := old.contrato_enviado; end if;
    if v_campos ->> 'contrato_assinado' = 'oculto' and new.contrato_assinado is null then new.contrato_assinado := old.contrato_assinado; end if;
    if v_campos ->> 'link_contrato' = 'oculto' and new.link_contrato is null then new.link_contrato := old.link_contrato; end if;
    if v_campos ->> 'status_pagamento' = 'oculto' and new.status_pagamento is null then new.status_pagamento := old.status_pagamento; end if;
    if v_campos ->> 'status_onboarding' = 'oculto' and new.status_onboarding is null then new.status_onboarding := old.status_onboarding; end if;
  end if;

  if new.tipo_venda is not null
     and (tg_op = 'INSERT' or new.tipo_venda is distinct from old.tipo_venda)
     and not (v_r -> 'tipos_venda') ? new.tipo_venda::text then
    raise exception 'O tipo de venda "%" não está liberado para esta empresa.',
      case new.tipo_venda::text when 'tcv' then 'TCV' when 'mrr' then 'MRR' else 'Venda comum' end
      using errcode = '23514';
  end if;

  foreach v_campo in array array['contrato_enviado', 'contrato_assinado', 'link_contrato', 'status_pagamento', 'status_onboarding', 'observacoes'] loop
    v_regra := v_campos ->> v_campo;
    continue when v_regra is null or v_regra not in ('obrigatorio', 'confirmar');
    v_novo := case v_campo
                when 'contrato_enviado' then new.contrato_enviado::text
                when 'contrato_assinado' then new.contrato_assinado::text
                when 'link_contrato' then nullif(btrim(new.link_contrato), '')
                when 'status_pagamento' then new.status_pagamento::text
                when 'status_onboarding' then new.status_onboarding::text
                when 'observacoes' then nullif(btrim(new.observacoes), '') end;
    if tg_op = 'UPDATE' then
      v_velho := case v_campo
                   when 'contrato_enviado' then old.contrato_enviado::text
                   when 'contrato_assinado' then old.contrato_assinado::text
                   when 'link_contrato' then nullif(btrim(old.link_contrato), '')
                   when 'status_pagamento' then old.status_pagamento::text
                   when 'status_onboarding' then old.status_onboarding::text
                   when 'observacoes' then nullif(btrim(old.observacoes), '') end;
      continue when v_novo is not distinct from v_velho;
    end if;
    v_rotulo := case v_campo
                  when 'contrato_enviado' then 'Contrato enviado'
                  when 'contrato_assinado' then 'Contrato assinado'
                  when 'link_contrato' then 'Link do contrato'
                  when 'status_pagamento' then 'Status do pagamento'
                  when 'status_onboarding' then 'Status do onboarding'
                  else 'Observações' end;
    if v_novo is null then
      raise exception 'Preencha "%": é obrigatório no fechamento desta empresa.', v_rotulo using errcode = '23514';
    end if;
    if v_regra = 'confirmar' and v_novo <> 'true' then
      raise exception 'Confirme "%" para finalizar: esta empresa exige a confirmação.', v_rotulo using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.fechamentos_regras_empresa() from public, anon, authenticated;
create trigger fechamentos_regras_empresa before insert or update on public.fechamentos
  for each row execute function public.fechamentos_regras_empresa();

-- ---------------------------------------------------------------------------
-- 3. Metas: menu ligado e tipo liberado (página e Server Action conferem antes)
-- ---------------------------------------------------------------------------
create function public.metas_regras_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_r      jsonb := public.regras_comerciais_da_empresa(v_tenant);
begin
  if public.exclusao_empresa_autorizada(v_tenant) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not coalesce((v_r ->> 'metas_ativo')::boolean, true) then
    raise exception 'O menu Metas está desativado para esta empresa.' using errcode = '42501';
  end if;
  -- Só metas de venda têm tipo (metas_reunioes não); metas antigas de tipo retirado continuam editáveis.
  if tg_table_name = 'metas' and tg_op = 'INSERT' then
    if not (v_r -> 'tipos_venda') ? new.tipo_meta::text then
      raise exception 'O tipo de meta "%" não está liberado para esta empresa.',
        case new.tipo_meta::text when 'tcv' then 'TCV' when 'mrr' then 'MRR' else 'Venda comum' end
        using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.metas_regras_empresa() from public, anon, authenticated;
create trigger metas_regras_empresa before insert or update or delete on public.metas
  for each row execute function public.metas_regras_empresa();
create trigger metas_reunioes_regras_empresa before insert or update or delete on public.metas_reunioes
  for each row execute function public.metas_regras_empresa();

-- ---------------------------------------------------------------------------
-- 4. Progresso e realizado com Venda comum (colunas próprias, nunca somadas)
--    Mesmo corpo de 20261022170000 + o tipo 'venda'. O retorno muda, então
--    drop + create (mesmos grants).
-- ---------------------------------------------------------------------------
drop function public.metas_progresso(date);
create function public.metas_progresso(p_mes date)
returns table (meta_id_tcv uuid, meta_id_mrr uuid, usuario_id uuid, nome text, role public.user_role, ativo boolean,
               valor_meta_tcv numeric, realizado_tcv numeric, qtd_tcv bigint,
               valor_meta_mrr numeric, realizado_mrr numeric, qtd_mrr bigint,
               meta_id_venda uuid, valor_meta_venda numeric, realizado_venda numeric, qtd_venda bigint)
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
           public.papel_do_cargo(m.papel) as role
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
  vendas_mrr as (select v.usuario_id, v.valor, v.qtd from vendas v where v.tipo_venda = 'mrr'),
  vendas_venda as (select v.usuario_id, v.valor, v.qtd from vendas v where v.tipo_venda = 'venda')
  select mt.id, mm.id, null::uuid, null::text, null::public.user_role, null::boolean,
         mt.valor_meta,
         (select coalesce(sum(v.valor), 0) from vendas_tcv v),
         (select coalesce(sum(v.qtd), 0) from vendas_tcv v),
         mm.valor_meta,
         (select coalesce(sum(v.valor), 0) from vendas_mrr v),
         (select coalesce(sum(v.qtd), 0) from vendas_mrr v),
         mv.id, mv.valor_meta,
         (select coalesce(sum(v.valor), 0) from vendas_venda v),
         (select coalesce(sum(v.qtd), 0) from vendas_venda v)
    from mes cross join ctx
    left join public.metas mt
      on mt.tenant_id = ctx.t and mt.usuario_id is null and mt.funil_id is null
     and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
    left join public.metas mm
      on mm.tenant_id = ctx.t and mm.usuario_id is null and mm.funil_id is null
     and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
    left join public.metas mv
      on mv.tenant_id = ctx.t and mv.usuario_id is null and mv.funil_id is null
     and mv.periodo_mes = mes.inicio and mv.tipo_meta = 'venda'
   where ctx.t is not null
  union all
  select mt.id, mm.id, p.id, p.nome, p.role, p.ativo,
         mt.valor_meta, coalesce(vt.valor, 0), coalesce(vt.qtd, 0),
         mm.valor_meta, coalesce(vm.valor, 0), coalesce(vm.qtd, 0),
         mv.id, mv.valor_meta, coalesce(vv.valor, 0), coalesce(vv.qtd, 0)
    from membros p
    cross join mes cross join ctx
    left join public.metas mt
      on mt.tenant_id = ctx.t and mt.usuario_id = p.id and mt.funil_id is null
     and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
    left join public.metas mm
      on mm.tenant_id = ctx.t and mm.usuario_id = p.id and mm.funil_id is null
     and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
    left join public.metas mv
      on mv.tenant_id = ctx.t and mv.usuario_id = p.id and mv.funil_id is null
     and mv.periodo_mes = mes.inicio and mv.tipo_meta = 'venda'
    left join vendas_tcv vt on vt.usuario_id = p.id
    left join vendas_mrr vm on vm.usuario_id = p.id
    left join vendas_venda vv on vv.usuario_id = p.id
   where (public.is_gerente() or (p.id = (select auth.uid()) and p.role in ('closer', 'vendedor')))
     and ((p.role in ('closer', 'vendedor') and p.ativo) or mt.id is not null or mm.id is not null or mv.id is not null
          or vt.valor is not null or vm.valor is not null or vv.valor is not null);
$$;
revoke all on function public.metas_progresso(date) from public, anon;
grant execute on function public.metas_progresso(date) to authenticated, service_role;

drop function public.metas_funis_progresso(date);
create function public.metas_funis_progresso(p_mes date)
returns table (funil_id uuid, funil_nome text, meta_id_tcv uuid, valor_meta_tcv numeric, realizado_tcv numeric,
               meta_id_mrr uuid, valor_meta_mrr numeric, realizado_mrr numeric,
               meta_id_venda uuid, valor_meta_venda numeric, realizado_venda numeric)
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
  vendas_mrr as (select v.funil_id, v.valor from vendas v where v.tipo_venda = 'mrr'),
  vendas_venda as (select v.funil_id, v.valor from vendas v where v.tipo_venda = 'venda')
  select fu.id, fu.nome, mt.id, mt.valor_meta, coalesce(vt.valor, 0), mm.id, mm.valor_meta, coalesce(vm.valor, 0),
         mv.id, mv.valor_meta, coalesce(vv.valor, 0)
    from public.funis fu
    cross join mes cross join ctx
    left join public.metas mt
      on mt.tenant_id = ctx.t and mt.funil_id = fu.id and mt.usuario_id is null
     and mt.periodo_mes = mes.inicio and mt.tipo_meta = 'tcv'
    left join public.metas mm
      on mm.tenant_id = ctx.t and mm.funil_id = fu.id and mm.usuario_id is null
     and mm.periodo_mes = mes.inicio and mm.tipo_meta = 'mrr'
    left join public.metas mv
      on mv.tenant_id = ctx.t and mv.funil_id = fu.id and mv.usuario_id is null
     and mv.periodo_mes = mes.inicio and mv.tipo_meta = 'venda'
    left join vendas_tcv vt on vt.funil_id = fu.id
    left join vendas_mrr vm on vm.funil_id = fu.id
    left join vendas_venda vv on vv.funil_id = fu.id
   where fu.tenant_id = ctx.t and fu.ativo
   order by fu.ordem;
$$;
revoke all on function public.metas_funis_progresso(date) from public, anon;
grant execute on function public.metas_funis_progresso(date) to authenticated, service_role;

drop function public.realizado_periodo(date, date);
create function public.realizado_periodo(p_inicio date, p_fim date)
returns table (usuario_id uuid, nome text, role public.user_role, ativo boolean, realizado_tcv numeric, realizado_mrr numeric,
               realizado_venda numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with
  ctx as (select public.tenant_atual() as t),
  membros as (
    select p.id, p.nome, (p.ativo and m.ativo) as ativo,
           public.papel_do_cargo(m.papel) as role
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
  vendas_mrr as (select v.usuario_id, v.valor from vendas v where v.tipo_venda = 'mrr'),
  vendas_venda as (select v.usuario_id, v.valor from vendas v where v.tipo_venda = 'venda')
  select null::uuid, null::text, null::public.user_role, null::boolean,
         (select coalesce(sum(v.valor), 0) from vendas_tcv v),
         (select coalesce(sum(v.valor), 0) from vendas_mrr v),
         (select coalesce(sum(v.valor), 0) from vendas_venda v)
    from ctx
   where ctx.t is not null
  union all
  select p.id, p.nome, p.role, p.ativo, coalesce(vt.valor, 0), coalesce(vm.valor, 0), coalesce(vv.valor, 0)
    from membros p
    left join vendas_tcv vt on vt.usuario_id = p.id
    left join vendas_mrr vm on vm.usuario_id = p.id
    left join vendas_venda vv on vv.usuario_id = p.id
   where (public.is_gerente() or (p.id = (select auth.uid()) and p.role in ('closer', 'vendedor')))
     and ((p.role in ('closer', 'vendedor') and p.ativo) or vt.valor is not null or vm.valor is not null or vv.valor is not null);
$$;
revoke all on function public.realizado_periodo(date, date) from public, anon;
grant execute on function public.realizado_periodo(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Empresas: arquivar e excluir definitivamente
-- ---------------------------------------------------------------------------
-- Exclusão em curso: só admin_excluir_empresa grava aqui, e só vale na MESMA
-- transação (txid). As travas de exclusão (último administrador, etapas
-- padrão, Funil Principal, empresa somente leitura, menu Metas) liberam
-- apenas esse caso.
create table public.tenants_exclusao_em_curso (
  tenant_id  uuid primary key,
  txid       bigint not null,
  criado_em  timestamptz not null default now()
);
alter table public.tenants_exclusao_em_curso enable row level security;
revoke all on public.tenants_exclusao_em_curso from public, anon, authenticated;

create function public.exclusao_empresa_autorizada(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant is not null and exists (
    select 1 from public.tenants_exclusao_em_curso x where x.tenant_id = p_tenant and x.txid = txid_current())
$$;
revoke all on function public.exclusao_empresa_autorizada(uuid) from public, anon;
grant execute on function public.exclusao_empresa_autorizada(uuid) to authenticated, service_role;

-- Arquivar: somente leitura com TODOS os dados preservados (assinatura cancelada). Volta por "Reativar".
create function public.admin_arquivar_empresa(p_tenant uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo   public.tenant_tipo;
  v_status public.tenant_status;
begin
  perform public.exigir_super_admin();
  select t.tipo, t.status into v_tipo, v_status from public.tenants t where t.id = p_tenant for update;
  if v_tipo is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  if v_tipo <> 'assinante' then
    raise exception 'A empresa interna e a de arquivo não podem ser arquivadas.' using errcode = '22023';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then raise exception 'Informe o motivo do arquivamento.' using errcode = '22023'; end if;
  if v_status = 'cancelado' then raise exception 'A empresa já está arquivada.' using errcode = '22023'; end if;

  perform set_config('rx7.origem_assinatura', 'super_admin', true);
  perform set_config('rx7.motivo_assinatura', btrim(p_motivo), true);
  if exists (select 1 from public.assinaturas a where a.tenant_id = p_tenant) then
    update public.assinaturas set status = 'cancelada' where tenant_id = p_tenant;
  else
    update public.tenants set status = 'cancelado' where id = p_tenant;
  end if;
  perform public.registrar_auditoria('empresa_arquivada', p_tenant,
    jsonb_build_object('motivo', btrim(p_motivo), 'status_anterior', v_status));
end;
$$;
revoke all on function public.admin_arquivar_empresa(uuid, text) from public, anon;
grant execute on function public.admin_arquivar_empresa(uuid, text) to authenticated;

-- O que impediria a exclusão definitiva (dados comerciais ou de clientes). Vazio = pode excluir.
create function public.empresa_bloqueios_exclusao(p_tenant uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b text[] := '{}';
  v_n bigint;
  v_t record;
begin
  for v_t in select * from (values
      ('clientes', 'clientes'), ('negociacoes', 'negociações'), ('fechamentos', 'fechamentos'), ('metas', 'metas'),
      ('metas_reunioes', 'metas de reuniões'), ('atividades', 'atividades'), ('eventos', 'eventos da agenda'),
      ('conversas', 'conversas'), ('mensagens', 'mensagens'), ('fontes_leads', 'fontes de captação'),
      ('integracoes_contas_google', 'contas Google'), ('whatsapp_numeros', 'números de WhatsApp'),
      ('pagamento_eventos', 'eventos de pagamento'), ('ingestao_eventos', 'leads recebidos'),
      ('historico_etapas', 'histórico do funil'), ('proximas_acoes', 'próximas ações'),
      ('meta_ads_conexoes', 'conexão Meta Ads'), ('meta_conversoes_conexoes', 'conexão Conversions API')) as x (tabela, rotulo) loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_t.tabela) into v_n using p_tenant;
    if v_n > 0 then v_b := v_b || format('%s %s', v_n, v_t.rotulo); end if;
  end loop;
  return v_b;
end;
$$;
revoke all on function public.empresa_bloqueios_exclusao(uuid) from public, anon, authenticated;

create function public.admin_exclusao_empresa_situacao(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.tenants;
begin
  perform public.exigir_super_admin();
  select * into v_t from public.tenants where id = p_tenant;
  if v_t.id is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'protegida', v_t.tipo <> 'assinante',
    'inativa', v_t.status in ('suspenso', 'cancelado'),
    'bloqueios', to_jsonb(public.empresa_bloqueios_exclusao(p_tenant)),
    'usuarios_sem_outra_empresa', (select count(*) from public.tenant_memberships m
                                    where m.tenant_id = p_tenant
                                      and not exists (select 1 from public.tenant_memberships o where o.user_id = m.user_id and o.tenant_id <> p_tenant)));
end;
$$;
revoke all on function public.admin_exclusao_empresa_situacao(uuid) from public, anon;
grant execute on function public.admin_exclusao_empresa_situacao(uuid) to authenticated;

-- Exclusão definitiva: só cadastro sem nenhum dado comercial, já inativo, com o endereço digitado.
-- Apaga a configuração da empresa (funil, etapas, nicho, formulário, vínculos, assinatura); a auditoria
-- fica (sem o vínculo, com o id e o endereço da empresa nos detalhes). Usuários continuam existindo.
create function public.admin_excluir_empresa(p_tenant uuid, p_confirmacao text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t        public.tenants;
  v_bloqueio text[];
begin
  perform public.exigir_super_admin();
  select * into v_t from public.tenants where id = p_tenant for update;
  if v_t.id is null then raise exception 'Empresa não encontrada.' using errcode = 'P0002'; end if;
  if v_t.tipo <> 'assinante' then
    raise exception 'A empresa interna e a de arquivo nunca são excluídas.' using errcode = '22023';
  end if;
  if v_t.status not in ('suspenso', 'cancelado') then
    raise exception 'Desative ou arquive a empresa antes de excluí-la.' using errcode = '22023';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then raise exception 'Informe o motivo da exclusão.' using errcode = '22023'; end if;
  if p_confirmacao is null or btrim(p_confirmacao) <> v_t.slug then
    raise exception 'Para confirmar, digite exatamente o endereço da empresa (%).', v_t.slug using errcode = '22023';
  end if;
  v_bloqueio := public.empresa_bloqueios_exclusao(p_tenant);
  if cardinality(v_bloqueio) > 0 then
    raise exception 'A empresa tem dados e não pode ser excluída (%). Mantenha-a arquivada.', array_to_string(v_bloqueio, ', ')
      using errcode = '23503';
  end if;

  perform public.registrar_auditoria('empresa_excluida', null,
    jsonb_build_object('motivo', btrim(p_motivo), 'empresa_id', v_t.id, 'empresa_slug', v_t.slug, 'empresa_nome', v_t.nome));

  insert into public.tenants_exclusao_em_curso (tenant_id, txid) values (p_tenant, txid_current())
  on conflict (tenant_id) do update set txid = excluded.txid, criado_em = now();
  delete from public.plataforma_integracoes_empresas where tenant_id = p_tenant;
  -- Exceções de cota e de integração da Central: os gatilhos delas auditam a remoção, então saem
  -- enquanto a empresa ainda existe (a auditoria é desvinculada logo antes de apagar a empresa).
  delete from public.empresa_limites where tenant_id = p_tenant;
  delete from public.empresa_integracoes_regras where tenant_id = p_tenant;
  delete from public.permissoes_colaborador where tenant_id = p_tenant;
  delete from public.tenant_memberships where tenant_id = p_tenant;
  -- Configuração aponta para o formulário padrão: sai antes dele.
  delete from public.tenant_configuracoes where tenant_id = p_tenant;
  delete from public.perguntas where tenant_id = p_tenant;
  delete from public.formularios where tenant_id = p_tenant;
  delete from public.negociacao_servicos where tenant_id = p_tenant;
  delete from public.servicos where tenant_id = p_tenant;
  delete from public.etapas_funil where tenant_id = p_tenant;
  delete from public.funis where tenant_id = p_tenant;
  delete from public.nichos where tenant_id = p_tenant;
  delete from public.ingestao_credenciais where tenant_id = p_tenant;
  delete from public.agenda_google_oauth_estados where tenant_id = p_tenant;
  delete from public.agenda_google_conexao where tenant_id = p_tenant;
  delete from public.assinaturas_historico where tenant_id = p_tenant;
  delete from public.assinaturas where tenant_id = p_tenant;
  -- Por último: remoções acima também registram auditoria. O histórico fica, sem o vínculo.
  update public.admin_auditoria
     set detalhes = detalhes || jsonb_build_object('empresa_excluida', jsonb_build_object('id', v_t.id, 'slug', v_t.slug)),
         tenant_id = null
   where tenant_id = p_tenant;
  delete from public.tenants where id = p_tenant;
  delete from public.tenants_exclusao_em_curso where tenant_id = p_tenant;
end;
$$;
revoke all on function public.admin_excluir_empresa(uuid, text, text) from public, anon;
grant execute on function public.admin_excluir_empresa(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Conversions API: sugestão de mapeamento pelas etapas de CADA empresa
--    (leitura; nada é gravado nem enviado). Venda só na etapa "ganha".
-- ---------------------------------------------------------------------------
create function public.capi_evento_de_venda(p_evento text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(translate(btrim(coalesce(p_evento, '')), 'ÁÀÂÃáàâãÉÊéêÍíÓÔÕóôõÚúÇç', 'AAAAaaaaEEeeIiOOOoooUuCc'))
         in ('purchase', 'venda', 'venda fechada', 'venda ganha', 'fechado', 'fechamento', 'ganho', 'ganha', 'sale', 'won', 'compra')
$$;

create function public.capi_mapeamento_sugerido()
returns table (funil_id uuid, funil_nome text, etapa_id uuid, etapa_nome text, evento text, enviar_valor boolean, motivo text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.nome, e.id, e.nome,
         case when e.tipo = 'ganha' then 'Venda fechada'
              when e.chave = 'reuniao_realizada' then 'Reunião realizada'
              else 'Lead qualificado' end,
         e.tipo = 'ganha',
         case when e.tipo = 'ganha' then 'Etapa de venda ganha deste funil (envia o valor do fechamento).'
              when e.chave = 'reuniao_realizada' then 'Etapa "Reunião realizada" do sistema.'
              else 'Etapa de qualificação (MQL) deste funil.' end
    from public.etapas_funil e
    join public.funis f on f.id = e.funil_id
   where e.tenant_id = public.tenant_atual()
     and public.is_gerente()
     and e.ativo and f.ativo
     and (e.tipo = 'ganha'
          or e.chave = 'reuniao_realizada'
          or (e.tipo = 'aberta' and not e.pos_fechamento
              and lower(translate(btrim(e.nome), 'Áá', 'Aa')) ~ '^(mql|lead qualificado|qualificado|qualificacao)$'))
   order by f.ordem, e.ordem
$$;
revoke all on function public.capi_mapeamento_sugerido() from public, anon;
grant execute on function public.capi_mapeamento_sugerido() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Funções existentes com ajuste mínimo (corpo igual ao de hoje + 1 trecho)
-- ---------------------------------------------------------------------------

-- Metas por funil: aceita Venda comum (o gatilho de metas confere se a empresa liberou o tipo).
CREATE OR REPLACE FUNCTION public.salvar_metas_funis(p_mes date, p_itens jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if v_tipo_meta not in ('tcv', 'mrr', 'venda') then
      raise exception 'tipo_meta deve ser "tcv", "mrr" ou "venda" (veio %).', coalesce(v_tipo_meta, 'null') using errcode = '23514';
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
$function$;

CREATE OR REPLACE FUNCTION public.tenant_validar_gravacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'A empresa de um registro não pode ser alterada.' using errcode = '23514';
  end if;

  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;

  -- Exclusão definitiva autorizada (admin_excluir_empresa, mesma transação).
  if tg_op = 'DELETE' and public.exclusao_empresa_autorizada(v_tenant) then
    return old;
  end if;

  if public.estrutura_em_montagem(v_tenant) and tg_op = 'INSERT' then
    return new;
  end if;

  if (select auth.uid()) is not null and not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Você não tem permissão para gravar nesta empresa.' using errcode = '42501';
  end if;

  if v_claims is not null and exists (
    select 1 from public.tenants t where t.id = v_tenant and t.somente_leitura
  ) then
    raise exception 'Esta empresa está somente leitura.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_memberships_guarda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tipo public.tenant_tipo;
begin
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.user_id <> old.user_id) then
    raise exception 'Empresa e usuário de um vínculo não podem ser alterados.' using errcode = '23514';
  end if;

  -- Exclusão definitiva autorizada (admin_excluir_empresa, mesma transação).
  if tg_op = 'DELETE' and public.exclusao_empresa_autorizada(old.tenant_id) then
    return old;
  end if;

  if old.papel = 'admin_empresa' and old.ativo
     and (tg_op = 'DELETE' or new.papel <> 'admin_empresa' or not new.ativo) then
    -- Serializa mudanças concorrentes na mesma empresa (dois admins se rebaixando ao mesmo tempo).
    select t.tipo into v_tipo from public.tenants t where t.id = old.tenant_id for update;

    if v_tipo <> 'arquivo' and not exists (
      select 1 from public.tenant_memberships m
       where m.tenant_id = old.tenant_id
         and m.id <> old.id
         and m.papel = 'admin_empresa'
         and m.ativo
    ) then
      raise exception 'A empresa precisa de pelo menos um administrador ativo.' using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.etapas_funil_regras()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_limite numeric;
begin
  if tg_op = 'DELETE' then
    -- Exclusão definitiva autorizada (admin_excluir_empresa, mesma transação).
    if public.exclusao_empresa_autorizada(old.tenant_id) then
      return old;
    end if;
    if old.sistema then
      raise exception 'Etapas padrão do funil não podem ser excluídas.' using errcode = '23514';
    end if;
    if exists (select 1 from public.negociacoes n where n.etapa_id = old.id)
       or exists (
         select 1 from public.historico_etapas h
         where h.etapa_nova_id = old.id or h.etapa_anterior_id = old.id
       )
    then
      raise exception 'A etapa "%" já teve negociações. Desative-a em vez de excluir.', old.nome
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.sistema then
    -- Sistema: só a cor muda (nem o funil, nem participa_conversao, de uma
    -- etapa de sistema mudam).
    if new.nome is distinct from old.nome
       or new.ordem is distinct from old.ordem
       or new.tipo is distinct from old.tipo
       or new.sistema is distinct from old.sistema
       or new.chave is distinct from old.chave
       or new.ativo is distinct from old.ativo
       or new.funil_id is distinct from old.funil_id
       or new.pos_fechamento is distinct from old.pos_fechamento
       or new.participa_conversao is distinct from old.participa_conversao
    then
      raise exception 'Nas etapas padrão do funil só a cor pode ser alterada.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Personalizada (inserção ou edição) — inclusive ganha/perdida de um funil novo.
  if (new.sistema or new.chave is not null) and not public.estrutura_em_montagem(new.tenant_id) then
    raise exception 'Etapas padrão só são criadas pelo sistema.' using errcode = '23514';
  end if;

  if new.tipo = 'aberta' then
    if new.pos_fechamento then
      -- Zona de recuperação: depois de TODAS as etapas de fechamento do funil.
      select max(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem <= v_limite then
        raise exception 'Etapas de recuperação ficam depois das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
    else
      -- Zona normal (pipeline): antes de TODAS as etapas de fechamento — regra inalterada.
      select min(e.ordem) into v_limite
        from public.etapas_funil e
       where e.funil_id = new.funil_id
         and e.tipo in ('ganha', 'perdida');

      if v_limite is not null and new.ordem >= v_limite then
        raise exception 'Etapas abertas ficam antes das etapas de fechamento do funil.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- Bloqueio de DESATIVAR: só uso OPERACIONAL impede — negociação arquivada,
  -- excluída ou de cliente excluído não trava mais a desativação (ver
  -- cabeçalho desta migration). Etapa de sistema nunca chega aqui (já voltou
  -- no ramo `old.sistema` acima), então isto só afeta etapas personalizadas.
  if tg_op = 'UPDATE' and old.ativo and not new.ativo
     and exists (
       select 1
       from public.negociacoes n
       join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
       where n.etapa_id = new.id
         and n.arquivada_em is null
         and n.excluida_em is null
     )
  then
    raise exception 'Mova as negociações da etapa "%" antes de desativá-la.', new.nome
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.funis_regras()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    -- Exclusão definitiva autorizada (admin_excluir_empresa, mesma transação).
    if public.exclusao_empresa_autorizada(old.tenant_id) then
      return old;
    end if;
    if old.padrao then
      raise exception 'O Funil Principal não pode ser excluído.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.negociacoes n
      join public.etapas_funil e on e.id = n.etapa_id
      where e.funil_id = old.id
    ) then
      raise exception 'O funil "%" tem negociações vinculadas. Não é possível excluir.', old.nome
        using errcode = '23514';
    end if;

    return old;
  end if;

  -- UPDATE: padrão é fixado na criação, nunca muda depois — senão dashboard,
  -- criar_cliente() e o resto do sistema perdem a referência ao Principal.
  if new.padrao is distinct from old.padrao then
    raise exception 'O funil padrão não pode ser alterado.' using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.capi_definir_configuracao(p_funis uuid[], p_mapeamento jsonb, p_enviar_contato_hash boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := public.capi_exigir();
  v_item   jsonb;
  v_etapa  public.etapas_funil;
begin
  if not exists (select 1 from public.meta_conversoes_conexoes where tenant_id = v_tenant and situacao <> 'desconectada') then
    raise exception 'Conecte a conta Meta Ads antes de configurar.' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(coalesce(p_funis, '{}')) f
              where not exists (select 1 from public.funis x where x.id = f and x.tenant_id = v_tenant and x.ativo)) then
    raise exception 'Funil inválido para esta empresa.' using errcode = '23503';
  end if;
  delete from public.meta_conversoes_mapeamento where tenant_id = v_tenant;
  delete from public.meta_conversoes_funis where tenant_id = v_tenant;
  insert into public.meta_conversoes_funis (tenant_id, funil_id) select distinct v_tenant, f from unnest(coalesce(p_funis, '{}')) f;
  for v_item in select * from jsonb_array_elements(coalesce(p_mapeamento, '[]'::jsonb)) loop
    select * into v_etapa from public.etapas_funil where id = (v_item ->> 'etapa_id')::uuid and tenant_id = v_tenant;
    if v_etapa.id is null or not (v_etapa.funil_id = any (coalesce(p_funis, '{}'))) then
      raise exception 'Etapa inválida: precisa ser de um funil monitorado desta empresa.' using errcode = '23503';
    end if;
    -- Evento de venda só na etapa de venda ganha DESTE funil (uma etapa "Finalizado" que não é venda não vira venda).
    if public.capi_evento_de_venda(v_item ->> 'evento') and v_etapa.tipo <> 'ganha' then
      raise exception 'O evento "%" representa uma venda e só pode ser usado na etapa de venda ganha do funil ("%" não é).',
        btrim(v_item ->> 'evento'), v_etapa.nome using errcode = '23514';
    end if;
    insert into public.meta_conversoes_mapeamento (tenant_id, funil_id, etapa_id, evento, enviar_valor)
    values (v_tenant, v_etapa.funil_id, v_etapa.id, btrim(v_item ->> 'evento'),
            coalesce((v_item ->> 'enviar_valor')::boolean, false) and v_etapa.tipo = 'ganha');
  end loop;
  update public.meta_conversoes_conexoes set enviar_contato_hash = coalesce(p_enviar_contato_hash, false)
   where tenant_id = v_tenant and situacao <> 'desconectada';
  insert into public.admin_auditoria (ator_id, acao, tenant_id, detalhes)
  values ((select auth.uid()), 'capi_configuracao', v_tenant,
          jsonb_build_object('funis', coalesce(p_funis, '{}'), 'etapas', jsonb_array_length(coalesce(p_mapeamento, '[]'::jsonb)),
                             'enviar_contato_hash', coalesce(p_enviar_contato_hash, false)));
end;
$function$;
