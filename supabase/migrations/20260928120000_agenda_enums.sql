-- ===========================================================================
-- Agenda 2.0 — N1 (1/2): valores novos de enum.
--
-- Migration separada de propósito: o Postgres não deixa USAR um valor de enum
-- na mesma transação em que ele foi criado ("unsafe use of new value"). As
-- funções e views da migration seguinte citam 'confirmado' e 'outro'.
--
--   confirmado  — reunião agendada e confirmada pelo cliente. Não gera
--                 timeline (só realizado / não compareceu geram).
--   outro       — compromisso que não é reunião, ligação nem follow-up.
--
-- `apresentacao` continua no enum para o histórico; o formulário novo não o
-- oferece.
-- ===========================================================================

alter type public.status_evento add value if not exists 'confirmado' after 'agendado';
alter type public.tipo_evento add value if not exists 'outro';
