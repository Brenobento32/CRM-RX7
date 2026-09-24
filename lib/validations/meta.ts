import { z } from 'zod'

import { mesValido } from '@/lib/utils/periodo'
import { valorEmReais } from '@/lib/validations/negociacao'

/** Meta da empresa ou o id de um closer. */
export const ALVO_EMPRESA = 'empresa'

const valorMeta = valorEmReais.pipe(
  z
    .string('Informe o valor da meta.')
    .refine((v) => Number(v) > 0, 'A meta deve ser maior que zero.'),
)

export const criarMetaSchema = z.object({
  alvo: z.union([z.literal(ALVO_EMPRESA), z.uuid()], 'Escolha para quem é a meta.'),
  mes: z.string().refine(mesValido, 'Mês inválido.'),
  valor_meta: valorMeta,
})

/** Editar muda só o valor: alvo e mês são fixos (o banco também recusa). */
export const editarMetaSchema = z.object({ valor_meta: valorMeta })

export type CriarMetaInput = z.output<typeof criarMetaSchema>
export type EditarMetaInput = z.output<typeof editarMetaSchema>
export type CampoMeta = keyof z.input<typeof criarMetaSchema>
