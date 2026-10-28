set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Invariantes dos dados existentes (SOMENTE LEITURA): rodar ANTES e DEPOIS das
-- migrations 20261030100000, 20261031090000 e 20261031100000 e comparar.
-- A saída tem de ser IDÊNTICA. Colunas novas (nulas) das tabelas legadas são
-- descontadas do hash, para comparar só o que já existia.
--
-- Uso:  psql ... -At -f supabase/tests/integracoes_invariantes.sql > antes.txt
--       (aplica as migrations)
--       psql ... -At -f supabase/tests/integracoes_invariantes.sql > depois.txt
--       diff antes.txt depois.txt   → sem diferenças
-- ===========================================================================
\pset footer off
with t(nome, qtd, hash) as (
  select 'tenants', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.tenants x
  union all select 'tenant_memberships', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.tenant_id, x.user_id), '')) from public.tenant_memberships x
  union all select 'super_admins', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.user_id), '')) from public.super_admins x
  union all select 'profiles', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.profiles x
  union all select 'clientes', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.clientes x
  union all select 'negociacoes', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.negociacoes x
  union all select 'historico_etapas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.historico_etapas x
  union all select 'fechamentos', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.negociacao_id), '')) from public.fechamentos x
  union all select 'funis', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.funis x
  union all select 'etapas_funil', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.etapas_funil x
  union all select 'permissoes_colaborador', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) from public.permissoes_colaborador x
  union all select 'planos', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.planos x
  union all select 'assinaturas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.tenant_id), '')) from public.assinaturas x
  union all select 'fontes_leads', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.fontes_leads x
  union all select 'conversas', count(*),
    md5(coalesce(string_agg((to_jsonb(x) - array['whatsapp_numero_id', 'nome_contato', 'ultima_entrada_em', 'atendente_id'])::text, '|' order by x.id), ''))
    from public.conversas x
  union all select 'mensagens', count(*),
    md5(coalesce(string_agg((to_jsonb(x) - array['whatsapp_numero_id', 'cobravel', 'categoria_cobranca', 'status_detalhe', 'status_atualizado_em',
                                                  'franquia_mes', 'franquia_estado', 'preco_tipo'])::text, '|' order by x.id), ''))
    from public.mensagens x
  union all select 'admin_auditoria', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.admin_auditoria x
)
select nome || '|' || qtd || '|' || hash from t order by nome;

-- Recursos aceitos hoje por cada plano (só leitura)
select 'plano_recursos|' || codigo || '|' || array_to_string(recursos, ',') from public.planos order by codigo;
