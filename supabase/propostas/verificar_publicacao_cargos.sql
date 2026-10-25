-- ===========================================================================
-- Conferência da publicação dos cargos — SOMENTE LEITURA.
-- Rodar inteiro no SQL Editor do CRM-RX7 (ybgzlxgeoiggmfdxarqx) ANTES do enum
-- e de novo DEPOIS da ativação; guardar as duas saídas. Sem timestamp no nome:
-- o Supabase CLI nunca aplica este arquivo.
-- ===========================================================================

-- 1. Etapa atual (antes: só a 1ª linha; depois: tudo "sim").
select 'ultima migration' as item, max(version) as valor from supabase_migrations.schema_migrations
union all select 'enum com vendedor/atendente',
  case when exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                     where t.typname = 'tenant_papel' and e.enumlabel = 'atendente') then 'sim' else 'nao' end
union all select 'estrutura (tenants.logo_path)',
  case when exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'tenants' and column_name = 'logo_path') then 'sim' else 'nao' end
union all select 'estrutura (metas_reunioes)', case when to_regclass('public.metas_reunioes') is not null then 'sim' else 'nao' end
union all select 'ativacao (papel_do_cargo)',
  case when to_regprocedure('public.papel_do_cargo(public.tenant_papel)') is not null then 'sim' else 'nao' end;

-- 2. Bloqueios (todas as contagens devem ser 0).
select 'empresa com slug reservado' as bloqueio, count(*) as qtd from public.tenants
 where lower(slug) = any (array['login','auth','admin','api','f','e','esqueci-senha','redefinir-senha',
   'sem-acesso','empresas','next','static','public','assets','favicon-ico','robots-txt','sitemap-xml','www',
   'app','suporte','ajuda','status','inicio','agenda','funil','clientes','metas','propostas','relatorios',
   'configuracoes','perfil','negociacoes','conversas','leads','dashboard','integracoes','usuarios','assinatura'])
union all select 'vinculo com papel desconhecido', count(*) from public.tenant_memberships
 where papel::text not in ('admin_empresa', 'gerente', 'sdr', 'closer', 'vendedor', 'atendente')
union all select 'vendedor/atendente antes da ativacao', count(*) from public.tenant_memberships
 where papel::text in ('vendedor', 'atendente')
   and to_regprocedure('public.papel_do_cargo(public.tenant_papel)') is null
union all select 'funcao com "qualquer outro vira gerente"', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc ~* 'else\s+''gerente'''
   and to_regprocedure('public.papel_do_cargo(public.tenant_papel)') is not null;

-- 3. Papéis hoje (só informativo).
select papel::text as papel, count(*) as vinculos, count(*) filter (where ativo) as ativos
  from public.tenant_memberships group by 1 order by 1;

-- 4. Histórico (os números de ANTES e DEPOIS precisam ser iguais).
select 'tenants' as tabela, count(*) as linhas from public.tenants
union all select 'clientes', count(*) from public.clientes
union all select 'negociacoes', count(*) from public.negociacoes
union all select 'fechamentos', count(*) from public.fechamentos
union all select 'eventos', count(*) from public.eventos
union all select 'metas', count(*) from public.metas
union all select 'atividades', count(*) from public.atividades
union all select 'historico_etapas', count(*) from public.historico_etapas
order by 1;
