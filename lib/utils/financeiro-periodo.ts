/**
 * Matemática financeira do período (TCV/MRR), pura — sem Supabase, testável
 * direto. Duas responsabilidades:
 *
 *   1. `agregarRealizado`/`ticketMedio` — soma o que já veio filtrado do
 *      banco (fechamentos do funil+período escolhidos, via
 *      `lib/dal/funil-metricas.ts#obterRealizadoFunil`). Quem filtra
 *      funil/período é a query SQL; esta função só agrega o que recebeu.
 *   2. `metaProporcionalPeriodo` — a meta (mensal, por natureza do schema)
 *      proporcionada ao período selecionado: cada mês tocado pelo período
 *      contribui com `valorMeta × (dias do mês dentro do período ÷ dias do
 *      mês)`. Mês completo = 100% da meta; mês parcial = a fração de dias;
 *      vários meses (90 dias, "este ano") somam a parcela de cada um.
 */

export type LinhaFechamentoBruta = {
  valor_vendido: number | string
  tipo_venda: 'tcv' | 'mrr' | null
}

export type RealizadoFunil = {
  tcv: number
  tcvQtd: number
  mrr: number
  mrrQtd: number
}

/**
 * Soma valor e conta quantidade por tipo. `tipo_venda` nulo (vendas
 * anteriores à classificação TCV/MRR existir) não entra em nenhum total —
 * mesma regra de `metas_progresso`.
 */
export function agregarRealizado(linhas: LinhaFechamentoBruta[]): RealizadoFunil {
  const acc: RealizadoFunil = { tcv: 0, tcvQtd: 0, mrr: 0, mrrQtd: 0 }
  for (const l of linhas) {
    const valor = Number(l.valor_vendido)
    if (l.tipo_venda === 'tcv') {
      acc.tcv += valor
      acc.tcvQtd += 1
    } else if (l.tipo_venda === 'mrr') {
      acc.mrr += valor
      acc.mrrQtd += 1
    }
  }
  return acc
}

/** Valor vendido ÷ quantidade de vendas. `null` sem nenhuma venda — nunca divisão por zero. */
export function ticketMedio(valor: number, quantidade: number): number | null {
  return quantidade === 0 ? null : valor / quantidade
}

export type MetaMensal = { mes: string /* AAAA-MM */; valorMeta: number }

function diasNoMes(mes: string): number {
  const [ano, m] = mes.split('-').map(Number)
  return new Date(ano, m, 0).getDate()
}

/** Quantos dias de `mes` (AAAA-MM) caem dentro de [inicio, fim] (AAAA-MM-DD, inclusive). 0 se não há sobreposição. */
function diasSobrepostos(mes: string, inicio: string, fim: string): number {
  const inicioMes = `${mes}-01`
  const fimMes = `${mes}-${String(diasNoMes(mes)).padStart(2, '0')}`
  const ini = inicio > inicioMes ? inicio : inicioMes
  const fimEf = fim < fimMes ? fim : fimMes
  if (ini > fimEf) return 0
  // Diferença de dias por subtração de datas UTC (meio-dia, sem DST): mesmo padrão de `lib/utils/formatacao.ts`.
  const msPorDia = 86_400_000
  const diff = Math.round((Date.parse(`${fimEf}T12:00:00Z`) - Date.parse(`${ini}T12:00:00Z`)) / msPorDia)
  return diff + 1
}

/**
 * Meta proporcionada ao período: soma, de cada mês com meta definida que o
 * período toca, `valorMeta × (dias sobrepostos ÷ dias do mês)`. `null` só
 * quando NENHUM mês tocado tem meta definida (meta realmente "não
 * definida" para o período inteiro) — meses sem meta no meio de um
 * intervalo maior contribuem 0, não anulam os demais.
 */
export function metaProporcionalPeriodo(mensal: MetaMensal[], periodo: { inicio: string; fim: string }): number | null {
  let soma = 0
  let algumaDefinida = false
  for (const { mes, valorMeta } of mensal) {
    const dias = diasSobrepostos(mes, periodo.inicio, periodo.fim)
    if (dias <= 0) continue
    soma += valorMeta * (dias / diasNoMes(mes))
    algumaDefinida = true
  }
  return algumaDefinida ? soma : null
}

export type MetaPeriodo = { tcv: number | null; mrr: number | null }
