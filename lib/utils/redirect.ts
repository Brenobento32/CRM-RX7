/**
 * Devolve `destino` apenas se for um caminho interno da aplicação.
 *
 * O parâmetro `?next=` da tela de login vem da URL e pode ser forjado. Sem esta
 * checagem, um link como `/login?next=https://site-falso.com` levaria o usuário
 * recém-autenticado para fora do CRM (open redirect). `//dominio` também é
 * recusado porque o browser o interpreta como URL absoluta.
 */
export function caminhoInternoSeguro(
  destino: unknown,
  padrao = '/',
): string {
  if (typeof destino !== 'string') return padrao
  if (!destino.startsWith('/') || destino.startsWith('//')) return padrao
  if (destino.startsWith('/\\')) return padrao

  return destino
}
