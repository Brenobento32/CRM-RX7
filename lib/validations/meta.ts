import { z } from 'zod'

import { mesValido } from '@/lib/utils/periodo'
import { ROTULO_TIPO_VENDA, TIPOS_VENDA } from '@/lib/validations/funil'
import { valorEmReais } from '@/lib/validations/negociacao'

/** Meta da empresa ou o id de um closer. */
export const ALVO_EMPRESA = 'empresa'

/** `tipo_venda` no banco — mesmo enum que classifica uma venda (fechamentos.tipo_venda); fonte única em `lib/validations/funil.ts`. */
export const TIPOS_META = TIPOS_VENDA
export const ROTULO_TIPO_META = ROTULO_TIPO_VENDA

const valorMeta = valorEmReais.pipe(
  z
    .string('Informe o valor da meta.')
    .refine((v) => Number(v) > 0, 'A meta deve ser maior que zero.'),
)

export const criarMetaSchema = z.object({
  alvo: z.union([z.literal(ALVO_EMPRESA), z.uuid()], 'Escolha para quem é a meta.'),
  tipo_meta: z.enum(TIPOS_META, 'Escolha TCV ou MRR.'),
  mes: z.string().refine(mesValido, 'Mês inválido.'),
  valor_meta: valorMeta,
})

/** Editar muda só o valor: alvo, tipo e mês são fixos (o banco também recusa). */
export const editarMetaSchema = z.object({ valor_meta: valorMeta })

export type CriarMetaInput = z.output<typeof criarMetaSchema>
export type EditarMetaInput = z.output<typeof editarMetaSchema>
export type CampoMeta = keyof z.input<typeof criarMetaSchema>
