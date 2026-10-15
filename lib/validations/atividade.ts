import { fromZonedTime } from 'date-fns-tz'
import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { FUSO_HORARIO } from '@/lib/utils/formatacao'

export const TIPOS_ATIVIDADE = Constants.public.Enums.tipo_atividade

export type TipoAtividade = Database['public']['Enums']['tipo_atividade']

export const ROTULO_TIPO_ATIVIDADE: Record<TipoAtividade, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao: 'Reunião',
  nota: 'Nota',
}

/** Tolerância para relógio do usuário adiantado em relação ao servidor. */
const FOLGA_FUTURO_MS = 5 * 60 * 1000

const negociacaoOpcional = z
  .string()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.uuid('Negociação inválida.').nullable())

/**
 * Registro de atividade. `data` chega de um `<input type="datetime-local">`
 * (horário de São Paulo, sem fuso) e sai como ISO em UTC para o timestamptz.
 */
export const atividadeSchema = z.object({
  tipo: z.enum(TIPOS_ATIVIDADE, 'Selecione o tipo.'),
  descricao: z
    .string()
    .trim()
    .min(1, 'Descreva a atividade.')
    .max(5000, 'Máximo de 5000 caracteres.'),
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Informe data e hora.')
    .transform((local) => fromZonedTime(local, FUSO_HORARIO))
    .refine((d) => !Number.isNaN(d.getTime()), 'Data inválida.')
    .refine(
      (d) => d.getTime() <= Date.now() + FOLGA_FUTURO_MS,
      'A atividade não pode estar no futuro. Para algo a fazer, use próxima ação.',
    )
    .transform((d) => d.toISOString()),
  negociacao_id: negociacaoOpcional,
})

export type AtividadeInput = z.output<typeof atividadeSchema>

/**
 * "Observação" rápida do card do Kanban: sempre `tipo='nota'`, sempre
 * amarrada à negociação do próprio card (nunca escolhida por `<select>`) —
 * por isso só pede a descrição, ao contrário de `atividadeSchema`.
 */
export const observacaoRapidaSchema = z.object({
  descricao: z
    .string()
    .trim()
    .min(1, 'Escreva a observação.')
    .max(5000, 'Máximo de 5000 caracteres.'),
})

export const proximaAcaoSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, 'Informe o que deve ser feito.')
    .max(200, 'Máximo de 200 caracteres.'),
  data: z.iso.date('Informe a data.'),
  observacao: z
    .string()
    .trim()
    .max(2000, 'Máximo de 2000 caracteres.')
    .transform((v) => (v === '' ? null : v)),
  negociacao_id: negociacaoOpcional,
})

export type ProximaAcaoInput = z.output<typeof proximaAcaoSchema>
