import { describe, expect, it } from 'vitest'

import {
  fracaoDonut,
  larguraDegrauPorIndice,
  LARGURA_MAX_FUNIL,
  LARGURA_MIN_FUNIL,
  temEntradaDireta,
} from './painel-metricas'

describe('larguraDegrauPorIndice', () => {
  it('primeiro degrau (índice 0) sempre na largura máxima, não importa o funil', () => {
    expect(larguraDegrauPorIndice(0, 5)).toBe(LARGURA_MAX_FUNIL)
    expect(larguraDegrauPorIndice(0, 2)).toBe(LARGURA_MAX_FUNIL)
  })

  it('último degrau sempre na largura mínima', () => {
    expect(larguraDegrauPorIndice(4, 5)).toBe(LARGURA_MIN_FUNIL)
    expect(larguraDegrauPorIndice(1, 2)).toBe(LARGURA_MIN_FUNIL)
  })

  it('degraus do meio interpolados linearmente só pela posição', () => {
    expect(larguraDegrauPorIndice(2, 5)).toBe(70)
  })

  it('nunca depende do valor de conversão — a mesma posição relativa muda com o total de degraus, nunca com dado algum', () => {
    expect(larguraDegrauPorIndice(1, 3)).toBe(70)
    expect(larguraDegrauPorIndice(1, 5)).toBe(85)
  })

  it('um único degrau (funil sem etapas) fica na largura máxima, sem dividir por zero', () => {
    expect(larguraDegrauPorIndice(0, 1)).toBe(LARGURA_MAX_FUNIL)
    expect(larguraDegrauPorIndice(0, 0)).toBe(LARGURA_MAX_FUNIL)
  })
})

describe('temEntradaDireta', () => {
  it('true quando a etapa alcançou mais que a anterior', () => {
    expect(temEntradaDireta(0.875, 0.75)).toBe(true)
  })

  it('false quando é menor ou igual', () => {
    expect(temEntradaDireta(0.5, 0.75)).toBe(false)
    expect(temEntradaDireta(0.75, 0.75)).toBe(false)
  })

  it('false quando falta algum dos dois lados (primeira etapa, sem anterior)', () => {
    expect(temEntradaDireta(0.5, null)).toBe(false)
    expect(temEntradaDireta(null, 0.5)).toBe(false)
    expect(temEntradaDireta(null, null)).toBe(false)
  })
})

describe('fracaoDonut', () => {
  it('igual ao percentual entre 0 e 1', () => {
    expect(fracaoDonut(0.3)).toBe(0.3)
  })

  it('limitada a 1 (100%) mesmo acima da meta', () => {
    expect(fracaoDonut(1.5)).toBe(1)
  })

  it('0 quando não há meta definida (null)', () => {
    expect(fracaoDonut(null)).toBe(0)
  })

  it('nunca negativa', () => {
    expect(fracaoDonut(-0.2)).toBe(0)
  })
})
