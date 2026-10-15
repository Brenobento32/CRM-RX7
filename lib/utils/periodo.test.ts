import { describe, expect, it } from 'vitest'

import { chavePeriodoFunil, periodoCorrespondeAoMes, resolverPeriodoFunil } from '@/lib/utils/periodo'

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
})

describe('periodoCorrespondeAoMes', () => {
  it('mês inteiro (dia 1 ao último dia) bate com o mês', () => {
    expect(periodoCorrespondeAoMes({ inicio: '2026-10-01', fim: '2026-10-31' }, '2026-10')).toBe(true)
  })

  it('mês até hoje (mês em andamento) bate com o mês', () => {
    expect(periodoCorrespondeAoMes({ inicio: '2026-10-01', fim: HOJE }, '2026-10')).toBe(true)
  })

  it('nenhum atalho rolante (7d/30d/90d) bate com o mês por acaso', () => {
    expect(periodoCorrespondeAoMes(resolverPeriodoFunil('7d', {}, HOJE), '2026-10')).toBe(false)
    expect(periodoCorrespondeAoMes(resolverPeriodoFunil('30d', {}, HOJE), '2026-10')).toBe(false)
    expect(periodoCorrespondeAoMes(resolverPeriodoFunil('90d', {}, HOJE), '2026-10')).toBe(false)
  })

  it('"este ano" não bate com o mês (período maior que o mês)', () => {
    expect(periodoCorrespondeAoMes(resolverPeriodoFunil('ano', {}, HOJE), '2026-10')).toBe(false)
  })

  it('início fora do dia 1 não bate, mesmo no mês certo', () => {
    expect(periodoCorrespondeAoMes({ inicio: '2026-10-02', fim: '2026-10-31' }, '2026-10')).toBe(false)
  })

  it('mês diferente do pedido não bate, mesmo começando no dia 1', () => {
    expect(periodoCorrespondeAoMes({ inicio: '2026-09-01', fim: '2026-09-30' }, '2026-10')).toBe(false)
  })
})
