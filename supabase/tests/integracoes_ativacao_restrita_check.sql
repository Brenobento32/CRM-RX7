set client_encoding = 'UTF8'; -- arquivo em UTF-8
-- ===========================================================================
-- Conferência da LIBERAÇÃO RESTRITA do Google Sheets (SOMENTE LEITURA).
-- Rodar logo depois de:
--   insert into public.plataforma_integracoes_empresas (tipo, tenant_id)
--   select 'google_sheets', id from public.tenants where slug = '<slug da Empresa Teste A>';
-- Uso: psql ... -v slug=<slug> -At -f supabase/tests/integracoes_ativacao_restrita_check.sql
-- Cada linha: ok|... ou FALHOU|...  (sem dados pessoais)
-- ===========================================================================
\pset footer off
with alvo as (select id from public.tenants where slug = :'slug'),
c(nome, ok) as (
  select 'empresa de homologação encontrada', (select count(*) = 1 from alvo)
  union all select 'chaves globais continuam desligadas',
         (select not google_sheets and not whatsapp_oficial and not meta_conversoes from public.plataforma_integracoes)
  union all select 'lista de liberação = só Google Sheets da empresa de homologação',
         (select count(*) = 1 from public.plataforma_integracoes_empresas)
     and exists (select 1 from public.plataforma_integracoes_empresas e join alvo on alvo.id = e.tenant_id where e.tipo = 'google_sheets')
  union all select 'Google ligado para a empresa de homologação', (select public.integracao_habilitada('google_sheets', id) from alvo)
  union all select 'Google desligado para TODAS as outras empresas',
         not exists (select 1 from public.tenants t where t.id <> (select id from alvo) and public.integracao_habilitada('google_sheets', t.id))
  union all select 'WhatsApp oficial desligado para todas as empresas',
         not exists (select 1 from public.tenants t where public.integracao_habilitada('whatsapp_oficial', t.id))
  union all select 'Meta Ads desligado para todas as empresas',
         not exists (select 1 from public.tenants t where public.integracao_habilitada('meta_conversoes', t.id))
  union all select 'liberação registrada na auditoria',
         exists (select 1 from public.admin_auditoria a join alvo on alvo.id = a.tenant_id where a.acao = 'plataforma_integracao_empresa_liberada')
  union all select 'plano da empresa de homologação permite fonte Google Sheets (ingestao_leads) ou não há plano',
         (select p.id is null or 'ingestao_leads' = any (p.recursos) from alvo left join public.assinaturas a on a.tenant_id = alvo.id
            left join public.planos p on p.id = a.plano_id)
  union all select 'nenhum número WhatsApp nem conexão Meta Ads existe',
         (select count(*) = 0 from public.whatsapp_numeros) and (select count(*) = 0 from public.meta_conversoes_conexoes)
)
select case when ok then 'ok' else 'FALHOU' end || '|' || nome from c;
