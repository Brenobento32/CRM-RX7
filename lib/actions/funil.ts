'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  fecharNegociacao,
  marcarPerdida,
  moverNegociacao,
  type ResultadoFunil,
} from '@/lib/dal/funil'
import { fechamentoSchema, moverSchema, perdaSchema } from '@/lib/validations/funil'

export type EstadoModalFunil = {
  ok?: boolean
  erro?: string
  campos?: Record<string, string[] | undefined>
}

export async function moverNegociacaoAction(input: {
  id: string
  etapa: string
  posicao: number
  reposicionar?: { id: string; posicao: number }[]
}): Promise<ResultadoFunil> {
  const parsed = moverSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? 'Movimento inválido.' }
  }

  const { id, etapa, posicao, reposicionar } = parsed.data
  const resultado = await moverNegociacao(id, etapa, posicao, reposicionar)

  if (resultado.ok) revalidatePath('/funil')
  return resultado
}

/** Campos ausentes (radio sem escolha) viram '' para a mensagem do Zod. */
function lerCampos(formData: FormData, campos: readonly string[]) {
  return Object.fromEntries(campos.map((c) => [c, String(formData.get(c) ?? '')]))
}

export async function fecharNegociacaoAction(
  _estado: EstadoModalFunil | undefined,
  formData: FormData,
): Promise<EstadoModalFunil> {
  const parsed = fechamentoSchema.safeParse(
    lerCampos(formData, [
      'negociacao_id',
      'posicao',
      'valor_vendido',
      'data_fechamento',
      'contrato_enviado',
      'contrato_assinado',
      'link_contrato',
      'status_pagamento',
      'status_onboarding',
    ]),
  )

  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await fecharNegociacao(parsed.data)
  if (!resultado.ok) return { erro: resultado.mensagem }

  revalidatePath('/funil')
  return { ok: true }
}

export async function marcarPerdidaAction(
  _estado: EstadoModalFunil | undefined,
  formData: FormData,
): Promise<EstadoModalFunil> {
  const parsed = perdaSchema.safeParse(
    lerCampos(formData, ['negociacao_id', 'posicao', 'motivo_perda']),
  )

  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await marcarPerdida(parsed.data)
  if (!resultado.ok) return { erro: resultado.mensagem }

  revalidatePath('/funil')
  return { ok: true }
}
