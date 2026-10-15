'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  concluirProximaAcao,
  criarProximaAcao,
  registrarAtividade,
} from '@/lib/dal/atividades'
import { atividadeSchema, observacaoRapidaSchema, proximaAcaoSchema } from '@/lib/validations/atividade'

export type EstadoFormAtividade = {
  ok?: boolean
  erro?: string
  campos?: Record<string, string[] | undefined>
}

const uuid = z.uuid()

function lerCampos(formData: FormData, campos: readonly string[]) {
  return Object.fromEntries(campos.map((c) => [c, String(formData.get(c) ?? '')]))
}

/** Timeline e próxima ação aparecem na ficha e no card do funil. */
function revalidar(clienteId: string) {
  revalidatePath(`/clientes/${clienteId}`)
  revalidatePath('/funil')
}

export async function registrarAtividadeAction(
  clienteId: string,
  _estado: EstadoFormAtividade | undefined,
  formData: FormData,
): Promise<EstadoFormAtividade> {
  if (!uuid.safeParse(clienteId).success) return { erro: 'Cliente inválido.' }

  const parsed = atividadeSchema.safeParse(
    lerCampos(formData, ['tipo', 'descricao', 'data', 'negociacao_id']),
  )
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await registrarAtividade(clienteId, parsed.data)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] } }
      : { erro: resultado.mensagem }
  }

  revalidar(clienteId)
  return { ok: true }
}

/**
 * "Observação" do card do Kanban (`ModalFichaCliente`) — sempre `tipo='nota'`,
 * sempre vinculada à negociação do card (nunca deixa o chamador escolher
 * outra, ao contrário de `registrarAtividadeAction`): autorização fica
 * inequívoca em `atividades_insert` (pode_mover_etapa na negociação
 * exata), nunca "qualquer negociação do cliente".
 */
export async function registrarObservacaoAction(
  clienteId: string,
  negociacaoId: string,
  _estado: EstadoFormAtividade | undefined,
  formData: FormData,
): Promise<EstadoFormAtividade> {
  if (!uuid.safeParse(clienteId).success || !uuid.safeParse(negociacaoId).success) {
    return { erro: 'Cliente ou negociação inválidos.' }
  }

  const parsed = observacaoRapidaSchema.safeParse({
    descricao: String(formData.get('descricao') ?? ''),
  })
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await registrarAtividade(clienteId, {
    tipo: 'nota',
    descricao: parsed.data.descricao,
    data: new Date().toISOString(),
    negociacao_id: negociacaoId,
  })
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] } }
      : { erro: resultado.mensagem }
  }

  revalidar(clienteId)
  return { ok: true }
}

export async function criarProximaAcaoAction(
  clienteId: string,
  _estado: EstadoFormAtividade | undefined,
  formData: FormData,
): Promise<EstadoFormAtividade> {
  if (!uuid.safeParse(clienteId).success) return { erro: 'Cliente inválido.' }

  const parsed = proximaAcaoSchema.safeParse(
    lerCampos(formData, ['titulo', 'data', 'observacao', 'negociacao_id']),
  )
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await criarProximaAcao(clienteId, parsed.data)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] } }
      : { erro: resultado.mensagem }
  }

  revalidar(clienteId)
  return { ok: true }
}

export async function concluirProximaAcaoAction(
  id: string,
  clienteId: string,
): Promise<void> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(clienteId).success) return

  const resultado = await concluirProximaAcao(id)
  // Falha aqui é quase sempre "já concluída por outra pessoa": recarregar a
  // ficha já mostra o estado certo.
  if (!resultado.ok) console.warn('Concluir próxima ação:', resultado.mensagem)

  revalidar(clienteId)
}
