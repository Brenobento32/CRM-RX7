import { z } from 'zod'

import { CORES_ETAPA } from '@/lib/utils/etapas'

/** Mesmos limites da constraint `nichos.nome` (1 a 80 caracteres). */
export const nichoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome do nicho.')
    .max(80, 'Máximo de 80 caracteres.'),
  cor: z.enum(CORES_ETAPA, 'Escolha uma cor da paleta.'),
  /** Checkbox: presente ("on") quando marcado, ausente quando não. */
  ativo: z.string().transform((v) => v === 'on'),
})

export type NichoInput = z.output<typeof nichoSchema>
export type CampoNicho = keyof z.input<typeof nichoSchema>
