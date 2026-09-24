'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  alterarEventos,
  alterarStatusEvento,
  cancelarEventos,
  criarEvento,
  excluirEvento,
  type ResultadoEvento,
} from '@/lib/dal/eventos'
import { diaValido } from '@/lib/utils/formatacao'
import {
  CAMPOS_EVENTO,
  ESCOPOS,
  eventoFormSchema,
  statusEventoSchema,
  type CampoEvento,
  type ValoresEvento,
} from '@/lib/validations/evento'

export type EstadoFormEvento = {
  erro?: string
  campos?: Partial<Record<CampoEvento, string[]>>
  /** Devolvidos ao formulário quando a gravação falha. */
  valores?: ValoresEvento
}

const uuid = z.uuid()
const escopoSchema = z.enum(ESCOPOS)

function lerFormulario(formData: FormData) {
  const valores: ValoresEvento = {
    dias_semana: formData.getAll('dias_semana').map(String),
  }
  for (const campo of CAMPOS_EVENTO) {
    const v = formData.get(campo)
    // Campo ausente (ex.: status na edição) fica de fora e cai no default.
    if (v !== null) valores[campo] = String(v)
  }
  return valores
}

/** Agenda, ficha do cliente, card do funil e dashboard mostram eventos. */
function revalidar(clienteId?: string) {
  revalidatePath('/agenda')
  revalidatePath('/funil')
  revalidatePath('/')
  if (clienteId) revalidatePath(`/clientes/${clienteId}`)
}

function comoEstado(r: Extract<ResultadoEvento, { ok: false }>, valores: EstadoFormEvento['valores']) {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
}

function agendaDoDia(dia: string) {
  return `/agenda?dia=${dia}`
}

export async function criarEventoAction(
  _estado: EstadoFormEvento | undefined,
  formData: FormData,
): Promise<EstadoFormEvento> {
  const valores = lerFormulario(formData)
  const parsed = eventoFormSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarEvento(parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar(parsed.data.evento.cliente_id)
  redirect(agendaDoDia(parsed.data.evento.data))
}

/** O escopo (este / seguintes / todos) vem do próprio formulário. */
export async function atualizarEventoAction(
  id: string,
  _estado: EstadoFormEvento | undefined,
  formData: FormData,
): Promise<EstadoFormEvento> {
  const valores = lerFormulario(formData)
  if (!uuid.safeParse(id).success) return { erro: 'Evento inválido.', valores }

  const parsed = eventoFormSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await alterarEventos(id, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar(parsed.data.evento.cliente_id)
  redirect(agendaDoDia(parsed.data.evento.data))
}

/**
 * Botões da página de edição (cancelar, excluir). Funcionam sem JavaScript:
 * falha volta para a edição com a mensagem na URL.
 */
function voltarComErro(id: string, mensagem: string): never {
  redirect(`/agenda/${id}/editar?erro=${encodeURIComponent(mensagem)}`)
}

export async function cancelarEventoAction(
  id: string,
  clienteId: string,
  dia: string,
  formData: FormData,
): Promise<void> {
  if (!uuid.safeParse(id).success) return
  const escopo = escopoSchema.safeParse(formData.get('escopo') ?? 'este')
  if (!escopo.success) voltarComErro(id, 'Escolha a quais eventos aplicar.')

  const r = await cancelarEventos(id, escopo.data)
  revalidar(uuid.safeParse(clienteId).success ? clienteId : undefined)
  if (!r.ok) voltarComErro(id, r.mensagem)
  redirect(diaValido(dia) ? agendaDoDia(dia) : '/agenda')
}

export async function excluirEventoAction(id: string, clienteId: string, dia: string): Promise<void> {
  if (!uuid.safeParse(id).success) return

  const r = await excluirEvento(id)
  revalidar(uuid.safeParse(clienteId).success ? clienteId : undefined)
  if (!r.ok) voltarComErro(id, r.mensagem)
  redirect(diaValido(dia) ? agendaDoDia(dia) : '/agenda')
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
