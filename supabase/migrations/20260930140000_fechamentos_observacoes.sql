-- ===========================================================================
-- `fechamentos` ganha `observacoes` — campo livre e opcional para o closer
-- registrar contexto do fechamento (ex.: condições combinadas, ressalvas).
-- Nullable, sem default: fechamentos antigos ficam com observacoes = null.
-- ===========================================================================
alter table public.fechamentos
  add column observacoes text;

comment on column public.fechamentos.observacoes is
  'Texto livre e opcional sobre o fechamento. Preenchido no modal de fechamento.';
