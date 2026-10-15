import { describe, expect, it } from 'vitest'

import { chavePeriodoFunil, resolverPeriodoFunil } from '@/lib/utils/periodo'

const HOJE = '2026-10-15'

describe('chavePeriodoFunil', () => {
  it('aceita os 5 atalhos válidos', () => {
    expect(chavePeriodoFunil('7d')).toBe('7d')
    expect(chavePeriodoFunil('30d')).toBe('30d')
    expect(chavePeriodoFunil('90d')).toBe('90d')
    expect(chavePeriodoFunil('ano')).toBe('ano')
    expect(chavePeriodoFunil('personalizado')).toBe('personalizado')
  })

  it('cai em 30d para qualquer valor inválido/ausente', () => {
    expect(chavePeriodoFunil(undefined)).toBe('30d')
    expect(chavePeriodoFunil('mes')).toBe('30d') // atalho de outra tela, não existe aqui
    expect(chavePeriodoFunil('15d')).toBe('30d')
    expect(chavePeriodoFunil(['7d'])).toBe('30d')
  })
})

describe('resolverPeriodoFunil', () => {
  it('7 dias', () => {
    expect(resolverPeriodoFunil('7d', {}, HOJE)).toEqual({ chave: '7d', inicio: '2026-10-09', fim: HOJE })
  })

  it('30 dias', () => {
    expect(resolverPeriodoFunil('30d', {}, HOJE)).toEqual({ chave: '30d', inicio: '2026-09-16', fim: HOJE })
  })

  it('90 dias', () => {
    expect(resolverPeriodoFunil('90d', {}, HOJE)).toEqual({ chave: '90d', inicio: '2026-07-18', fim: HOJE })
  })

  it('este ano', () => {
    expect(resolverPeriodoFunil('ano', {}, HOJE)).toEqual({ chave: 'ano', inicio: '2026-01-01', fim: HOJE })
  })

  it('personalizado com datas válidas', () => {
    expect(resolverPeriodoFunil('personalizado', { inicio: '2026-10-01', fim: '2026-10-15' }, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-10-01',
      fim: '2026-10-15',
    })
  })

  it('personalizado troca início/fim quando vêm invertidos', () => {
    expect(resolverPeriodoFunil('personalizado', { inicio: '2026-10-15', fim: '2026-10-01' }, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-10-01',
      fim: '2026-10-15',
    })
  })

  it('personalizado sem datas (ou inválidas) cai em 30 dias', () => {
    expect(resolverPeriodoFunil('personalizado', {}, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-09-16',
      fim: HOJE,
    })
    expect(resolverPeriodoFunil('personalizado', { inicio: 'lixo', fim: '2026-10-15' }, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-09-16',
      fim: HOJE,
    })
    expect(resolverPeriodoFunil('personalizado', { inicio: ['2026-10-01'], fim: '2026-10-15' }, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-09-16',
      fim: HOJE,
    })
  })

  it('transição: de "personalizado" para um atalho — cada chamada é independente, sem estado residual', () => {
    const personalizado = resolverPeriodoFunil('personalizado', { inicio: '2026-01-01', fim: '2026-01-05' }, HOJE)
    const depois30d = resolverPeriodoFunil('30d', {}, HOJE)
    expect(personalizado.chave).toBe('personalizado')
    expect(depois30d).toEqual({ chave: '30d', inicio: '2026-09-16', fim: HOJE })
  })

  it('transição: de um atalho para "personalizado" — não herda nada do atalho anterior', () => {
    resolverPeriodoFunil('7d', {}, HOJE)
    const personalizado = resolverPeriodoFunil('personalizado', { inicio: '2026-02-01', fim: '2026-02-10' }, HOJE)
    expect(personalizado).toEqual({ chave: 'personalizado', inicio: '2026-02-01', fim: '2026-02-10' })
  })
})
