import { describe, expect, it } from 'vitest'

import { formatarTempoParado } from '@/lib/utils/formatacao'

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
