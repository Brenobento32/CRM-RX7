/**
 * Empresa ativa pela URL: `/e/<slug>/...`.
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

/** Header app → PostgREST, lido por `public.tenant_atual()`. */
export const HEADER_TENANT_BANCO = 'x-rx7-tenant'

/** Última empresa usada — só para completar URL sem prefixo; nunca autoriza nada. */
export const COOKIE_EMPRESA = 'rx7_empresa'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PREFIXO = /^\/e\/([^/]+)(\/.*)?$/

export function slugValido(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && slug.length <= 63 && SLUG.test(slug)
}

/** `/e/rio-x7/funil` → `{ slug: 'rio-x7', resto: '/funil' }`; sem prefixo válido → null. */
export function separarPrefixo(pathname: string): { slug: string; resto: string } | null {
  const m = PREFIXO.exec(pathname)
  if (!m || !slugValido(m[1])) return null
  return { slug: m[1], resto: m[2] || '/' }
}

export function caminhoDaEmpresa(slug: string, caminho = '/'): string {
  const resto = caminho.startsWith('/') ? caminho : `/${caminho}`
  return resto === '/' ? `/e/${slug}` : `/e/${slug}${resto}`
}
