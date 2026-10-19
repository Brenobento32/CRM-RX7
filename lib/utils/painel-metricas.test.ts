import { describe, expect, it } from 'vitest'

import {
  alturaBarraResultado,
  fracaoDonut,
  larguraDegrauFunil,
  LARGURA_MINIMA_FUNIL,
  temEntradaDireta,
} from './painel-metricas'

describe('larguraDegrauFunil', () => {
  it('é proporcional a conversaoAcumulada', () => {
    expect(larguraDegrauFunil(0.5)).toBe(50)
    expect(larguraDegrauFunil(1)).toBe(100)
  })

  it('nunca passa de 100%', () => {
    expect(larguraDegrauFunil(1.5)).toBe(100)
  })

  it('usa a largura mínima para fração minúscula', () => {
    expect(larguraDegrauFunil(0.001)).toBe(LARGURA_MINIMA_FUNIL)
  })

  it('usa a largura mínima quando null (sem coorte)', () => {
    expect(larguraDegrauFunil(null)).toBe(LARGURA_MINIMA_FUNIL)
  })

  it('usa a largura mínima para 0', () => {
    expect(larguraDegrauFunil(0)).toBe(LARGURA_MINIMA_FUNIL)
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

describe('alturaBarraResultado', () => {
  it('proporcional ao maior valor do conjunto', () => {
    expect(alturaBarraResultado(10, 10, 120)).toBe(120)
    expect(alturaBarraResultado(5, 10, 120)).toBe(60)
  })

  it('nunca abaixo da altura mínima, mesmo para 0', () => {
    expect(alturaBarraResultado(0, 10, 120)).toBe(8)
    expect(alturaBarraResultado(0, 10, 120, 12)).toBe(12)
  })

  it('maior <= 0 (os dois valores são zero) devolve a altura mínima, sem dividir por zero', () => {
    expect(alturaBarraResultado(0, 0, 120)).toBe(8)
    expect(Number.isFinite(alturaBarraResultado(0, 0, 120))).toBe(true)
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
