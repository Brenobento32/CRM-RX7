/**
 * Regras da agenda compartilhadas entre servidor e formulário.
 */

import { DURACOES, type Duracao } from '@/lib/validations/evento'

type Pessoa = { id: string; role: 'gerente' | 'closer' | 'sdr' }

/**
 * Quem pode ser responsável por um evento do cliente: o dono da carteira e
 * os gerentes. O banco confere a mesma regra (`agenda_valida_responsavel`).
 */
export function responsaveisElegiveis<T extends Pessoa>(responsaveis: T[], ownerId: string | undefined): T[] {
  return responsaveis.filter((r) => r.role === 'gerente' || r.id === ownerId)
}

/** Duração que o formulário mostra para um evento existente (minutos). */
export function duracaoDoFormulario(minutos: number): Duracao {
  const opcao = String(minutos)
  return (DURACOES as readonly string[]).includes(opcao) && opcao !== 'personalizado' ? (opcao as Duracao) : 'personalizado'
}

const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/

/** "10:00" + 90 → "11:30"; `null` se a hora for inválida ou passar da meia-noite. */
export function somarMinutosHora(hora: string, minutos: number): string | null {
  if (!HORA_VALIDA.test(hora)) return null
  const [h, m] = hora.split(':').map(Number)
  const total = h * 60 + m + minutos
  if (total > 24 * 60) return null
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Término da reunião no formulário: pela duração escolhida ou pelo término livre. */
export function horaFimDoFormulario(horaInicio: string, duracao: Duracao, horaFimLivre: string): string | null {
  if (duracao === 'personalizado') return HORA_VALIDA.test(horaFimLivre) ? horaFimLivre : null
  return somarMinutosHora(horaInicio, Number(duracao))
}

export type Ocupado = { id: string; usuarioId: string; titulo: string; inicio: string; fim: string; status: string }

/**
 * Reuniões do mesmo responsável que se sobrepõem ao horário pedido. Não
 * bloqueia (como no Google Calendar, dá para ter duas ao mesmo tempo): só
 * alimenta o aviso do formulário. Canceladas não contam; a própria reunião
 * (em edição) também não.
 */
export function conflitosDeHorario(
  ocupados: Ocupado[],
  alvo: { usuarioId: string; inicio: Date; fim: Date; excetoId?: string },
): Ocupado[] {
  const ini = alvo.inicio.getTime()
  const fim = alvo.fim.getTime()
  if (!(fim > ini)) return []
  return ocupados.filter(
    (o) =>
      o.usuarioId === alvo.usuarioId &&
      o.id !== alvo.excetoId &&
      o.status !== 'cancelado' &&
      Date.parse(o.inicio) < fim &&
      Date.parse(o.fim) > ini,
  )
}
