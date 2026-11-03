-- ===========================================================================
-- Venda comum: terceiro tipo de venda/meta, além de TCV e MRR.
--
-- Migration própria: o Postgres não deixa usar um valor de enum recém-criado
-- na mesma transação (mesmo padrão de 20261014140000_user_role_sdr.sql). O uso
-- do valor fica em 20261109090100_regras_comerciais_empresa.sql.
--
-- Nada é reclassificado: fechamentos e metas existentes continuam TCV, MRR ou
-- "não classificado" (NULL), como estavam.
-- ===========================================================================

alter type public.tipo_venda add value if not exists 'venda';

comment on type public.tipo_venda is
  'TCV (valor total de contrato), MRR (receita recorrente mensal) ou venda '
  '(venda comum, pontual). Classifica tanto a venda (fechamentos.tipo_venda) '
  'quanto a meta (metas.tipo_meta). Os três nunca se misturam: cada venda conta '
  'só para o seu tipo.';
