import { describe, expect, it } from 'vitest'

import {
  agregarRealizado,
  metaProporcionalPeriodo,
  ticketMedio,
  type LinhaFechamentoBruta,
} from '@/lib/utils/financeiro-periodo'

describe('agregarRealizado', () => {
  it('soma TCV e MRR separadamente', () => {
    const linhas: LinhaFechamentoBruta[] = [
      { valor_vendido: 1000, tipo_venda: 'tcv' },
      { valor_vendido: 500, tipo_venda: 'tcv' },
      { valor_vendido: 300, tipo_venda: 'mrr' },
    ]
    expect(agregarRealizado(linhas)).toEqual({ tcv: 1500, tcvQtd: 2, mrr: 300, mrrQtd: 1 })
  })

  it('venda com tipo_venda nulo não entra em TCV nem em MRR', () => {
    const linhas: LinhaFechamentoBruta[] = [
      { valor_vendido: 1000, tipo_venda: null },
      { valor_vendido: 500, tipo_venda: 'tcv' },
    ]
    expect(agregarRealizado(linhas)).toEqual({ tcv: 500, tcvQtd: 1, mrr: 0, mrrQtd: 0 })
  })

  it('zero vendas: tudo zero, sem erro', () => {
    expect(agregarRealizado([])).toEqual({ tcv: 0, tcvQtd: 0, mrr: 0, mrrQtd: 0 })
  })

  it('valor_vendido como string (numeric do Postgres) é convertido', () => {
    expect(agregarRealizado([{ valor_vendido: '1234.50', tipo_venda: 'tcv' }]).tcv).toBeCloseTo(1234.5)
  })
})

describe('ticketMedio', () => {
  it('valor ÷ quantidade', () => {
    expect(ticketMedio(1000, 4)).toBe(250)
  })

  it('zero vendas: null, nunca divisão por zero', () => {
    expect(ticketMedio(0, 0)).toBeNull()
  })
})

describe('metaProporcionalPeriodo', () => {
  it('mês completo = 100% da meta do mês', () => {
    const mensal = [{ mes: '2026-10', valorMeta: 31000 }]
    expect(metaProporcionalPeriodo(mensal, { inicio: '2026-10-01', fim: '2026-10-31' })).toBe(31000)
  })

  it('mês parcial = fração de dias (01/10 a 07/10 = 7/31)', () => {
    const mensal = [{ mes: '2026-10', valorMeta: 31000 }]
    const resultado = metaProporcionalPeriodo(mensal, { inicio: '2026-10-01', fim: '2026-10-07' })
    expect(resultado).toBeCloseTo((31000 * 7) / 31)
  })

  it('mês anterior: usa a meta DAQUELE mês, não a do mês atual', () => {
    const mensal = [
      { mes: '2026-09', valorMeta: 9000 },
      { mes: '2026-10', valorMeta: 99999 }, // não deve entrar
    ]
    expect(metaProporcionalPeriodo(mensal, { inicio: '2026-09-01', fim: '2026-09-30' })).toBe(9000)
  })

  it('90 dias atravessando 3 meses: soma a parcela de cada mês tocado', () => {
    // 18/07 a 15/10/2026 — 3 meses, cada um só com a fração de dias dentro do período.
    const mensal = [
      { mes: '2026-07', valorMeta: 3100 }, // 31 dias no mês; tocados: 18–31 = 14 dias
      { mes: '2026-08', valorMeta: 3100 }, // mês inteiro tocado = 31 dias
      { mes: '2026-09', valorMeta: 3000 }, // mês inteiro tocado = 30 dias
      { mes: '2026-10', valorMeta: 3100 }, // tocados: 1–15 = 15 dias
    ]
    const periodo = { inicio: '2026-07-18', fim: '2026-10-15' }
    const esperado = (3100 * 14) / 31 + 3100 + 3000 + (3100 * 15) / 31
    expect(metaProporcionalPeriodo(mensal, periodo)).toBeCloseTo(esperado)
  })

  it('este ano: soma jan até o fim do período selecionado', () => {
    const mensal = [
      { mes: '2026-01', valorMeta: 1000 },
      { mes: '2026-02', valorMeta: 1000 },
      { mes: '2026-10', valorMeta: 3100 }, // tocado parcialmente: 1–15
      { mes: '2026-11', valorMeta: 5000 }, // fora do período, não deve entrar
    ]
    const periodo = { inicio: '2026-01-01', fim: '2026-10-15' }
    const esperado = 1000 + 1000 + (3100 * 15) / 31
    expect(metaProporcionalPeriodo(mensal, periodo)).toBeCloseTo(esperado)
  })

  it('personalizado (fronteira entre dois meses) respeita exatamente início/fim', () => {
    const mensal = [
      { mes: '2026-10', valorMeta: 3100 }, // tocado: 20–31 = 12 dias
      { mes: '2026-11', valorMeta: 3000 }, // tocado: 1–5 = 5 dias
    ]
    const periodo = { inicio: '2026-10-20', fim: '2026-11-05' }
    const esperado = (3100 * 12) / 31 + (3000 * 5) / 30
    expect(metaProporcionalPeriodo(mensal, periodo)).toBeCloseTo(esperado)
  })

  it('ausência de meta em TODOS os meses tocados: null, não zero', () => {
    expect(metaProporcionalPeriodo([], { inicio: '2026-10-01', fim: '2026-10-31' })).toBeNull()
  })

  it('mês sem meta no meio do intervalo contribui 0, não anula os outros meses', () => {
    const mensal = [
      { mes: '2026-08', valorMeta: 1000 },
      // setembro sem linha nenhuma (sem meta definida)
      { mes: '2026-10', valorMeta: 1000 },
    ]
    const periodo = { inicio: '2026-08-01', fim: '2026-10-31' }
    expect(metaProporcionalPeriodo(mensal, periodo)).toBe(2000)
  })

  it('meta zero (valor definido como 0) é diferente de meta ausente: resultado 0, não null', () => {
    const mensal = [{ mes: '2026-10', valorMeta: 0 }]
    expect(metaProporcionalPeriodo(mensal, { inicio: '2026-10-01', fim: '2026-10-31' })).toBe(0)
  })

  it('TCV e MRR são somas independentes (duas chamadas, duas listas)', () => {
    const tcv = [{ mes: '2026-10', valorMeta: 31000 }]
    const mrr = [{ mes: '2026-10', valorMeta: 3100 }]
    const periodo = { inicio: '2026-10-01', fim: '2026-10-31' }
    expect(metaProporcionalPeriodo(tcv, periodo)).toBe(31000)
    expect(metaProporcionalPeriodo(mrr, periodo)).toBe(3100)
  })
})
