'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { alterarStatusEvento, atualizarEvento, criarEvento } from '@/lib/dal/eventos'
import { diaEmSaoPaulo } from '@/lib/utils/formatacao'
import {
  CAMPOS_EVENTO,
  eventoSchema,
  statusEventoSchema,
  type CampoEvento,
} from '@/lib/validations/evento'

export type EstadoFormEvento = {
  erro?: string
  campos?: Partial<Record<CampoEvento, string[]>>
  valores?: Partial<Record<CampoEvento, string>>
}

const uuid = z.uuid()

function lerFormulario(formData: FormData) {
  const valores: Partial<Record<CampoEvento, string>> = {}
  for (const campo of CAMPOS_EVENTO) {
    valores[campo] = String(formData.get(campo) ?? '')
  }
  return valores
}

/** Agenda, ficha do cliente e card do funil mostram eventos. */
function revalidar(clienteId?: string) {
  revalidatePath('/agenda')
  revalidatePath('/funil')
  if (clienteId) revalidatePath(`/clientes/${clienteId}`)
}

export async function criarEventoAction(
  _estado: EstadoFormEvento | undefined,
  formData: FormData,
): Promise<EstadoFormEvento> {
  const valores = lerFormulario(formData)
  const parsed = eventoSchema.safeParse(valores)
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors, valores }
  }

  const resultado = await criarEvento(parsed.data)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidar(parsed.data.cliente_id)
  redirect(`/agenda?dia=${diaEmSaoPaulo(parsed.data.inicio)}`)
}

export async function atualizarEventoAction(
  id: string,
  _estado: EstadoFormEvento | undefined,
  formData: FormData,
): Promise<EstadoFormEvento> {
  const valores = lerFormulario(formData)
  if (!uuid.safeParse(id).success) return { erro: 'Evento inválido.', valores }

  const parsed = eventoSchema.safeParse(valores)
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors, valores }
  }

  const resultado = await atualizarEvento(id, parsed.data)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidar(parsed.data.cliente_id)
  redirect(`/agenda?dia=${diaEmSaoPaulo(parsed.data.inicio)}`)
}

/** Usada por botões de formulário: id, cliente e status vêm amarrados. */
export async function alterarStatusEventoAction(
  id: string,
  clienteId: string,
  status: string,
): Promise<void> {
  const parsed = statusEventoSchema.safeParse(status)
  if (!uuid.safeParse(id).success || !parsed.success) return

  const resultado = await alterarStatusEvento(id, parsed.data)
  // Falha típica: o evento já mudou em outra aba. Recarregar mostra o atual.
  if (!resultado.ok) console.warn('Alterar status do evento:', resultado.mensagem)

  revalidar(uuid.safeParse(clienteId).success ? clienteId : undefined)
}
