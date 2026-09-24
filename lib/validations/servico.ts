import { z } from 'zod'

/** Mesmos limites das constraints de `servicos`. */
export const servicoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome do serviço.')
    .max(80, 'Máximo de 80 caracteres.'),
  categoria: z
    .string()
    .trim()
    .max(60, 'Máximo de 60 caracteres.')
    .transform((v) => (v === '' ? null : v)),
})

export type ServicoInput = z.output<typeof servicoSchema>
export type CampoServico = keyof z.input<typeof servicoSchema>
