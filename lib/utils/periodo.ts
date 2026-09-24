import { hojeSaoPaulo, somarDias } from '@/lib/utils/formatacao'

/** Períodos do dashboard. Datas AAAA-MM-DD no calendário de São Paulo, inclusivas. */
export const PERIODOS = ['mes', 'mes_anterior', '90d', 'ano'] as const

export type ChavePeriodo = (typeof PERIODOS)[number]

export const ROTULO_PERIODO: Record<ChavePeriodo, string> = {
  mes: 'Este mês',
  mes_anterior: 'Mês anterior',
  '90d': 'Últimos 90 dias',
  ano: 'Este ano',
}

export type Periodo = { chave: ChavePeriodo; inicio: string; fim: string }

export function chavePeriodo(valor: unknown): ChavePeriodo {
  return (PERIODOS as readonly unknown[]).includes(valor) ? (valor as ChavePeriodo) : 'mes'
}

export function resolverPeriodo(chave: ChavePeriodo, hoje = hojeSaoPaulo()): Periodo {
  const [ano, mes] = hoje.split('-')
  const inicioDoMes = `${ano}-${mes}-01`

  switch (chave) {
    case 'mes':
      return { chave, inicio: inicioDoMes, fim: hoje }
    case 'mes_anterior': {
      const fim = somarDias(inicioDoMes, -1)
      return { chave, inicio: `${fim.slice(0, 7)}-01`, fim }
    }
    case '90d':
      return { chave, inicio: somarDias(hoje, -89), fim: hoje }
    case 'ano':
      return { chave, inicio: `${ano}-01-01`, fim: hoje }
  }
}

// ---------------------------------------------------------------------------
// Mês (metas). Na URL como AAAA-MM; no banco como o dia 1 (AAAA-MM-01).
// ---------------------------------------------------------------------------

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const

/** Mês corrente em São Paulo (AAAA-MM). */
export function mesAtual(hoje = hojeSaoPaulo()): string {
  return hoje.slice(0, 7)
}

export function mesValido(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}$/.test(valor)) return false
  const mes = Number(valor.slice(5))
  return mes >= 1 && mes <= 12
}

/** `?mes=` da URL; qualquer coisa inválida vira o mês corrente. */
export function lerMes(valor: unknown): string {
  return mesValido(valor) ? valor : mesAtual()
}

/** AAAA-MM → AAAA-MM-01 (formato de `metas.periodo_mes`). */
export function primeiroDiaDoMes(mes: string): string {
  return `${mes}-01`
}

export function somarMeses(mes: string, meses: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5)) - 1 + meses
  const ano = Math.floor(total / 12)
  return `${ano}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** "2026-09" → "Setembro de 2026" */
export function rotuloMes(mes: string): string {
  return `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`
}
