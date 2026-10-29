set client_encoding = 'UTF8'; -- arquivo em UTF-8 (acentos das mensagens)
-- ===========================================================================
-- Páginas públicas do AVANTE: /apresentacao, /privacidade e /termos.
--
-- A URL `/<slug>/...` da empresa divide o primeiro segmento com as rotas do
-- app. Estes três endereços passam a ser reservados (nenhuma empresa pode
-- usá-los), igual a `SLUGS_RESERVADOS` em lib/empresa/rota.ts.
-- Só troca a lista de `slug_reservado()`; nenhum dado é alterado.
-- ===========================================================================

do $$
begin
  if exists (select 1 from public.tenants where lower(slug) in ('apresentacao', 'privacidade', 'termos'))
     or exists (select 1 from public.tenant_slugs_antigos where lower(slug) in ('apresentacao', 'privacidade', 'termos')) then
    raise exception 'Há empresa usando apresentacao, privacidade ou termos como endereço: ajuste o endereço antes desta migration.';
  end if;
end;
$$;

create or replace function public.slug_reservado(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_slug) = any (array[
    -- públicas / sistema
    'login', 'auth', 'admin', 'api', 'f', 'e', 'esqueci-senha', 'redefinir-senha',
    'sem-acesso', 'empresas', 'next', 'static', 'public', 'assets', 'favicon-ico',
    'robots-txt', 'sitemap-xml', 'www', 'app', 'suporte', 'ajuda', 'status',
    'apresentacao', 'privacidade', 'termos',
    -- área interna
    'inicio', 'agenda', 'funil', 'clientes', 'metas', 'propostas', 'relatorios',
    'configuracoes', 'perfil', 'negociacoes', 'conversas', 'leads', 'dashboard',
    'integracoes', 'usuarios', 'assinatura'
  ]);
$$;
