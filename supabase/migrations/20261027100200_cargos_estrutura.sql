-- ===========================================================================
-- PROPOSTA (NÃO APLICADA) — ESTRUTURA 3/3: o que os cargos precisam existir.
-- NADA AQUI CONCEDE PERMISSÃO. A tabela nova nasce sem policy de acesso
-- (negado a todos); quem libera o uso é a ativação (100300).
--
-- 1. etapas_funil.atendente_pode_mover: etapas que o Gerente libera para
--    Atendentes movimentarem. Padrão: falso (negado). Só etapa ABERTA pode ser
--    marcada — Fechada/Ganha e Perdida nunca (constraint).
-- 2. eventos/eventos_series.criado_por: quem CRIOU a reunião (já existia, com
--    padrão auth.uid(), mas o navegador podia mandar outro valor). Agora é
--    sempre quem está logado na criação e não muda depois — base das metas de
--    reuniões do SDR e de "quem agendou para quem".
-- 3. metas_reunioes: metas de REUNIÕES (separadas das metas financeiras
--    TCV/MRR), por pessoa e mês: agendadas e realizadas.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'user_role' and e.enumlabel = 'atendente') then
    raise exception 'Aplique antes 100000 (cargos no enum).';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'etapas_funil' and column_name = 'atendente_pode_mover') then
    raise exception 'Estrutura dos cargos já aplicada.';
  end if;
end $$;

-- 1. Etapas liberadas para Atendentes ----------------------------------------
alter table public.etapas_funil
  add column atendente_pode_mover boolean not null default false;
alter table public.etapas_funil
  add constraint etapas_funil_atendente_so_aberta check (tipo = 'aberta' or not atendente_pode_mover);

comment on column public.etapas_funil.atendente_pode_mover is
  'Gerente libera a etapa para Atendentes movimentarem (origem e destino). Nunca em ganha/perdida.';

-- 2. criado_por confiável -----------------------------------------------------
create function public.agenda_criado_por()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Com sessão, é sempre quem está logado (o navegador não escolhe).
    if (select auth.uid()) is not null then
      new.criado_por := (select auth.uid());
    end if;
  elsif new.criado_por is distinct from old.criado_por then
    raise exception 'Quem criou a reunião não pode ser alterado.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.agenda_criado_por() from public, anon, authenticated;

create trigger _agenda_01_criado_por before insert or update on public.eventos
  for each row execute function public.agenda_criado_por();
create trigger _agenda_01_criado_por before insert or update on public.eventos_series
  for each row execute function public.agenda_criado_por();

-- 3. Metas de reuniões --------------------------------------------------------
create table public.metas_reunioes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  usuario_id       uuid not null references public.profiles (id) on delete cascade,
  periodo_mes      date not null,
  meta_agendadas   integer not null default 0,
  meta_realizadas  integer not null default 0,
  criado_por       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint metas_reunioes_mes check (periodo_mes = date_trunc('month', periodo_mes)::date),
  constraint metas_reunioes_valores check (meta_agendadas >= 0 and meta_realizadas >= 0
                                           and meta_agendadas <= 100000 and meta_realizadas <= 100000),
  constraint metas_reunioes_unica unique (tenant_id, usuario_id, periodo_mes)
);
create index metas_reunioes_periodo_idx on public.metas_reunioes (tenant_id, periodo_mes);

-- Empresa da requisição (nunca escolhida pelo navegador).
create function public.metas_reunioes_tenant_padrao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.tenant_id is null then
    new.tenant_id := public.tenant_atual();
  end if;
  return new;
end;
$$;
revoke all on function public.metas_reunioes_tenant_padrao() from public, anon, authenticated;

-- Só para SDR da mesma empresa; só a meta pode mudar depois de criada.
create function public.metas_reunioes_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.papel_comercial(new.usuario_id, new.tenant_id)::text is distinct from 'sdr' then
      raise exception 'Metas de reuniões são para SDRs ativos desta empresa.' using errcode = '23514';
    end if;
  elsif new.usuario_id is distinct from old.usuario_id
     or new.periodo_mes is distinct from old.periodo_mes
     or new.tenant_id is distinct from old.tenant_id
     or new.criado_por is distinct from old.criado_por then
    raise exception 'Só os valores de uma meta de reuniões podem ser alterados.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.metas_reunioes_regras() from public, anon, authenticated;

create trigger _tenant_05_padrao before insert on public.metas_reunioes
  for each row execute function public.metas_reunioes_tenant_padrao();
create trigger _tenant_20_validar before insert or update or delete on public.metas_reunioes
  for each row execute function public.tenant_validar_gravacao();
create trigger metas_reunioes_regras before insert or update on public.metas_reunioes
  for each row execute function public.metas_reunioes_regras();
create trigger metas_reunioes_set_updated_at before update on public.metas_reunioes
  for each row execute function public.set_updated_at();
create trigger zz_tenant_30_usuarios after insert or update on public.metas_reunioes
  for each row execute function public.tenant_validar_usuarios('usuario_id', 'criado_por');

alter table public.metas_reunioes enable row level security;
-- Isolamento por empresa (mesmo padrão das outras tabelas, RESTRICTIVE).
create policy metas_reunioes_tenant_ler on public.metas_reunioes as restrictive for select to authenticated
  using (tenant_id = (select public.tenant_atual()));
create policy metas_reunioes_tenant_incluir on public.metas_reunioes as restrictive for insert to authenticated
  with check (tenant_id = (select public.tenant_atual()) and public.pode_escrever_no_tenant(tenant_id));
create policy metas_reunioes_tenant_alterar on public.metas_reunioes as restrictive for update to authenticated
  using (tenant_id = (select public.tenant_atual()) and public.pode_escrever_no_tenant(tenant_id))
  with check (tenant_id = (select public.tenant_atual()) and public.pode_escrever_no_tenant(tenant_id));
create policy metas_reunioes_tenant_excluir on public.metas_reunioes as restrictive for delete to authenticated
  using (tenant_id = (select public.tenant_atual()) and public.pode_escrever_no_tenant(tenant_id));
-- (Sem policy PERMISSIVE: ninguém lê nem grava até a ativação.)

grant select, insert, update, delete on public.metas_reunioes to authenticated;
