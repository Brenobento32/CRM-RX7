set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Conferência LOGO APÓS as migrations 20261030100000 / 20261031090000 /
-- 20261031100000 (SOMENTE LEITURA). Cada linha: ok|... ou FALHOU|...
-- Nenhuma linha FALHOU = pode seguir. Serve no ensaio local e em produção.
-- ===========================================================================
\pset footer off
with c(nome, ok) as (
  -- 1. Nada ligado sozinho
  select 'chaves da plataforma nascem desligadas (google, whatsapp, meta)',
         (select not google_sheets and not whatsapp_oficial and not meta_conversoes from public.plataforma_integracoes)
  union all select 'uma única linha de chaves', (select count(*) = 1 from public.plataforma_integracoes)
  union all select 'nenhuma empresa liberada para homologação', (select count(*) = 0 from public.plataforma_integracoes_empresas)
  union all select 'nenhuma conta Google, planilha, número ou conexão Meta criada',
         (select count(*) = 0 from public.integracoes_contas_google) and (select count(*) = 0 from public.fontes_google_sheets)
     and (select count(*) = 0 from public.whatsapp_numeros) and (select count(*) = 0 from public.meta_conversoes_conexoes)
     and (select count(*) = 0 from public.meta_conversoes_eventos)
  union all select 'mensagens pagas desligadas', (select not permitir_mensagens_pagas from public.plataforma_regras_whatsapp)
  union all select 'nenhum plano ganhou o recurso meta_conversoes', not exists (select 1 from public.planos where 'meta_conversoes' = any (recursos))
  -- 2. Tabelas novas fechadas (RLS ligada, sem privilégio para anon/authenticated)
  union all select 'tabelas novas com RLS e sem privilégio de anon/authenticated',
         not exists (
           select 1 from pg_class t join pg_namespace n on n.oid = t.relnamespace
            where n.nspname = 'public' and t.relkind = 'r'
              and t.relname in ('plataforma_integracoes', 'plataforma_integracoes_empresas', 'integracoes_oauth_estados', 'integracoes_contas_google', 'fontes_google_sheets',
                                'fontes_google_sheets_linhas', 'plataforma_regras_whatsapp', 'whatsapp_numeros', 'whatsapp_consumo',
                                'whatsapp_franquia', 'meta_conversoes_conexoes', 'meta_conversoes_funis', 'meta_conversoes_mapeamento',
                                'meta_conversoes_eventos')
              and (not t.relrowsecurity
                   or has_table_privilege('anon', t.oid, 'select, insert, update, delete')
                   or has_table_privilege('authenticated', t.oid, 'select, insert, update, delete')))
  -- 3. Funções novas: nenhuma executável por anon; as de serviço, nem por authenticated
  union all select 'nenhuma função nova executável por anon',
         not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
              and (p.proname ~ '^(integracao_|integracoes_|google_|sheets_|whatsapp_|capi_|meta_conversoes_|plataforma_integracoes_)'
                   or p.proname in ('exigir_administrador_integracoes', 'usuario_administra_integracoes', 'exigir_integracao_habilitada',
                                    'ingerir_lead_integracao', 'fontes_leads_auditar_destino', 'mensagens_cloud_envio_controlado',
                                    'meta_lead_id_da_negociacao', 'admin_integracoes_empresa')))
  union all select 'funções de serviço fora do alcance do usuário logado',
         not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname in ('google_salvar_conta', 'google_obter_refresh_token', 'google_remover_conta', 'google_registrar_erro_conta',
                                'integracao_consumir_estado', 'ingerir_lead_integracao', 'sheets_reservar', 'sheets_processar_linhas',
                                'sheets_concluir', 'whatsapp_salvar_numero', 'whatsapp_obter_token', 'whatsapp_registrar_entrada',
                                'whatsapp_registrar_status', 'whatsapp_confirmar_envio', 'whatsapp_numeros_para_reconciliar',
                                'whatsapp_reconciliar_franquia', 'whatsapp_reconciliar_erro', 'capi_salvar_conexao', 'capi_reservar',
                                'capi_obter_token', 'capi_concluir', 'integracao_habilitada', 'meta_conversoes_elegivel',
                                'usuario_administra_integracoes'))
  union all select 'toda função SECURITY DEFINER nova tem search_path fixo',
         not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and (p.proname ~ '^(integracao_|integracoes_|google_|sheets_|whatsapp_|capi_|meta_conversoes_|plataforma_integracoes_)'
                   or p.proname in ('ingerir_lead_integracao', 'fontes_leads_auditar_destino', 'mensagens_cloud_envio_controlado'))
              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'))
  -- 4. Proteções existentes continuam ligadas
  union all select 'proteção de vínculos de Super Admin ativa',
         exists (select 1 from pg_trigger where tgname = 'tenant_memberships_protege_super_admin' and tgenabled <> 'D')
  union all select 'handoff SDR × Closer ativo', exists (select 1 from pg_trigger where tgname = 'negociacoes_valida_handoff_sdr' and tgenabled <> 'D')
  union all select 'responsável da negociação = dono do cliente (gatilho ativo)',
         exists (select 1 from pg_trigger where tgname = 'negociacoes_owner_do_cliente' and tgenabled <> 'D')
  union all select 'regras de destino das fontes ativas', exists (select 1 from pg_trigger where tgname = 'fontes_leads_regras' and tgenabled <> 'D')
  -- 5. Conversas legadas
  union all select 'conversas legadas: um por telefone na empresa (índice parcial sem número oficial)',
         exists (select 1 from pg_indexes where indexname = 'conversas_telefone_unica_tenant' and indexdef like '%(tenant_id, telefone)%whatsapp_numero_id IS NULL%')
  union all select 'nenhuma conversa legada ganhou número oficial', not exists (select 1 from public.conversas where whatsapp_numero_id is not null)
  union all select 'nenhuma mensagem legada marcada pela franquia', not exists (select 1 from public.mensagens where franquia_estado is not null)
)
select case when ok then 'ok' else 'FALHOU' end || '|' || nome from c;
