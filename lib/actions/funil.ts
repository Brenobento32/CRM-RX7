'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  fecharNegociacao,
  marcarPerdida,
  moverNegociacao,
  type ResultadoFunil,
} from '@/lib/dal/funil'
import { listarHistoricoDaNegociacao } from '@/lib/dal/historico'
import { fechamentoSchema, moverSchema, perdaSchema } from '@/lib/validations/funil'
import type { LinhaHistoricoBruta } from '@/lib/utils/historico'

export type EstadoModalFunil = {
  ok?: boolean
  erro?: string
  campos?: Record<string, string[] | undefined>
}

export async function moverNegociacaoAction(input: {
  id: string
  etapaId: string
  posicao: number
  reposicionar?: { id: string; posicao: number }[]
}): Promise<ResultadoFunil> {
  const parsed = moverSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? 'Movimento inválido.' }
  }

  const { id, etapaId, posicao, reposicionar } = parsed.data
  const resultado = await moverNegociacao(id, etapaId, posicao, reposicionar)

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
  const parsed = fechamentoSchema.safeParse({
    ...lerCampos(formData, [
      'negociacao_id',
      'posicao',
      'valor_vendido',
      'data_fechamento',
      'contrato_enviado',
      'contrato_assinado',
      'link_contrato',
      'status_pagamento',
      'status_onboarding',
      'observacoes',
    ]),
    servico_ids: formData.getAll('servico_ids').map(String),
  })

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

/**
 * Histórico bruto de uma negociação, pro drawer do card calcular "tempo
 * parado na etapa" (`montarHistorico` + `formatarDuracaoHistorico`, em
 * lib/utils/historico.ts) sem duplicar a lógica que já existe na tela de
 * edição da negociação.
 */
export async function obterHistoricoNegociacaoAction(negociacaoId: string): Promise<LinhaHistoricoBruta[]> {
  if (!z.uuid().safeParse(negociacaoId).success) return []
  return listarHistoricoDaNegociacao(negociacaoId)
}
