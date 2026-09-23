import 'server-only'

/**
 * Variáveis de ambiente restritas ao servidor.
 *
 * O `import 'server-only'` faz o build falhar se este módulo for importado
 * por um Client Component, o que impede que um segredo vaze para o bundle.
 */
export const serverEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
} as const
