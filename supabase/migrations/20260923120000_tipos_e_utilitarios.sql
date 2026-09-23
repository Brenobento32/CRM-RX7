-- ===========================================================================
-- Tipos do domínio e utilitários compartilhados.
--
-- Os enums vivem no banco (e não como text + check) para que uma etapa
-- inválida seja impossível de gravar, venha de onde vier: aplicação, import
-- ou correção manual no dashboard.
-- ===========================================================================

create type public.user_role as enum (
  'gerente',
  'closer'
);

create type public.etapa_funil as enum (
  'reuniao_agendada',
  'reuniao_realizada',
  'proposta_enviada',
  'negociacao',
  'fechado',
  'perdido'
);

create type public.status_pagamento as enum (
  'pendente',
  'parcial',
  'pago',
  'atrasado'
);

create type public.status_onboarding as enum (
  'nao_iniciado',
  'em_andamento',
  'concluido'
);

create type public.tipo_evento as enum (
  'reuniao',
  'call',
  'followup'
);

create type public.status_evento as enum (
  'agendado',
  'realizado',
  'no_show',
  'cancelado'
);

create type public.tipo_atividade as enum (
  'nota',
  'ligacao',
  'email',
  'whatsapp',
  'reuniao'
);

-- Mantém `updated_at` correto mesmo quando a escrita não vem da aplicação.
-- `search_path = ''` evita que um schema malicioso no caminho de busca
-- sequestre a resolução de nomes dentro da função.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
