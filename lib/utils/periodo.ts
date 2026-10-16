import { hojeSaoPaulo, somarDias } from '@/lib/utils/formatacao'

/** Períodos do dashboard. Datas AAAA-MM-DD no calendário de São Paulo, inclusivas. */
export const PERIODOS = ['7d', '15d', 'mes', 'mes_anterior', '90d', 'ano'] as const

export type ChavePeriodo = (typeof PERIODOS)[number]

export const ROTULO_PERIODO: Record<ChavePeriodo, string> = {
  '7d': 'Últimos 7 dias',
  '15d': 'Últimos 15 dias',
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
    case '7d':
      return { chave, inicio: somarDias(hoje, -6), fim: hoje }
    case '15d':
      return { chave, inicio: somarDias(hoje, -14), fim: hoje }
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

/** AAAA-MM → último dia do mês (AAAA-MM-DD) — pro cabeçalho "Período: … → …" de /metas. */
export function ultimoDiaDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number)
  const dia = new Date(ano, m, 0).getDate()
  return `${mes}-${String(dia).padStart(2, '0')}`
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

// ---------------------------------------------------------------------------
// Período do funil (Métricas do funil) — atalhos próprios, independentes dos
// de {@link PERIODOS} (dashboard/propostas): 7/30/90 dias, este ano, e um
// período personalizado (início/fim escolhidos pelo usuário). Nunca reaproveita
// 'mes'/'mes_anterior'/'15d' — são atalhos de outra tela, com outro propósito.
// ---------------------------------------------------------------------------

export const PERIODOS_FUNIL = ['7d', '30d', '90d', 'ano', 'personalizado'] as const

export type ChavePeriodoFunil = (typeof PERIODOS_FUNIL)[number]

export const ROTULO_PERIODO_FUNIL: Record<ChavePeriodoFunil, string> = {
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  ano: 'Este ano',
  personalizado: 'Personalizado',
}

export type PeriodoFunil = { chave: ChavePeriodoFunil; inicio: string; fim: string }

export function chavePeriodoFunil(valor: unknown): ChavePeriodoFunil {
  return (PERIODOS_FUNIL as readonly unknown[]).includes(valor) ? (valor as ChavePeriodoFunil) : '30d'
}

function dataValida(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor))
}

/**
 * Resolve o período do funil. `personalizado` só existe com `inicio`/`fim`
 * explícitos (da URL) — datas inválidas ou ausentes caem no padrão de 30
 * dias; `inicio` depois de `fim` é trocado automaticamente, nunca um
 * intervalo invertido.
 */
export function resolverPeriodoFunil(
  chave: ChavePeriodoFunil,
  personalizado: { inicio?: unknown; fim?: unknown } = {},
  hoje = hojeSaoPaulo(),
): PeriodoFunil {
  switch (chave) {
    case '7d':
      return { chave, inicio: somarDias(hoje, -6), fim: hoje }
    case '30d':
      return { chave, inicio: somarDias(hoje, -29), fim: hoje }
    case '90d':
      return { chave, inicio: somarDias(hoje, -89), fim: hoje }
    case 'ano':
      return { chave, inicio: `${hoje.slice(0, 4)}-01-01`, fim: hoje }
    case 'personalizado': {
      if (!dataValida(personalizado.inicio) || !dataValida(personalizado.fim)) {
        return { chave, inicio: somarDias(hoje, -29), fim: hoje }
      }
      const [inicio, fim] =
        personalizado.inicio <= personalizado.fim
          ? [personalizado.inicio, personalizado.fim]
          : [personalizado.fim, personalizado.inicio]
      return { chave, inicio, fim }
    }
  }
}
