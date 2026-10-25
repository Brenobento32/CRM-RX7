-- ===========================================================================
-- PROPOSTA (NÃO APLICADA) — ATIVAÇÃO das permissões dos cargos.
-- Gerado por C:\Tools\avante-local\gerar-ativacao.mjs a partir das funções
-- atuais (espelho de produção): os corpos são os mesmos, só com as trocas
-- abaixo. Pré-requisito: 100000, 100100 e 100200 aplicadas.
--
-- O QUE PASSA A VALER (matriz aprovada, docs/MATRIZ-CARGOS.md):
--  1. papel_comercial(): Vendedor e Atendente com cargo PRÓPRIO (não viram
--     Closer/SDR). Toda checagem "= 'gerente'" continua negando a eles.
--  2. Equipe/metas/dashboard: mapeamento explícito de cada cargo (antes,
--     "qualquer outro" virava 'gerente'); Vendedor entra nas vendas como Closer.
--  3. Metas individuais TCV/MRR: Closer e Vendedor.
--  4. Teto do handoff (Reunião realizada): SDR e Atendente.
--  5. Atendente (trigger próprio): só negociações atribuídas a ele ou da sua
--     carteira; não transfere responsável; só move entre etapas ABERTAS que o
--     Gerente liberou (origem e destino); nunca Fechada/Ganha ou Perdida, então
--     nenhuma operação de fechamento passa. Além disso, como hoje, precisa da
--     permissão individual de mover (Usuários → Permissões).
--  6. Fechamento direto pela API (tabela fechamentos) e exclusão de
--     negociação: nunca SDR nem Atendente; arquivar cliente: nunca o
--     Atendente. Conversas continuam como hoje
--     (fila da empresa para o Atendente segue só como proposta).
--  7. Agenda: SDR e Atendente agendam para Closer ativo da MESMA empresa;
--     quem criou vê e edita o que agendou; ocupação dos Closers (só horários)
--     para o aviso de conflito.
--  8. Metas de reuniões do SDR: Gerente configura; SDR vê as próprias.
--  9. Dados da empresa pelo Gerente: só logo, telefone, e-mail e responsável.
--
-- Tudo o que não está acima continua NEGADO por padrão.
-- ===========================================================================

do $$
begin
  if to_regclass('public.metas_reunioes') is null then
    raise exception 'Aplique antes 100200 (estrutura dos cargos).';
  end if;
  if to_regprocedure('public.papel_do_cargo(public.tenant_papel)') is not null then
    raise exception 'Ativação dos cargos já aplicada.';
  end if;
end $$;

-- 1. Cargo de cada vínculo, sem "qualquer outro vira gerente" ----------------
create function public.papel_do_cargo(p public.tenant_papel)
returns public.user_role
language sql
immutable
set search_path = ''
as $$
  select case p
           when 'admin_empresa' then 'gerente'
           when 'gerente'       then 'gerente'
           when 'sdr'           then 'sdr'
           when 'closer'        then 'closer'
           when 'vendedor'      then 'vendedor'
           when 'atendente'     then 'atendente'
         end::public.user_role;
$$;

create or replace function public.papel_comercial(p_user uuid, p_tenant uuid)
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select public.papel_do_cargo(m.papel)
    from public.tenant_memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = p_tenant
     and m.user_id = p_user
     and m.ativo
     and p.ativo;
$$;

-- 2/3. Equipe, metas e dashboard ---------------------------------------------
CREATE OR REPLACE FUNCTION public.membros_empresa_atual()
 RETURNS TABLE(usuario_id uuid, papel tenant_papel, role user_role, ativo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.user_id,
         m.papel,
         public.papel_do_cargo(m.papel),
         (m.ativo and p.ativo)
    from public.tenant_memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = public.tenant_atual();
$function$;

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
   where (public.is_gerente() or (p.id = (select auth.uid()) and p.role in ('closer', 'vendedor')))
     and ((p.role in ('closer', 'vendedor') and p.ativo) or mt.id is not null or mm.id is not null
          or vt.valor is not null or vm.valor is not null);
$function$;

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
   where (public.is_gerente() or (p.id = (select auth.uid()) and p.role in ('closer', 'vendedor')))
     and ((p.role in ('closer', 'vendedor') and p.ativo) or vt.valor is not null or vm.valor is not null);
$function$;

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
  where (p.ativo and public.papel_comercial(p.id, public.tenant_atual()) in ('closer', 'vendedor'))
     or p.id = (select auth.uid())
     or ab.qtd > 0 or g.qtd > 0 or pe.qtd > 0 or er.qtd > 0
  order by coalesce(g.valor, 0) desc, p.nome;
$function$;

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
       and coalesce(public.papel_comercial(new.usuario_id, new.tenant_id)::text, '') not in ('closer', 'vendedor') then
      raise exception 'Metas individuais (TCV/MRR) são apenas para closers e vendedores.' using errcode = '23514';
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
$function$;

-- 4. Teto do handoff: SDR e Atendente ----------------------------------------
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
  if coalesce(public.papel_comercial((select auth.uid()), new.tenant_id)::text, '') not in ('sdr', 'atendente') then
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
      raise exception 'SDR e Atendente não podem movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
        using errcode = '42501';
    end if;
  end if;

  if v_ordem_destino > v_limite_ordem then
    raise exception 'SDR e Atendente não podem movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- 5. Regras do Atendente nas negociações -------------------------------------
create function public.negociacoes_regras_atendente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu      uuid := (select auth.uid());
  v_dono_cli uuid;
  v_origem  public.etapas_funil%rowtype;
  v_destino public.etapas_funil%rowtype;
begin
  if v_eu is null
     or public.papel_comercial(v_eu, new.tenant_id)::text is distinct from 'atendente' then
    return new;
  end if;

  select c.owner_id into v_dono_cli from public.clientes c where c.id = old.cliente_id;
  if old.owner_id is distinct from v_eu and v_dono_cli is distinct from v_eu then
    raise exception 'Atendente só altera negociações atribuídas a ele ou da sua carteira.' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Atendente não transfere a negociação para outro responsável.' using errcode = '42501';
  end if;
  -- Arquivar/desqualificar encerra a negociação: não está entre as permissões
  -- aprovadas do Atendente (negado por padrão; liberar seria nova proposta).
  if new.arquivada_em is distinct from old.arquivada_em then
    raise exception 'Atendente não arquiva nem desqualifica negociações.' using errcode = '42501';
  end if;

  if new.etapa_id is distinct from old.etapa_id then
    select * into v_origem  from public.etapas_funil where id = old.etapa_id;
    select * into v_destino from public.etapas_funil where id = new.etapa_id;
    if v_destino.tipo <> 'aberta' then
      raise exception 'Atendente não fecha negociações (Ganha/Perdida é com o Closer, Vendedor ou Gerente).' using errcode = '42501';
    end if;
    if not coalesce(v_origem.atendente_pode_mover, false) or not coalesce(v_destino.atendente_pode_mover, false) then
      raise exception 'Etapa não liberada para Atendentes. Peça ao gerente para liberar em Configurações do funil → Etapas.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.negociacoes_regras_atendente() from public, anon, authenticated;
create trigger negociacoes_regras_atendente before update on public.negociacoes
  for each row execute function public.negociacoes_regras_atendente();

-- 6. Fechamento e exclusão: nunca SDR nem Atendente --------------------------
-- O teto do handoff já impede mover para Ganha/Perdida; isto fecha o atalho de
-- gravar/anular um fechamento direto na tabela, ou apagar a negociação.
create function public.cargos_sem_fechamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu     uuid := (select auth.uid());
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  -- Arquivar o cliente inteiro encerraria as negociações dele: o Atendente não
  -- arquiva (nem restaura) clientes. SDR continua como hoje.
  if tg_table_name = 'clientes' then
    if v_eu is not null and new.deleted_at is distinct from old.deleted_at
       and public.papel_comercial(v_eu, v_tenant)::text = 'atendente' then
      raise exception 'Atendente não arquiva clientes.' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_eu is not null
     and coalesce(public.papel_comercial(v_eu, v_tenant)::text, '') in ('sdr', 'atendente') then
    if tg_table_name = 'fechamentos' then
      raise exception 'SDR e Atendente não registram nem alteram fechamentos.' using errcode = '42501';
    end if;
    raise exception 'SDR e Atendente não excluem negociações.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.cargos_sem_fechamento() from public, anon, authenticated;
create trigger cargos_sem_fechamento before insert or update or delete on public.fechamentos
  for each row execute function public.cargos_sem_fechamento();
create trigger cargos_sem_exclusao before delete on public.negociacoes
  for each row execute function public.cargos_sem_fechamento();
create trigger cargos_sem_arquivar_cliente before update of deleted_at on public.clientes
  for each row execute function public.cargos_sem_fechamento();

-- 7. Agenda -------------------------------------------------------------------
-- Quem pode ser o responsável de uma reunião criada/alterada por mim:
-- eu mesmo; qualquer membro, se sou Gerente; um Closer ativo da empresa, se
-- sou SDR ou Atendente. Nunca alguém de outra empresa.
create function public.agenda_pode_definir_responsavel(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_usuario = (select auth.uid())
      or public.is_gerente()
      or (public.papel_comercial((select auth.uid()), public.tenant_atual()) in ('sdr', 'atendente')
          and public.papel_comercial(p_usuario, public.tenant_atual()) = 'closer');
$$;

create or replace function public.agenda_valida_responsavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      public.user_role := public.papel_comercial(new.usuario_id, new.tenant_id);
  v_eu        uuid := (select auth.uid());
  v_meu       public.user_role := public.papel_comercial((select auth.uid()), new.tenant_id);
  v_dono_cli  uuid;
begin
  if v_role is null then
    raise exception 'O responsável precisa ser um usuário ativo desta empresa.' using errcode = '23514';
  end if;

  -- Para outra pessoa: Gerente (qualquer membro) ou SDR/Atendente (só Closer).
  if v_eu is not null and new.usuario_id <> v_eu and v_meu is distinct from 'gerente'
     and not (v_meu in ('sdr', 'atendente') and v_role = 'closer') then
    raise exception 'Você só pode agendar para você mesmo%.',
      case when v_meu in ('sdr', 'atendente') then ' ou para um Closer da empresa' else '' end
      using errcode = '42501';
  end if;

  if new.cliente_id is not null and v_role <> 'gerente' then
    select c.owner_id into v_dono_cli from public.clientes c
     where c.id = new.cliente_id and c.tenant_id = new.tenant_id;
    -- Responsável dono da carteira; ou SDR/Atendente passando o PRÓPRIO lead a um Closer.
    if v_dono_cli is distinct from new.usuario_id
       and not (v_meu in ('sdr', 'atendente') and v_role = 'closer' and v_dono_cli = v_eu) then
      raise exception 'O responsável precisa ter acesso ao cliente (dono da carteira ou gerente).' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop policy eventos_select on public.eventos;
create policy eventos_select on public.eventos for select to authenticated
  using (usuario_id = (select auth.uid()) or criado_por = (select auth.uid()) or public.is_gerente());

drop policy eventos_insert on public.eventos;
create policy eventos_insert on public.eventos for insert to authenticated
  with check (
    public.agenda_pode_definir_responsavel(usuario_id)
    and (cliente_id is null or public.cliente_owner(cliente_id) = (select auth.uid()) or public.is_gerente())
    and (negociacao_id is null or public.negociacao_owner(negociacao_id) = (select auth.uid()) or public.is_gerente())
  );

drop policy eventos_update on public.eventos;
create policy eventos_update on public.eventos for update to authenticated
  using (usuario_id = (select auth.uid()) or criado_por = (select auth.uid()) or public.is_gerente())
  with check (
    public.agenda_pode_definir_responsavel(usuario_id)
    -- o responsável mantém o vínculo de cliente que recebeu; vínculo NOVO passa pelo trigger
    and (cliente_id is null or public.cliente_owner(cliente_id) = (select auth.uid()) or public.is_gerente()
         or usuario_id = (select auth.uid()))
    and (negociacao_id is null or public.negociacao_owner(negociacao_id) = (select auth.uid()) or public.is_gerente()
         or usuario_id = (select auth.uid()))
  );

drop policy eventos_delete on public.eventos;
create policy eventos_delete on public.eventos for delete to authenticated
  using ((usuario_id = (select auth.uid()) or criado_por = (select auth.uid()) or public.is_gerente())
         and status in ('agendado', 'confirmado'));

drop policy eventos_series_select on public.eventos_series;
create policy eventos_series_select on public.eventos_series for select to authenticated
  using (usuario_id = (select auth.uid()) or criado_por = (select auth.uid()) or public.is_gerente());

drop policy eventos_series_insert on public.eventos_series;
create policy eventos_series_insert on public.eventos_series for insert to authenticated
  with check (
    public.agenda_pode_definir_responsavel(usuario_id)
    and (cliente_id is null or public.cliente_owner(cliente_id) = (select auth.uid()) or public.is_gerente())
    and (negociacao_id is null or public.negociacao_owner(negociacao_id) = (select auth.uid()) or public.is_gerente())
  );

drop policy eventos_series_update on public.eventos_series;
create policy eventos_series_update on public.eventos_series for update to authenticated
  using (usuario_id = (select auth.uid()) or criado_por = (select auth.uid()) or public.is_gerente())
  with check (
    public.agenda_pode_definir_responsavel(usuario_id)
    and (cliente_id is null or public.cliente_owner(cliente_id) = (select auth.uid()) or public.is_gerente()
         or usuario_id = (select auth.uid()))
    and (negociacao_id is null or public.negociacao_owner(negociacao_id) = (select auth.uid()) or public.is_gerente()
         or usuario_id = (select auth.uid()))
  );

-- Disponibilidade: só INÍCIO e FIM (sem título, cliente ou descrição) das
-- reuniões dos Closers da empresa, para quem agenda para eles.
create function public.agenda_ocupacao(p_inicio timestamptz, p_fim timestamptz)
returns table (usuario_id uuid, inicio timestamptz, fim timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.usuario_id, e.inicio, e.fim
    from public.eventos e
   where e.tenant_id = public.tenant_atual()
     and public.papel_comercial((select auth.uid()), e.tenant_id) in ('gerente', 'sdr', 'atendente')
     and (public.papel_comercial(e.usuario_id, e.tenant_id) = 'closer' or e.usuario_id = (select auth.uid()))
     and e.status <> 'cancelado'
     and e.inicio < p_fim and e.fim > p_inicio
     and p_fim - p_inicio <= interval '62 days';
$$;

-- 8. Metas de reuniões --------------------------------------------------------
create policy metas_reunioes_select on public.metas_reunioes for select to authenticated
  using (usuario_id = (select auth.uid()) or public.is_gerente());
create policy metas_reunioes_insert on public.metas_reunioes for insert to authenticated
  with check (public.is_gerente());
create policy metas_reunioes_update on public.metas_reunioes for update to authenticated
  using (public.is_gerente()) with check (public.is_gerente());
create policy metas_reunioes_delete on public.metas_reunioes for delete to authenticated
  using (public.is_gerente());

-- Critério de contagem (sem dupla contagem):
--  * conta para o SDR que CRIOU a reunião (criado_por), não para o responsável;
--  * só reunião/apresentação com lead (cliente) ou marcada para outra pessoa
--    (reunião interna dele mesmo não conta);
--  * agendadas: criadas no mês, exceto canceladas;
--  * realizadas: marcadas como "realizado", com início no mês;
--  * reagendar é editar a MESMA reunião (conta uma vez); série recorrente
--    conta UMA vez por mês (não uma por ocorrência).
create function public.metas_reunioes_progresso(p_mes date)
returns table (usuario_id uuid, nome text, ativo boolean,
               meta_agendadas integer, meta_realizadas integer, agendadas bigint, realizadas bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with
  ctx as (
    select public.tenant_atual() as t, (select auth.uid()) as eu,
           public.papel_comercial((select auth.uid()), public.tenant_atual()) as meu
  ),
  janela as (
    select date_trunc('month', p_mes)::date as mes,
           (date_trunc('month', p_mes)::date::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((date_trunc('month', p_mes)::date + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') as fim
  ),
  sdrs as (
    select p.id, p.nome, (p.ativo and m.ativo) as ativo
      from public.tenant_memberships m
      join public.profiles p on p.id = m.user_id
      cross join ctx
     where m.tenant_id = ctx.t and m.papel = 'sdr'
       and (ctx.meu = 'gerente' or (ctx.meu = 'sdr' and p.id = ctx.eu))
  ),
  base as (
    select e.criado_por, coalesce(e.serie_id, e.id) as chave, e.status, e.created_at, e.inicio
      from public.eventos e
      cross join ctx
     where e.tenant_id = ctx.t
       and e.tipo in ('reuniao', 'apresentacao')
       and e.criado_por in (select s.id from sdrs s)
       and (e.cliente_id is not null or e.usuario_id <> e.criado_por)
  ),
  ag as (
    select b.criado_por, count(distinct b.chave) as qtd from base b cross join janela j
     where b.status <> 'cancelado' and b.created_at >= j.ini and b.created_at < j.fim
     group by b.criado_por
  ),
  re as (
    select b.criado_por, count(distinct b.chave) as qtd from base b cross join janela j
     where b.status = 'realizado' and b.inicio >= j.ini and b.inicio < j.fim
     group by b.criado_por
  )
  select s.id, s.nome, s.ativo,
         coalesce(mr.meta_agendadas, 0), coalesce(mr.meta_realizadas, 0),
         coalesce(ag.qtd, 0), coalesce(re.qtd, 0)
    from sdrs s
    cross join janela j
    cross join ctx
    left join public.metas_reunioes mr
      on mr.tenant_id = ctx.t and mr.usuario_id = s.id and mr.periodo_mes = j.mes
    left join ag on ag.criado_por = s.id
    left join re on re.criado_por = s.id
   where ctx.t is not null
     and (s.ativo or mr.id is not null or ag.qtd is not null or re.qtd is not null)
   order by s.nome;
$$;

-- 9. Dados da empresa pelo Gerente (só contato e logo) ----------------------
create function public.empresa_atualizar_contato(
  p_telefone text, p_email text, p_responsavel_nome text, p_logo_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.tenant_exigir();
begin
  if not public.tem_papel_no_tenant(v_tenant, array['admin_empresa', 'gerente']::public.tenant_papel[]) then
    raise exception 'Somente o gerente da empresa altera estes dados.' using errcode = '42501';
  end if;
  if not public.pode_escrever_no_tenant(v_tenant) then
    raise exception 'Empresa somente leitura.' using errcode = '42501';
  end if;

  -- Nome, endereço (slug), tipo, situação e assinatura NÃO passam por aqui.
  update public.tenants
     set telefone = nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), ''),
         email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         responsavel_nome = nullif(btrim(coalesce(p_responsavel_nome, '')), ''),
         logo_path = nullif(btrim(coalesce(p_logo_path, '')), '')
   where id = v_tenant;

  perform public.registrar_auditoria('empresa_contato_alterado', v_tenant,
    jsonb_build_object('logo', p_logo_path is not null));
end;
$$;

revoke all on function public.papel_do_cargo(public.tenant_papel) from public, anon;
revoke all on function public.agenda_pode_definir_responsavel(uuid) from public, anon;
revoke all on function public.agenda_ocupacao(timestamptz, timestamptz) from public, anon;
revoke all on function public.metas_reunioes_progresso(date) from public, anon;
revoke all on function public.empresa_atualizar_contato(text, text, text, text) from public, anon;
grant execute on function public.papel_do_cargo(public.tenant_papel) to authenticated, service_role;
grant execute on function public.agenda_pode_definir_responsavel(uuid) to authenticated;
grant execute on function public.agenda_ocupacao(timestamptz, timestamptz) to authenticated;
grant execute on function public.metas_reunioes_progresso(date) to authenticated;
grant execute on function public.empresa_atualizar_contato(text, text, text, text) to authenticated;
