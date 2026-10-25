import { z } from 'zod'

/** Mesmo teto do banco (`metas_reunioes_valores`). */
export const META_REUNIOES_MAXIMO = 100000

/**
 * Quantidade de reuniões na meta do SDR. Vazio = não alterar aquela linha
 * (nunca "zerar" por engano); 0 é um valor válido e explícito.
 */
export const quantidadeMetaReunioes = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    if (!/^\d+$/.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'use um número inteiro (0 ou mais).' })
      return z.NEVER
    }
    const n = Number(v)
    if (n > META_REUNIOES_MAXIMO) {
      ctx.addIssue({ code: 'custom', message: `máximo de ${META_REUNIOES_MAXIMO}.` })
      return z.NEVER
    }
    return n
  })
