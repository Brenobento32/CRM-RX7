-- ===========================================================================
-- `clientes` ganha os campos de exclusão — nunca `DELETE` físico. Excluir é
-- só preencher `excluido_em`/`excluido_por`/`motivo_exclusao`: a linha, as
-- negociações, fechamentos e histórico continuam intactos e vinculados.
--
-- Estado do cliente passa a ter 3 camadas, lidas pela DAL (a RLS não filtra
-- nenhuma delas, igual a `deleted_at` já funcionava):
--   ativo      — deleted_at is null
--   arquivado  — deleted_at is not null and excluido_em is null
--   excluído   — excluido_em is not null
-- Só se exclui quem já está arquivado; restaurar um excluído volta pra
-- arquivado (não pra ativo direto) — regra fica na DAL, não aqui.
-- Motivo é obrigatório ao excluir — a constraint abaixo garante isso mesmo
-- que a DAL um dia esqueça de validar.
-- ===========================================================================
alter table public.clientes
  add column excluido_em     timestamptz,
  add column excluido_por    uuid references public.profiles (id) on delete set null,
  add column motivo_exclusao text;

alter table public.clientes
  add constraint clientes_motivo_exclusao_obrigatorio
  check (excluido_em is null or motivo_exclusao is not null);

comment on column public.clientes.excluido_em is
  'Soft delete "definitivo" (nunca DELETE físico). A RLS não filtra por esta '
  'coluna — quem filtra é a DAL, igual a deleted_at.';
comment on column public.clientes.excluido_por is
  'Quem excluiu. Null se o profile foi apagado depois (on delete set null).';
comment on column public.clientes.motivo_exclusao is
  'Texto livre obrigatório ao excluir (ver constraint clientes_motivo_exclusao_obrigatorio).';
