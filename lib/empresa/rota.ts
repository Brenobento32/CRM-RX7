/**
 * Empresa ativa pela URL: `/<slug>/...` (formato atual) ou `/e/<slug>/...`
 * (formato antigo, mantido só para redirecionar links e favoritos).
 *
 * A empresa vem do caminho de cada requisição (cada aba tem a sua). O
 * `proxy.ts` tira o prefixo, reescreve para a rota interna e repassa o slug
 * num header interno. O app manda esse slug ao Supabase em cada chamada, e o
 * banco (`tenant_atual()`) só aceita se o usuário tiver vínculo ativo na
 * empresa. O slug na URL, no header ou no cookie é só uma escolha do usuário,
 * nunca uma autorização.
 *
 * Sem `server-only`: usado pelo proxy, pelo servidor e pelo browser.
 */

/** Header interno proxy → app. Qualquer valor vindo do browser é descartado. */
export const HEADER_EMPRESA = 'x-rx7-empresa'

/** Header interno proxy → app: a rota pedida dentro da empresa (`/agenda?dia=…`). Só informativo. */
export const HEADER_ROTA = 'x-rx7-rota'

/** Header app → PostgREST, lido por `public.tenant_atual()`. */
export const HEADER_TENANT_BANCO = 'x-rx7-tenant'

/** Última empresa usada — só para completar URL sem prefixo; nunca autoriza nada. */
export const COOKIE_EMPRESA = 'rx7_empresa'

/**
 * Primeiro segmento que NUNCA é empresa: rotas públicas, do sistema e todas as
 * rotas internas do app (a URL `/<slug>` divide o mesmo espaço que `/agenda`).
 * Tem de ser IGUAL à lista de `public.slug_reservado()` no banco — um teste
 * compara as duas e também confere que toda pasta de rota do `app/` está aqui.
 */
export const SLUGS_RESERVADOS: ReadonlySet<string> = new Set([
  // públicas / sistema
  'login', 'auth', 'admin', 'api', 'f', 'e', 'esqueci-senha', 'redefinir-senha',
  'sem-acesso', 'empresas', 'next', 'static', 'public', 'assets', 'favicon-ico',
  'robots-txt', 'sitemap-xml', 'www', 'app', 'suporte', 'ajuda', 'status',
  // área interna
  'inicio', 'agenda', 'funil', 'clientes', 'metas', 'propostas', 'relatorios',
  'configuracoes', 'perfil', 'negociacoes', 'conversas', 'leads', 'dashboard',
  'integracoes', 'usuarios', 'assinatura',
])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PREFIXO_LEGADO = /^\/e\/([^/]+)(\/.*)?$/
const PREFIXO = /^\/([^/]+)(\/.*)?$/

export function slugValido(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && slug.length <= 63 && SLUG.test(slug)
}

/** Slug que pode ser de empresa: formato válido e fora da lista de reservados. */
export function slugDeEmpresa(slug: string | null | undefined): slug is string {
  return slugValido(slug) && !SLUGS_RESERVADOS.has(slug)
}

export type Prefixo = { slug: string; resto: string; legado: boolean }

/**
 * `/rio-x7/funil` → `{ slug: 'rio-x7', resto: '/funil', legado: false }`;
 * `/e/rio-x7/funil` → o mesmo com `legado: true`; rota interna ou pública
 * (`/agenda`, `/login`), slug inválido ou reservado → null.
 */
export function separarPrefixo(pathname: string): Prefixo | null {
  const antigo = PREFIXO_LEGADO.exec(pathname)
  if (antigo) {
    return slugDeEmpresa(antigo[1]) ? { slug: antigo[1], resto: antigo[2] || '/', legado: true } : null
  }
  const m = PREFIXO.exec(pathname)
  if (!m || !slugDeEmpresa(m[1])) return null
  return { slug: m[1], resto: m[2] || '/', legado: false }
}

export function caminhoDaEmpresa(slug: string, caminho = '/'): string {
  const resto = caminho.startsWith('/') ? caminho : `/${caminho}`
  return resto === '/' ? `/${slug}` : `/${slug}${resto}`
}
