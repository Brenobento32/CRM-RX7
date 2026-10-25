-- ===========================================================================
-- REVERSÃO DA ATIVAÇÃO DOS CARGOS (20261027100300) — uso SÓ em emergência.
-- Gerado por C:\Tools\avante-local\gerar-reversao.mjs comparando o estado
-- antes e depois da ativação (cópias locais do espelho de produção).
-- Volta funções, policies e triggers ao que eram com só a estrutura aplicada.
-- NÃO mexe na estrutura (colunas, tabela metas_reunioes, enum): ela é aditiva
-- e o app publicado (66d1ac7) funciona com ela.
-- Antes de rodar: nenhum vínculo com papel vendedor/atendente (ver checklist).
-- Resumo: 4 triggers e 11 policies trocados, 8 funções
-- restauradas, 7 funções novas removidas.
-- ===========================================================================
begin;

do $$
begin
  if to_regprocedure('public.papel_do_cargo(public.tenant_papel)') is null then
    raise exception 'Ativação não está aplicada: nada a reverter.';
  end if;
  if exists (select 1 from public.tenant_memberships where papel::text in ('vendedor', 'atendente')) then
    raise exception 'Há vínculos Vendedor/Atendente: troque o papel deles antes de reverter.';
  end if;
end $$;

drop trigger "negociacoes_regras_atendente" on negociacoes;

drop trigger "cargos_sem_fechamento" on fechamentos;

drop trigger "cargos_sem_exclusao" on negociacoes;

drop trigger "cargos_sem_arquivar_cliente" on clientes;

drop policy "eventos_update" on public."eventos";

drop policy "eventos_select" on public."eventos";

drop policy "eventos_insert" on public."eventos";

drop policy "eventos_delete" on public."eventos";

drop policy "eventos_series_select" on public."eventos_series";

drop policy "eventos_series_insert" on public."eventos_series";

drop policy "eventos_series_update" on public."eventos_series";

drop policy "metas_reunioes_select" on public."metas_reunioes";

drop policy "metas_reunioes_insert" on public."metas_reunioes";

drop policy "metas_reunioes_update" on public."metas_reunioes";

drop policy "metas_reunioes_delete" on public."metas_reunioes";

CREATE OR REPLACE FUNCTION public.agenda_valida_responsavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.user_role := public.papel_comercial(new.usuario_id, new.tenant_id);
begin
  if v_role is null then
    raise exception 'O responsável precisa ser um usuário ativo desta empresa.' using errcode = '23514';
  end if;
  if new.cliente_id is not null
     and v_role <> 'gerente'
     and (select c.owner_id from public.clientes c
           where c.id = new.cliente_id and c.tenant_id = new.tenant_id) is distinct from new.usuario_id
  then
    raise exception 'O responsável precisa ter acesso ao cliente (dono da carteira ou gerente).' using errcode = '23514';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_por_usuario(p_inicio date, p_fim date)
 RETURNS TABLE(usuario_id uuid, nome text, role user_role, pipeline_valor numeric, abertas bigint, vendido_valor numeric, ganhos bigint, perdidos bigint, em_recuperacao_qtd bigint, em_recuperacao_valor numeric, reunioes_proximas bigint, reunioes_realizadas bigint, atividades bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with
  principal as (
    select id from public.funis where padrao
  ),
  periodo as (
    select
      (p_inicio::timestamp at time zone 'America/Sao_Paulo')     as inicio,
      ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')  as fim
  ),
  -- Zona normal só: a de recuperação não é pipeline comercial ativo.
  abertas as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta' and not e.pos_fechamento
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    cross join principal
    where n.funil_id = principal.id
    group by n.owner_id
  ),
  -- Visão separada da zona de recuperação — não some dos números por pessoa.
  em_recuperacao as (
    select n.owner_id, sum(n.valor_estimado) as valor, count(*) as qtd
    from public.negociacoes n
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'aberta' and e.pos_fechamento
    join public.clientes c on c.id = n.cliente_id and c.deleted_at is null
    cross join principal
    where n.funil_id = principal.id
    group by n.owner_id
  ),
  ganhos as (
    select n.owner_id, sum(f.valor_vendido) as valor, count(*) as qtd
    from public.fechamentos f
    join public.negociacoes n on n.id = f.negociacao_id
    join public.etapas_funil e on e.id = n.etapa_id and e.tipo = 'ganha'
    cross join principal
    where n.funil_id = principal.id
      and f.data_fechamento between p_inicio and p_fim
    group by n.owner_id
  ),
  -- "Perdido no período" = ENTROU em perdida no período (historico_etapas),
  -- não "está em perdida agora" — sobrevive a Perdido -> Recuperação.
  perdidos as (
    select n.owner_id, count(distinct n.id) as qtd
    from public.negociacoes n
    join public.historico_etapas h on h.negociacao_id = n.id
    join public.etapas_funil e on e.id = h.etapa_nova_id and e.tipo = 'perdida'
    cross join principal
    cross join periodo
    where n.funil_id = principal.id
      and h.created_at >= periodo.inicio
      and h.created_at <  periodo.fim
    group by n.owner_id
  ),
  reunioes as (
    select
      e.usuario_id,
      count(*) filter (
        where e.status = 'agendado'
          and e.inicio >= now()
          and e.inicio < now() + interval '7 days'
      ) as proximas,
      count(*) filter (
        where e.status = 'realizado'
          and e.inicio >= periodo.inicio
          and e.inicio <  periodo.fim
      ) as realizadas
    from public.eventos e, periodo
    where e.tipo in ('reuniao', 'apresentacao')
    group by e.usuario_id
  ),
  atividades as (
    select a.usuario_id, count(*) as qtd
    from public.atividades a, periodo
    where a.data >= periodo.inicio
      and a.data <  periodo.fim
    group by a.usuario_id
  )
  select
    p.id,
    p.nome,
    public.papel_comercial(p.id, public.tenant_atual()),
    coalesce(ab.valor, 0),
    coalesce(ab.qtd, 0),
    coalesce(g.valor, 0),
    coalesce(g.qtd, 0),
    coalesce(pe.qtd, 0),
    coalesce(er.qtd, 0),
    coalesce(er.valor, 0),
    coalesce(r.proximas, 0),
    coalesce(r.realizadas, 0),
    coalesce(at.qtd, 0)
  from public.profiles p
  left join abertas       ab on ab.owner_id  = p.id
  left join ganhos        g  on g.owner_id   = p.id
  left join perdidos      pe on pe.owner_id  = p.id
  left join em_recuperacao er on er.owner_id = p.id
  left join reunioes      r  on r.usuario_id = p.id
  left join atividades    at on at.usuario_id = p.id
  where (p.ativo and public.papel_comercial(p.id, public.tenant_atual()) = 'closer')
     or p.id = (select auth.uid())
     or ab.qtd > 0 or g.qtd > 0 or pe.qtd > 0 or er.qtd > 0
  order by coalesce(g.valor, 0) desc, p.nome;
$function$
;

CREATE OR REPLACE FUNCTION public.metas_progresso(p_mes date)
 RETURNS TABLE(meta_id_tcv uuid, meta_id_mrr uuid, usuario_id uuid, nome text, role user_role, ativo boolean, valor_meta_tcv numeric, realizado_tcv numeric, qtd_tcv bigint, valor_meta_mrr numeric, realizado_mrr numeric, qtd_mrr bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.metas_regras()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.negociacoes_valida_handoff_sdr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.papel_comercial(p_user uuid, p_tenant uuid)
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case m.papel
           when 'admin_empresa' then 'gerente'
           when 'gerente'       then 'gerente'
           when 'sdr'           then 'sdr'
           when 'closer'        then 'closer'
         end::public.user_role
    from public.tenant_memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = p_tenant
     and m.user_id = p_user
     and m.ativo
     and p.ativo;
$function$
;

CREATE OR REPLACE FUNCTION public.membros_empresa_atual()
 RETURNS TABLE(usuario_id uuid, papel tenant_papel, role user_role, ativo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.user_id,
         m.papel,
         (case m.papel when 'sdr' then 'sdr' when 'closer' then 'closer' else 'gerente' end)::public.user_role,
         (m.ativo and p.ativo)
    from public.tenant_memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = public.tenant_atual();
$function$
;

CREATE OR REPLACE FUNCTION public.realizado_periodo(p_inicio date, p_fim date)
 RETURNS TABLE(usuario_id uuid, nome text, role user_role, ativo boolean, realizado_tcv numeric, realizado_mrr numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

create policy "eventos_delete" on public."eventos" as permissive for delete to "authenticated" using ((((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND (status = ANY (ARRAY['agendado'::status_evento, 'confirmado'::status_evento]))));

create policy "eventos_insert" on public."eventos" as permissive for insert to "authenticated" with check ((((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((cliente_id IS NULL) OR (cliente_owner(cliente_id) = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((negociacao_id IS NULL) OR (negociacao_owner(negociacao_id) = ( SELECT auth.uid() AS uid)) OR is_gerente())));

create policy "eventos_select" on public."eventos" as permissive for select to "authenticated" using (((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()));

create policy "eventos_series_select" on public."eventos_series" as permissive for select to "authenticated" using (((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()));

create policy "eventos_update" on public."eventos" as permissive for update to "authenticated" using (((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente())) with check ((((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((cliente_id IS NULL) OR (cliente_owner(cliente_id) = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((negociacao_id IS NULL) OR (negociacao_owner(negociacao_id) = ( SELECT auth.uid() AS uid)) OR is_gerente())));

create policy "eventos_series_insert" on public."eventos_series" as permissive for insert to "authenticated" with check ((((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((cliente_id IS NULL) OR (cliente_owner(cliente_id) = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((negociacao_id IS NULL) OR (negociacao_owner(negociacao_id) = ( SELECT auth.uid() AS uid)) OR is_gerente())));

create policy "eventos_series_update" on public."eventos_series" as permissive for update to "authenticated" using (((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente())) with check ((((usuario_id = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((cliente_id IS NULL) OR (cliente_owner(cliente_id) = ( SELECT auth.uid() AS uid)) OR is_gerente()) AND ((negociacao_id IS NULL) OR (negociacao_owner(negociacao_id) = ( SELECT auth.uid() AS uid)) OR is_gerente())));

drop function papel_do_cargo(tenant_papel);

drop function negociacoes_regras_atendente();

drop function cargos_sem_fechamento();

drop function agenda_pode_definir_responsavel(uuid);

drop function agenda_ocupacao(timestamp with time zone,timestamp with time zone);

drop function metas_reunioes_progresso(date);

drop function empresa_atualizar_contato(text,text,text,text);

commit;
