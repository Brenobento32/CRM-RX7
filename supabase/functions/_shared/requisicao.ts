/**
 * Leitura segura do que vem na requisição das Edge Functions.
 * Puro: roda no Deno e no Node (testes).
 */

/** Header com o slug da empresa da aba (o mesmo que o app manda ao PostgREST). */
export const HEADER_TENANT = 'x-rx7-tenant'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CREDENCIAL = /^rx7_[0-9a-f]{32}_[0-9a-f]{64}$/

/** Slug válido do header, ou null. Não autoriza nada: o banco confere o vínculo. */
export function slugDaRequisicao(headers: Headers): string | null {
  const slug = headers.get(HEADER_TENANT)?.trim().toLowerCase() ?? ''
  return slug.length > 0 && slug.length <= 63 && SLUG.test(slug) ? slug : null
}

/**
 * Credencial de ingestão da empresa: só por header (`Authorization: Bearer`
 * ou `X-RX7-Credencial`) — nunca na URL, para não cair em log nem histórico.
 * Só confere o formato; o banco confere o segredo.
 */
export function credencialDaRequisicao(headers: Headers): string | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '')?.[1]
  const valor = (bearer?.startsWith('rx7_') ? bearer : headers.get('x-rx7-credencial'))?.trim() ?? ''
  return CREDENCIAL.test(valor) ? valor : null
}
