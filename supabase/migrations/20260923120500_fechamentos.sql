-- ===========================================================================
-- fechamentos — os dados obrigatórios ao fechar um cliente.
--
-- 1:1 com a negociação. Tabela separada (em vez de colunas anuláveis em
-- negociacoes) porque assim "fechado sem valor vendido" é um estado que o
-- banco não consegue representar, e não apenas um estado que o formulário
-- evita.
-- ===========================================================================

create table public.fechamentos (
  negociacao_id         uuid primary key references public.negociacoes (id) on delete cascade,
  valor_vendido         numeric(14, 2) not null check (valor_vendido > 0),
  contrato_enviado      boolean not null,
  contrato_enviado_em   timestamptz,
  contrato_assinado     boolean not null,
  contrato_assinado_em  timestamptz,
  status_pagamento      public.status_pagamento not null,
  status_onboarding     public.status_onboarding not null,
  fechado_por           uuid not null default auth.uid()
                          references public.profiles (id) on delete restrict,
  fechado_em            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint fechamentos_assinatura_exige_envio check (
    contrato_assinado is false or contrato_enviado is true
  )
);

comment on table public.fechamentos is
  'Os booleanos de contrato são NOT NULL sem DEFAULT de propósito: o '
  'formulário de fechamento precisa responder cada um explicitamente, em vez '
  'de herdar um "false" silencioso.';

create index fechamentos_fechado_em_idx  on public.fechamentos (fechado_em desc);
create index fechamentos_pagamento_idx   on public.fechamentos (status_pagamento);
create index fechamentos_onboarding_idx  on public.fechamentos (status_onboarding);

create trigger fechamentos_set_updated_at
  before update on public.fechamentos
  for each row
  execute function public.set_updated_at();

-- Carimba as datas de contrato quando o flag vira true, sem depender do form.
create or replace function public.fechamentos_carimba_contrato()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contrato_enviado and new.contrato_enviado_em is null then
    new.contrato_enviado_em := now();
  end if;

  if new.contrato_assinado and new.contrato_assinado_em is null then
    new.contrato_assinado_em := now();
  end if;

  return new;
end;
$$;

create trigger fechamentos_carimba_contrato
  before insert or update on public.fechamentos
  for each row
  execute function public.fechamentos_carimba_contrato();

-- ---------------------------------------------------------------------------
-- A regra central: etapa "fechado" exige registro de fechamento.
--
-- É um CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED, verificado no COMMIT.
-- Um trigger comum obrigaria a aplicação a inserir o fechamento antes de mover
-- o card; deferido, a ordem dentro da transação não importa — o que importa é
-- que, ao final dela, o estado seja coerente.
-- ---------------------------------------------------------------------------
create or replace function public.negociacoes_exige_fechamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.etapa = 'fechado'
     and not exists (
       select 1
       from public.fechamentos f
       where f.negociacao_id = new.id
     )
  then
    raise exception 'Negociação % não pode ir para "fechado" sem registro de fechamento (valor vendido, contrato enviado, contrato assinado, status de pagamento e onboarding).', new.id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger negociacoes_exige_fechamento
  after insert or update on public.negociacoes
  deferrable initially deferred
  for each row
  execute function public.negociacoes_exige_fechamento();

-- O outro lado da mesma invariante: não dá para apagar o fechamento e deixar
-- a negociação parada em "fechado".
create or replace function public.fechamentos_protege_negociacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.negociacoes n
    where n.id = old.negociacao_id
      and n.etapa = 'fechado'
  )
  then
    raise exception 'Tire a negociação % da etapa "fechado" antes de remover o registro de fechamento.', old.negociacao_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger fechamentos_protege_negociacao
  after delete on public.fechamentos
  deferrable initially deferred
  for each row
  execute function public.fechamentos_protege_negociacao();

-- ---------------------------------------------------------------------------
-- RLS — derivada da negociação: quem enxerga o card enxerga o fechamento.
-- ---------------------------------------------------------------------------
alter table public.fechamentos enable row level security;

create policy fechamentos_select on public.fechamentos
  for select
  to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy fechamentos_insert on public.fechamentos
  for insert
  to authenticated
  with check (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy fechamentos_update on public.fechamentos
  for update
  to authenticated
  using (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  )
  with check (
    public.negociacao_owner(negociacao_id) = (select auth.uid())
    or public.is_gerente()
  );

create policy fechamentos_delete on public.fechamentos
  for delete
  to authenticated
  using (public.is_gerente());

revoke all on table public.fechamentos from anon;
grant select, insert, update, delete on table public.fechamentos to authenticated;
