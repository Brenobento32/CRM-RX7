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
  excluirNegociacaoPermanente,
  listarRespostasLead,
  obterDetalhesLeadNegociacao,
  reativarNegociacao,
  salvarFichaNegociacao,
  type DetalhesLeadNegociacao,
  type RespostaLead,
} from '@/lib/dal/negociacoes'
import { listarNichosAtivos, type Nicho } from '@/lib/dal/nichos'
import { CAMPOS_CLIENTE, clienteSchema } from '@/lib/validations/cliente'
import {
  dadosComerciaisSchema,
  desqualificarSchema,
  excluirLeadSchema,
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
      'tipo_venda',
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

/** Botão "Reativar" em /funil/leads (aba Arquivados) — sem estado pra ler, só revalida. */
export async function reativarNegociacaoAction(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return

  const resultado = await reativarNegociacao(id)
  if (!resultado.ok) {
    console.warn('Reativar negociação:', resultado.mensagem)
    return
  }
  revalidatePath('/funil')
  revalidatePath('/funil/leads')
}

/** Seletor de nicho da ficha do cliente (item 3 do refinamento) — só nichos ativos. */
export async function listarNichosAtivosAction(): Promise<Nicho[]> {
  return listarNichosAtivos()
}

export type EstadoFicha = {
  erro?: string
  sucesso?: boolean
  campos?: Record<string, string[] | undefined>
  /** Devolvidos ao formulário (cliente + comerciais juntos) quando o salvamento falha. */
  valores?: Record<string, string>
}

/**
 * ÚNICO salvar da ficha do card (Kanban) — dados do cliente (cadastro) e
 * dados comerciais da negociação (nicho/temperatura/proposta) num só
 * submit, numa ÚNICA chamada atômica (`salvarFichaNegociacao()` → RPC
 * `salvar_ficha_negociacao`, GERENTE ou `pode_mover_etapa`, nunca owner_id):
 * sucesso é commit dos dois; qualquer erro desfaz os dois — nunca "cliente
 * salvo, negociação não" (ou o contrário). Nunca fecha a ficha: devolve
 * `sucesso`/`erro` pra `ModalFichaCliente` mostrar inline e manter os
 * valores digitados em caso de erro — quem decide fechar é só o X/Cancelar,
 * nunca um salvamento bem-sucedido.
 */
export async function salvarFichaAction(
  clienteId: string,
  negociacaoId: string,
  _estado: EstadoFicha | undefined,
  formData: FormData,
): Promise<EstadoFicha> {
  if (!z.uuid().safeParse(clienteId).success || !z.uuid().safeParse(negociacaoId).success) {
    return { erro: 'Ficha inválida.' }
  }

  const valoresCliente = lerCampos(formData, CAMPOS_CLIENTE)
  const valoresComerciais = lerCampos(formData, ['nicho_id', 'temperatura', 'valor_estimado'])
  const valores = { ...valoresCliente, ...valoresComerciais }

  const parsedCliente = clienteSchema.safeParse(valoresCliente)
  const parsedComercial = dadosComerciaisSchema.safeParse({ negociacao_id: negociacaoId, ...valoresComerciais })

  if (!parsedCliente.success || !parsedComercial.success) {
    return {
      campos: {
        ...(!parsedCliente.success ? z.flattenError(parsedCliente.error).fieldErrors : {}),
        ...(!parsedComercial.success ? z.flattenError(parsedComercial.error).fieldErrors : {}),
      },
      valores,
    }
  }

  const resultado = await salvarFichaNegociacao(clienteId, negociacaoId, parsedCliente.data, {
    nichoId: parsedComercial.data.nicho_id,
    temperatura: parsedComercial.data.temperatura,
    valorEstimado: parsedComercial.data.valor_estimado,
  })
  if (!resultado.ok) {
    return { erro: resultado.mensagem, valores }
  }

  revalidatePath('/funil')
  revalidatePath('/funil/leads')
  revalidatePath(`/clientes/${clienteId}`)
  return { sucesso: true, valores }
}

/**
 * "Excluir lead" — modal visual próprio em /funil/leads (`ModalExcluirLead`,
 * `useActionState`), nunca `confirm()` nativo. Exclusão lógica, nunca
 * `DELETE` físico — ver `excluirNegociacaoPermanente`.
 */
export async function excluirLeadAction(
  _estado: EstadoModalFunil | undefined,
  formData: FormData,
): Promise<EstadoModalFunil> {
  const parsed = excluirLeadSchema.safeParse(lerCampos(formData, ['negociacao_id', 'motivo']))
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await excluirNegociacaoPermanente(parsed.data.negociacao_id, parsed.data.motivo)
  if (!resultado.ok) return { erro: resultado.mensagem }

  revalidatePath('/funil')
  revalidatePath('/funil/leads')
  return { ok: true }
}
