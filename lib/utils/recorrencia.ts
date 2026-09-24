import { addDays, addMonths, getDaysInMonth } from 'date-fns'

import { formatarDia } from '@/lib/utils/formatacao'

/**
 * Recorrência da agenda, do lado da aplicação.
 *
 * Quem gera as ocorrências é o banco (`public.expandir_recorrencia`, via
 * `criar_serie_eventos`). Aqui a mesma regra só serve para a PRÉVIA do
 * formulário ("12 ocorrências") e para o texto que descreve a série — se as
 * duas divergirem, vale o banco.
 *
 * Datas são AAAA-MM-DD do calendário de São Paulo, manipuladas ao meio-dia
 * UTC para nenhum fuso do servidor ou do navegador trocar o dia.
 */

export type Frequencia = 'diaria' | 'semanal' | 'mensal'

export type RegraRecorrencia = {
  dataInicio: string
  frequencia: Frequencia
  intervalo: number
  /** ISO: 1 = segunda … 7 = domingo. Só na semanal. */
  diasSemana: number[] | null
  /** 1–31. Só na mensal; 29–31 caem no último dia dos meses curtos. */
  diaMes: number | null
  terminaEm: string | null
  ocorrencias: number | null
}

/** Os mesmos tetos das constraints de `eventos_series`. */
export const MAX_OCORRENCIAS = 200
export const MAX_MESES = 12
/** Término sugerido no formulário. */
export const MESES_TERMINO_PADRAO = 3

function meioDia(dia: string) {
  return new Date(`${dia}T12:00:00Z`)
}

function paraDia(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** 1 = segunda … 7 = domingo. */
export function diaDaSemanaIso(dia: string): number {
  const d = meioDia(dia).getUTCDay()
  return d === 0 ? 7 : d
}

export function diaDoMes(dia: string): number {
  return meioDia(dia).getUTCDate()
}

/** Soma meses como o Postgres (`date + interval 'N months'`): 31/01 + 1 mês = 28/02. */
export function somarMeses(dia: string, meses: number): string {
  return paraDia(addMonths(meioDia(dia), meses))
}

export function limiteDoTermino(dataInicio: string): string {
  return somarMeses(dataInicio, MAX_MESES)
}

/** Datas locais das ocorrências. Espelho de `public.expandir_recorrencia`. */
export function expandirRecorrencia(r: RegraRecorrencia): string[] {
  const limite = [r.terminaEm ?? limiteDoTermino(r.dataInicio), limiteDoTermino(r.dataInicio)].sort()[0]
  const teto = Math.min(r.ocorrencias ?? MAX_OCORRENCIAS, MAX_OCORRENCIAS)
  const inicio = meioDia(r.dataInicio)
  const fim = meioDia(limite)
  const datas: string[] = []

  if (r.frequencia === 'diaria') {
    for (let d = inicio; d <= fim && datas.length < teto; d = addDays(d, r.intervalo)) {
      datas.push(paraDia(d))
    }
    return datas
  }

  if (r.frequencia === 'semanal') {
    const dias = [...new Set(r.diasSemana ?? [])].sort((a, b) => a - b)
    if (dias.length === 0) return []
    // Segunda-feira da semana inicial.
    let semana = addDays(inicio, -(diaDaSemanaIso(r.dataInicio) - 1))
    while (semana <= fim && datas.length < teto) {
      for (const dia of dias) {
        const d = addDays(semana, dia - 1)
        if (d >= inicio && d <= fim && datas.length < teto) datas.push(paraDia(d))
      }
      semana = addDays(semana, 7 * r.intervalo)
    }
    return datas
  }

  if (!r.diaMes) return []
  let mes = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1, 12))
  while (mes <= fim && datas.length < teto) {
    const d = new Date(mes)
    d.setUTCDate(Math.min(r.diaMes, getDaysInMonth(mes)))
    if (d >= inicio && d <= fim) datas.push(paraDia(d))
    mes = addMonths(mes, r.intervalo)
  }
  return datas
}

const NOMES_DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
const DIAS_CURTOS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']
export const DIAS_SEMANA = NOMES_DIAS.map((nome, i) => ({
  valor: i + 1,
  nome,
  curto: DIAS_CURTOS[i],
}))

function lista(itens: string[]) {
  if (itens.length <= 1) return itens.join('')
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`
}

/** "A cada 2 semanas às terças e quintas, até 24/12/2026" */
export function descreverRecorrencia(r: RegraRecorrencia): string {
  let base: string
  if (r.frequencia === 'diaria') {
    base = r.intervalo === 1 ? 'Todo dia' : `A cada ${r.intervalo} dias`
  } else if (r.frequencia === 'semanal') {
    const dias = [...new Set(r.diasSemana ?? [])]
      .sort((a, b) => a - b)
      .map((d) => `${NOMES_DIAS[d - 1]}s`)
    const quando = dias.length ? ` às ${lista(dias)}` : ''
    base = (r.intervalo === 1 ? 'Toda semana' : `A cada ${r.intervalo} semanas`) + quando
  } else {
    const dia = r.diaMes && r.diaMes >= 29 ? `${r.diaMes} (ou o último dia do mês)` : String(r.diaMes ?? '')
    base = (r.intervalo === 1 ? 'Todo mês' : `A cada ${r.intervalo} meses`) + ` no dia ${dia}`
  }

  const termino = r.terminaEm
    ? `até ${formatarDia(r.terminaEm)}`
    : `${r.ocorrencias} ${r.ocorrencias === 1 ? 'vez' : 'vezes'}`
  return `${base}, ${termino}`
}
