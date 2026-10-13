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
import {
  arquivarNegociacao,
  atualizarDadosComerciaisNegociacao,
  listarRespostasLead,
  obterDetalhesLeadNegociacao,
  type DetalhesLeadNegociacao,
  type RespostaLead,
} from '@/lib/dal/negociacoes'
import { listarNichosAtivos, type Nicho } from '@/lib/dal/nichos'
import {
  dadosComerciaisSchema,
  desqualificarSchema,
  fechamentoSchema,
  moverSchema,
  perdaSchema,
} from '@/lib/validations/funil'
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

/** Qualificação (pergunta/resposta) pro modal de ficha do cliente e pro painel lateral, no Kanban. */
export async function obterRespostasLeadAction(negociacaoId: string): Promise<RespostaLead[]> {
  if (!z.uuid().safeParse(negociacaoId).success) return []
  return listarRespostasLead(negociacaoId)
}

/** E-mail/Instagram do cliente + valor da proposta — campos do painel lateral que `CardFunil` não traz. */
export async function obterDetalhesLeadAction(negociacaoId: string): Promise<DetalhesLeadNegociacao | null> {
  if (!z.uuid().safeParse(negociacaoId).success) return null
  return obterDetalhesLeadNegociacao(negociacaoId)
}

/**
 * "Desqualificar lead" — modal visual próprio no drawer (`ModalDesqualificar`,
 * `useActionState`), nunca `prompt()`/`confirm()` nativo.
 */
export async function arquivarNegociacaoAction(
  _estado: EstadoModalFunil | undefined,
  formData: FormData,
): Promise<EstadoModalFunil> {
  const parsed = desqualificarSchema.safeParse(lerCampos(formData, ['negociacao_id', 'motivo']))
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await arquivarNegociacao(parsed.data.negociacao_id, parsed.data.motivo)
  if (!resultado.ok) return { erro: resultado.mensagem }

  revalidatePath('/funil')
  revalidatePath('/funil/leads')
  return { ok: true }
}

/** Seletor de nicho da ficha do cliente (item 3 do refinamento) — só nichos ativos. */
export async function listarNichosAtivosAction(): Promise<Nicho[]> {
  return listarNichosAtivos()
}

/**
 * "Dados comerciais" da ficha do cliente (nicho/origem/temperatura/proposta)
 * — mesma pilha `useActionState` do resto do funil. Salvar fecha a ficha e
 * revalida `/funil` (a borda do card, que é o nicho, atualiza sem reload);
 * falhar mantém a ficha aberta com o erro.
 */
export async function atualizarDadosComerciaisAction(
  _estado: EstadoModalFunil | undefined,
  formData: FormData,
): Promise<EstadoModalFunil> {
  const parsed = dadosComerciaisSchema.safeParse(
    lerCampos(formData, ['negociacao_id', 'nicho_id', 'origem', 'temperatura', 'valor_estimado']),
  )
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await atualizarDadosComerciaisNegociacao({
    negociacaoId: parsed.data.negociacao_id,
    nichoId: parsed.data.nicho_id,
    origem: parsed.data.origem,
    temperatura: parsed.data.temperatura,
    valorEstimado: parsed.data.valor_estimado,
  })
  if (!resultado.ok) return { erro: resultado.mensagem }

  revalidatePath('/funil')
  revalidatePath('/funil/leads')
  return { ok: true }
}
