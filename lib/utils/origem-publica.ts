/**
 * Destino de redirect montado no servidor, sempre no endereço PÚBLICO do AVANTE.
 *
 * Na Hostinger o Node recebe a requisição internamente (ex.: `0.0.0.0:3000`),
 * então `request.url`/`origin` NÃO é o endereço que o navegador usa — um
 * redirect montado com ele mandava a pessoa para `https://0.0.0.0:3000/...`.
 *
 * - `NEXT_PUBLIC_SITE_URL` válido (http/https) → URL absoluta nesse domínio
 *   (o mesmo usado no `redirectTo` dos e-mails do Auth).
 * - Variável ausente/ inválida, ou apontando para um host local em produção
 *   (`localhost`, `0.0.0.0`, `127.0.0.1`, `::1`) → caminho RELATIVO: o navegador
 *   resolve contra o domínio em que já está, então nunca sai para um endereço
 *   interno nem para outro site.
 *
 * `caminho` precisa já ter passado por `caminhoInternoSeguro` (começa com `/`,
 * nunca `//`). A referência a `process.env.NEXT_PUBLIC_SITE_URL` é literal para
 * o Next.js embutir o valor no build.
 */
const HOSTS_LOCAIS = new Set(['localhost', '0.0.0.0', '127.0.0.1', '[::1]', '::1'])

export function destinoPublico(
  caminho: string,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  producao: boolean = process.env.NODE_ENV === 'production',
): string {
  if (!caminho.startsWith('/') || caminho.startsWith('//')) caminho = '/'
  if (siteUrl) {
    try {
      const base = new URL(siteUrl)
      const protocoloOk = base.protocol === 'https:' || base.protocol === 'http:'
      const hostLocal = HOSTS_LOCAIS.has(base.hostname)
      if (protocoloOk && !(producao && hostLocal)) return new URL(caminho, base.origin).toString()
    } catch {
      // valor inválido: cai no caminho relativo
    }
  }
  return caminho
}
