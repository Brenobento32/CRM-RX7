-- ===========================================================================
-- VULNERABILIDADE ENCONTRADA (auditoria "corrigir-cliente-leads-definitivo",
-- 2026-10-16, verificação pós-deploy de 20261016140000) — `anon` (e `public`)
-- tinham EXECUTE em `criar_negociacao(uuid, uuid, numeric,
-- temperatura_negociacao, origem_negociacao)`.
--
-- CAUSA: a assinatura de 5 parâmetros nasceu em 20261008100000
-- (`p_origem` novo) via `drop function` da assinatura antiga (4 parâmetros)
-- + `create or replace function` da nova — e o `revoke all ... from public,
-- anon` / `grant execute ... to authenticated` que existia pra assinatura
-- ANTIGA (20260929120000) nunca foi reaplicado à assinatura NOVA (são
-- objetos de função diferentes pro Postgres; GRANT/REVOKE não migram entre
-- assinaturas, mesma lição já documentada em outras migrations deste
-- projeto). Toda `create or replace function` seguinte (20261014160000,
-- 20261015140000, 20261016140000) herdou o buraco sem repeti-lo.
--
-- POR QUE ISSO FICOU MAIS GRAVE AGORA: 20261016140000 passou a tratar
-- `auth.uid() IS NULL` como "chamada automatizada, sempre autorizada" (pra
-- `criar_cliente_whatsapp`, que roda como `service_role` sem JWT de
-- usuário). Uma chamada com a chave `anon` TAMBÉM tem `auth.uid()` nulo (o
-- JWT da `anon key` não tem `sub`) — então, com EXECUTE liberado pra `anon`,
-- qualquer chamada não autenticada passava pela MESMA isenção e conseguia
-- criar uma negociação pra qualquer `cliente_id` existente, sem login.
--
-- CORREÇÃO: só GRANT/REVOKE — nenhuma linha do corpo da função muda, nenhuma
-- RLS, nenhuma trigger, nenhuma lógica de `auth.uid()`/`pode_mover_etapa`.
-- Mesmo padrão já usado por `criar_cliente`, `criar_ou_reaproveitar_cliente`
-- e `criar_cliente_whatsapp` (as 3 únicas outras RPCs de criação deste
-- fluxo, já confirmado que NÃO têm esse problema).
-- ===========================================================================

revoke all on function public.criar_negociacao(
  uuid, uuid, numeric, public.temperatura_negociacao, public.origem_negociacao
) from public, anon;

grant execute on function public.criar_negociacao(
  uuid, uuid, numeric, public.temperatura_negociacao, public.origem_negociacao
) to authenticated, service_role;
