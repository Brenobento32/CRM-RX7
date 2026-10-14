-- ===========================================================================
-- Papel SDR — só o valor novo do enum.
--
-- Migration separada de propósito (mesmo motivo de
-- 20260928120000_agenda_enums.sql): o Postgres não deixa USAR um valor de
-- enum na mesma transação em que ele foi criado ("unsafe use of new value").
-- A trava de handoff SDR -> CLOSER (que cita 'sdr' dentro do corpo de uma
-- function) fica na migration seguinte, 20261014150000_tcv_mrr_sdr.sql.
-- ===========================================================================

alter type public.user_role add value if not exists 'sdr';
