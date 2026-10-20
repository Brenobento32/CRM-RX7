import { describe, expect, it } from 'vitest'

import { chavePeriodoFunil, resolverPeriodoFunil, ultimoDiaDoMes } from '@/lib/utils/periodo'

describe('ultimoDiaDoMes', () => {
  it('mês de 31 dias', () => {
    expect(ultimoDiaDoMes('2026-10')).toBe('2026-10-31')
  })

  it('mês de 30 dias', () => {
    expect(ultimoDiaDoMes('2026-09')).toBe('2026-09-30')
  })

  it('fevereiro em ano bissexto', () => {
    expect(ultimoDiaDoMes('2028-02')).toBe('2028-02-29')
  })

  it('fevereiro em ano não bissexto', () => {
    expect(ultimoDiaDoMes('2026-02')).toBe('2026-02-28')
  })

  it('dezembro', () => {
    expect(ultimoDiaDoMes('2026-12')).toBe('2026-12-31')
  })
})

const HOJE = '2026-10-15'

describe('chavePeriodoFunil', () => {
  it('aceita os 8 atalhos válidos', () => {
    expect(chavePeriodoFunil('hoje')).toBe('hoje')
    expect(chavePeriodoFunil('mes')).toBe('mes')
    expect(chavePeriodoFunil('7d')).toBe('7d')
    expect(chavePeriodoFunil('15d')).toBe('15d')
    expect(chavePeriodoFunil('30d')).toBe('30d')
    expect(chavePeriodoFunil('90d')).toBe('90d')
    expect(chavePeriodoFunil('ano')).toBe('ano')
    expect(chavePeriodoFunil('personalizado')).toBe('personalizado')
  })

  it('cai em "mes" (Este mês) para qualquer valor inválido/ausente — nunca 30 dias', () => {
    expect(chavePeriodoFunil(undefined)).toBe('mes')
    expect(chavePeriodoFunil('mes_anterior')).toBe('mes') // atalho de outra tela, não existe aqui
    expect(chavePeriodoFunil('lixo')).toBe('mes')
    expect(chavePeriodoFunil(['7d'])).toBe('mes')
  })
})

describe('resolverPeriodoFunil', () => {
  it('hoje', () => {
    expect(resolverPeriodoFunil('hoje', {}, HOJE)).toEqual({ chave: 'hoje', inicio: HOJE, fim: HOJE })
  })

  it('este mês', () => {
    expect(resolverPeriodoFunil('mes', {}, HOJE)).toEqual({ chave: 'mes', inicio: '2026-10-01', fim: HOJE })
  })

  it('este mês no primeiro dia do mês: início = fim = hoje', () => {
    expect(resolverPeriodoFunil('mes', {}, '2026-10-01')).toEqual({
      chave: 'mes',
      inicio: '2026-10-01',
      fim: '2026-10-01',
    })
  })

  it('este mês em janeiro (mudança de ano)', () => {
    expect(resolverPeriodoFunil('mes', {}, '2026-01-15')).toEqual({
      chave: 'mes',
      inicio: '2026-01-01',
      fim: '2026-01-15',
    })
  })

  it('este mês em fevereiro (último dia, ano não bissexto)', () => {
    expect(resolverPeriodoFunil('mes', {}, '2026-02-28')).toEqual({
      chave: 'mes',
      inicio: '2026-02-01',
      fim: '2026-02-28',
    })
  })

  it('este mês em fevereiro (último dia, ano bissexto)', () => {
    expect(resolverPeriodoFunil('mes', {}, '2028-02-29')).toEqual({
      chave: 'mes',
      inicio: '2028-02-01',
      fim: '2028-02-29',
    })
  })

  it('7 dias', () => {
    expect(resolverPeriodoFunil('7d', {}, HOJE)).toEqual({ chave: '7d', inicio: '2026-10-09', fim: HOJE })
  })

  it('15 dias', () => {
    expect(resolverPeriodoFunil('15d', {}, HOJE)).toEqual({ chave: '15d', inicio: '2026-10-01', fim: HOJE })
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

  it('personalizado sem datas (ou inválidas) cai no intervalo de "Este mês" — nunca 30 dias', () => {
    expect(resolverPeriodoFunil('personalizado', {}, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-10-01',
      fim: HOJE,
    })
    expect(resolverPeriodoFunil('personalizado', { inicio: 'lixo', fim: '2026-10-15' }, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-10-01',
      fim: HOJE,
    })
    expect(resolverPeriodoFunil('personalizado', { inicio: ['2026-10-01'], fim: '2026-10-15' }, HOJE)).toEqual({
      chave: 'personalizado',
      inicio: '2026-10-01',
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
