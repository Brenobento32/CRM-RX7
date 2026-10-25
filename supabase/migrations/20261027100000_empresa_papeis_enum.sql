-- ===========================================================================
-- PROPOSTA (NÃO APLICADA) — ESTRUTURA 1/3: valores dos cargos Vendedor e Atendente.
--
-- Fica em `supabase/propostas/` de propósito: nenhum `db push` aplica daqui.
-- Ordem: 100000 (este) → 100100 (empresa) → 100200 (estrutura dos cargos)
-- → 100300 (ATIVAÇÃO das permissões). Cada arquivo numa transação própria:
-- o Postgres não deixa usar um valor de enum novo na mesma transação em que
-- ele foi criado.
--
-- Só o valor entra aqui; nenhuma permissão. Vendedor e Atendente são cargos
-- DISTINTOS (não equivalem a Closer/SDR). Até a ativação (100300),
-- `papel_comercial()` devolve nulo para eles = nenhum acesso comercial.
--
--   tenant_papel: o vínculo com a empresa (quem é o quê nesta empresa).
--   user_role:    o "papel comercial" que todas as regras do banco consultam.
-- ===========================================================================

alter type public.tenant_papel add value if not exists 'vendedor';
alter type public.tenant_papel add value if not exists 'atendente';
alter type public.user_role add value if not exists 'vendedor';
alter type public.user_role add value if not exists 'atendente';
