import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'

export const FUSO_HORARIO = 'America/Sao_Paulo'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatarMoeda(valor: number): string {
  return moeda.format(valor)
}

/** "R$ 1,2 mi" — para totais de coluna, onde o espaço é curto. */
export function formatarMoedaCompacta(valor: number): string {
  return moedaCompacta.format(valor)
}

/**
 * Datas sempre no fuso de São Paulo, no servidor e no browser. Formatar no
 * fuso local geraria texto diferente entre SSR e hidratação.
 */
export function formatarDataHora(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, "dd/MM 'às' HH:mm", { locale: ptBR })
}

export function formatarData(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, 'dd/MM/yyyy', { locale: ptBR })
}

export function formatarDataHoraCompleta(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

/** Hoje em São Paulo, no formato de `<input type="date">` (AAAA-MM-DD). */
export function hojeSaoPaulo(): string {
  return formatInTimeZone(new Date(), FUSO_HORARIO, 'yyyy-MM-dd')
}

/** Agora em São Paulo, no formato de `<input type="datetime-local">`. */
export function agoraSaoPauloLocal(): string {
  return formatInTimeZone(new Date(), FUSO_HORARIO, "yyyy-MM-dd'T'HH:mm")
}

/**
 * Formata uma coluna `date` (AAAA-MM-DD). Não passa por `Date`: "2026-09-23"
 * seria lido como meia-noite UTC e viraria dia 22 em São Paulo.
 */
export function formatarDia(dia: string, comAno = true): string {
  const [ano, mes, d] = dia.split('-')
  return comAno ? `${d}/${mes}/${ano}` : `${d}/${mes}`
}
