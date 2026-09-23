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
