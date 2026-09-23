import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import { valorEmReais } from '@/lib/validations/negociacao'

type Enums = Database['public']['Enums']

export const ETAPAS = Constants.public.Enums.etapa_funil

/** Etapas que só se alcançam pelo modal, nunca por um simples arrastar. */
export const ETAPAS_COM_MODAL = ['fechado', 'perdido'] as const satisfies readonly Enums['etapa_funil'][]

export function exigeModal(etapa: Enums['etapa_funil']): etapa is 'fechado' | 'perdido' {
  return (ETAPAS_COM_MODAL as readonly string[]).includes(etapa)
}

/**
 * Status oferecidos no fechamento. `atrasado` existe no banco, mas não faz
 * sentido no momento em que o negócio acabou de ser fechado.
 */
export const STATUS_PAGAMENTO_FECHAMENTO = [
  'pendente',
  'parcial',
  'pago',
  'cancelado',
] as const satisfies readonly Enums['status_pagamento'][]

export const ROTULO_STATUS_PAGAMENTO: Record<Enums['status_pagamento'], string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

export const STATUS_ONBOARDING = Constants.public.Enums.status_onboarding

export const ROTULO_STATUS_ONBOARDING: Record<Enums['status_onboarding'], string> = {
  nao_iniciado: 'Não iniciado',
  em_andamento: 'Em andamento',
  concluido: 'Finalizado',
}

const posicao = z.coerce.number('Posição inválida.').refine(Number.isFinite, 'Posição inválida.')

/**
 * Arrastar o card. Para fechado/perdido, só reordena um card que já está na
 * coluna — entrar nelas exige o modal (ver `fechamentoSchema` / `perdaSchema`).
 */
export const moverSchema = z.object({
  id: z.uuid(),
  etapa: z.enum(ETAPAS, 'Etapa inválida.'),
  posicao,
  /**
   * Outros cards da coluna de destino com posição nova, quando o Kanban
   * precisou renumerar a coluna por falta de espaço entre os vizinhos.
   */
  reposicionar: z
    .array(z.object({ id: z.uuid(), posicao }))
    .max(1000, 'Coluna grande demais para renumerar.')
    .default([]),
})

const simNao = (mensagem: string) =>
  z.enum(['sim', 'nao'], mensagem).transform((v) => v === 'sim')

/**
 * Modal de fechamento. Todos os campos são obrigatórios, menos o link do
 * contrato. Os booleanos não têm default: o closer precisa responder.
 */
export const fechamentoSchema = z
  .object({
    negociacao_id: z.uuid(),
    posicao,
    valor_vendido: valorEmReais.pipe(
      z
        .string('Informe o valor vendido.')
        .refine((v) => Number(v) > 0, 'O valor vendido deve ser maior que zero.'),
    ),
    data_fechamento: z
      .iso.date('Informe a data de fechamento.')
      .refine((d) => d <= hojeSaoPaulo(), 'A data de fechamento não pode estar no futuro.'),
    contrato_enviado: simNao('Informe se o contrato foi enviado.'),
    contrato_assinado: simNao('Informe se o contrato foi assinado.'),
    link_contrato: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .pipe(
        z
          .url({ protocol: /^https?$/, error: 'Link inválido. Use um endereço http:// ou https://.' })
          .nullable(),
      ),
    status_pagamento: z.enum(STATUS_PAGAMENTO_FECHAMENTO, 'Selecione o status do pagamento.'),
    status_onboarding: z.enum(STATUS_ONBOARDING, 'Selecione o status do onboarding.'),
  })
  .superRefine((f, ctx) => {
    // Espelho da constraint fechamentos_assinatura_exige_envio.
    if (f.contrato_assinado && !f.contrato_enviado) {
      ctx.addIssue({
        code: 'custom',
        path: ['contrato_assinado'],
        message: 'Contrato assinado precisa ter sido enviado.',
      })
    }
  })

export type FechamentoInput = z.output<typeof fechamentoSchema>

export const perdaSchema = z.object({
  negociacao_id: z.uuid(),
  posicao,
  motivo_perda: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo da perda.')
    .max(2000, 'Máximo de 2000 caracteres.'),
})

export type PerdaInput = z.output<typeof perdaSchema>
