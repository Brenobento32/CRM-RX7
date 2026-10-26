import { describe, expect, it } from 'vitest'

import { formatarMoedaCompacta, formatarTempoParado } from '@/lib/utils/formatacao'

describe('formatarTempoParado', () => {
  it('0 segundos → "Parado há 1 min" (mínimo exibido)', () => {
    expect(formatarTempoParado(0)).toBe('Parado há 1 min')
  })

  it('30 segundos → "Parado há 1 min" (menos de 1 minuto)', () => {
    expect(formatarTempoParado(30 * 1000)).toBe('Parado há 1 min')
  })

  it('1 minuto → "Parado há 1 min"', () => {
    expect(formatarTempoParado(60 * 1000)).toBe('Parado há 1 min')
  })

  it('10 minutos → "Parado há 10 min"', () => {
    expect(formatarTempoParado(10 * 60 * 1000)).toBe('Parado há 10 min')
  })

  it('59 minutos → "Parado há 59 min"', () => {
    expect(formatarTempoParado(59 * 60 * 1000)).toBe('Parado há 59 min')
  })

  it('60 minutos → "Parado há 1h"', () => {
    expect(formatarTempoParado(60 * 60 * 1000)).toBe('Parado há 1h')
  })

  it('90 minutos → "Parado há 1h" (arredonda horas para baixo)', () => {
    expect(formatarTempoParado(90 * 60 * 1000)).toBe('Parado há 1h')
  })

  it('6 horas → "Parado há 6h"', () => {
    expect(formatarTempoParado(6 * 60 * 60 * 1000)).toBe('Parado há 6h')
  })

  it('23 horas → "Parado há 23h"', () => {
    expect(formatarTempoParado(23 * 60 * 60 * 1000)).toBe('Parado há 23h')
  })

  it('24 horas → "Parado há 1 dia" (singular)', () => {
    expect(formatarTempoParado(24 * 60 * 60 * 1000)).toBe('Parado há 1 dia')
  })

  it('48 horas → "Parado há 2 dias" (plural)', () => {
    expect(formatarTempoParado(48 * 60 * 60 * 1000)).toBe('Parado há 2 dias')
  })

  it('vários dias → arredonda dias para baixo', () => {
    expect(formatarTempoParado(10 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000)).toBe('Parado há 10 dias')
  })

  it('nunca fica negativo (relógio ligeiramente adiantado no servidor)', () => {
    expect(formatarTempoParado(-5000)).toBe('Parado há 1 min')
  })
})

describe('formatarMoedaCompacta', () => {
  // Espaço inseparável entre "R$" e o número e antes do sufixo, como no pt-BR.
  const r = (t: string) => t.replace(/ /g, ' ')

  it.each([
    [0, 'R$ 0'],
    [0.004, 'R$ 0'],
    [0.05, 'R$ 0,1'],
    [0.4, 'R$ 0,4'],
    [1, 'R$ 1'],
    [9.99, 'R$ 10'],
    [12.34, 'R$ 12,3'],
    [950.5, 'R$ 950,5'],
    [999.4, 'R$ 999,4'],
  ])('valores pequenos e decimais: %s → %s', (valor, esperado) => {
    expect(formatarMoedaCompacta(valor)).toBe(r(esperado))
  })

  it.each([
    [999.96, 'R$ 1 mil'],
    [1000, 'R$ 1 mil'],
    [1049, 'R$ 1 mil'],
    [1050, 'R$ 1,1 mil'],
    [1234, 'R$ 1,2 mil'],
    [9999, 'R$ 10 mil'],
    [99949, 'R$ 99,9 mil'],
    [99950, 'R$ 100 mil'],
    [123456, 'R$ 123,5 mil'],
  ])('milhares: %s → %s', (valor, esperado) => {
    expect(formatarMoedaCompacta(valor)).toBe(r(esperado))
  })

  it.each([
    [999950, 'R$ 1 mi'],
    [1234567, 'R$ 1,2 mi'],
    [15500000, 'R$ 15,5 mi'],
    [999999999, 'R$ 1 bi'],
    [1234567890, 'R$ 1,2 bi'],
    [1.5e12, 'R$ 1,5 tri'],
    [1.5e15, 'R$ 1.500 tri'],
  ])('milhões e acima: %s → %s', (valor, esperado) => {
    expect(formatarMoedaCompacta(valor)).toBe(r(esperado))
  })

  it.each([
    [-1, '-R$ 1'],
    [-950.5, '-R$ 950,5'],
    [-1234, '-R$ 1,2 mil'],
    [-1234567, '-R$ 1,2 mi'],
    [-0.004, 'R$ 0'],
    [-0, 'R$ 0'],
  ])('negativos: %s → %s (sem "-R$ 0")', (valor, esperado) => {
    expect(formatarMoedaCompacta(valor)).toBe(r(esperado))
  })

  it('não depende do Intl compacto: o texto nunca leva zero decimal à direita', () => {
    for (const v of [0, 10, 1000, 2e6, 3e9]) expect(formatarMoedaCompacta(v)).not.toMatch(/,0(D|$)/)
  })
})
