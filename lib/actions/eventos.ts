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
  obterEvento,
  type ResultadoEvento,
} from '@/lib/dal/eventos'
import { duracaoDoFormulario } from '@/lib/utils/agenda'
import { minutosParaHora } from '@/lib/utils/calendario'
import { diaValido } from '@/lib/utils/formatacao'
import {
  CAMPOS_EVENTO,
  ESCOPOS,
  eventoFormSchema,
  statusEmAberto,
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

  revalidar(parsed.data.evento.cliente_id ?? undefined)
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

  revalidar(parsed.data.evento.cliente_id ?? undefined)
  redirect(agendaDoDia(parsed.data.evento.data))
}

/**
 * Botões da página de edição (cancelar, excluir). Funcionam sem JavaScript:
 * falha volta para a edição com a mensagem na URL.
 */
function voltarComErro(id: string, mensagem: string): never {
  redirect(`/agenda?editar=${id}&erro=${encodeURIComponent(mensagem)}`)
}

export async function cancelarEventoAction(
  id: string,
  clienteId: string | null,
  dia: string,
  formData: FormData,
): Promise<void> {
  if (!uuid.safeParse(id).success) return
  const escopo = escopoSchema.safeParse(formData.get('escopo') ?? 'este')
  if (!escopo.success) voltarComErro(id, 'Escolha a quais eventos aplicar.')

  const r = await cancelarEventos(id, escopo.data)
  revalidar(clienteId && uuid.safeParse(clienteId).success ? clienteId : undefined)
  if (!r.ok) voltarComErro(id, r.mensagem)
  redirect(diaValido(dia) ? agendaDoDia(dia) : '/agenda')
}

export async function excluirEventoAction(id: string, clienteId: string | null, dia: string): Promise<void> {
  if (!uuid.safeParse(id).success) return

  const r = await excluirEvento(id)
  revalidar(clienteId && uuid.safeParse(clienteId).success ? clienteId : undefined)
  if (!r.ok) voltarComErro(id, r.mensagem)
  redirect(diaValido(dia) ? agendaDoDia(dia) : '/agenda')
}

/** Usada por botões de formulário: id, cliente e status vêm amarrados. */
export async function alterarStatusEventoAction(
  id: string,
  clienteId: string | null,
  status: string,
): Promise<void> {
  const parsed = statusEventoSchema.safeParse(status)
  if (!uuid.safeParse(id).success || !parsed.success) return

  const resultado = await alterarStatusEvento(id, parsed.data)
  // Falha típica: o evento já mudou em outra aba. Recarregar mostra o atual.
  if (!resultado.ok) console.warn('Alterar status do evento:', resultado.mensagem)

  revalidar(clienteId && uuid.safeParse(clienteId).success ? clienteId : undefined)
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Reagendar por arraste na grade (Agenda 2.0 N3.1): só data e hora mudam,
 * cliente, negociação, responsável, duração e status ficam como estavam.
 * Sempre "somente este" — nunca move uma série inteira por um arraste sem
 * confirmação — e passa pela mesma `alterarEventos` do formulário de edição,
 * então a proteção de evento realizado/não compareceu/cancelado (que
 * `alterar_eventos` nunca reescreve) e a RLS valem igual. Sem redirect: quem
 * chama já está na agenda, só espera revalidar.
 */
export async function reagendarEventoAction(
  id: string,
  novaData: string,
  novaHoraInicio: string,
): Promise<{ ok: boolean; mensagem?: string }> {
  if (!uuid.safeParse(id).success) return { ok: false, mensagem: 'Evento inválido.' }
  if (!diaValido(novaData) || !HORA.test(novaHoraInicio)) {
    return { ok: false, mensagem: 'Data ou hora inválida.' }
  }

  const evento = await obterEvento(id)
  if (!evento) return { ok: false, mensagem: 'Evento não encontrado.' }
  if (!statusEmAberto(evento.status)) {
    return { ok: false, mensagem: 'Só é possível reagendar compromissos agendados ou confirmados.' }
  }

  const duracaoMinutos = Math.round((Date.parse(evento.fim) - Date.parse(evento.inicio)) / 60_000)
  const duracao = duracaoDoFormulario(duracaoMinutos)
  const [h, m] = novaHoraInicio.split(':').map(Number)

  const parsed = eventoFormSchema.safeParse({
    cliente_id: evento.clienteId ?? '',
    negociacao_id: evento.negociacaoId ?? '',
    usuario_id: evento.usuarioId,
    tipo: evento.tipo,
    tipo_original: evento.tipo,
    titulo: evento.titulo,
    descricao: evento.descricao ?? '',
    status: evento.status,
    data: novaData,
    hora_inicio: novaHoraInicio,
    duracao,
    hora_fim: duracao === 'personalizado' ? minutosParaHora(h * 60 + m + duracaoMinutos) : '',
    recorrencia: 'nenhuma',
    escopo: 'este',
  })
  if (!parsed.success) return { ok: false, mensagem: 'Não foi possível calcular o novo horário.' }

  const r = await alterarEventos(id, parsed.data)
  if (!r.ok) return { ok: false, mensagem: r.mensagem }

  revalidar(evento.clienteId ?? undefined)
  return { ok: true }
}
