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
