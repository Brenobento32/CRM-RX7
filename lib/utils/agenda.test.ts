import { describe, expect, it } from 'vitest'

import { conflitosDeHorario, duracaoDoFormulario, horaFimDoFormulario } from './agenda'
import { hrefAgenda } from './calendario'

describe('duracaoDoFormulario', () => {
  it('usa a opção da lista quando a duração existe nela', () => {
    expect(duracaoDoFormulario(15)).toBe('15')
    expect(duracaoDoFormulario(45)).toBe('45')
    expect(duracaoDoFormulario(90)).toBe('90')
    expect(duracaoDoFormulario(120)).toBe('120')
  })

  it('cai em "personalizado" para qualquer outra duração', () => {
    expect(duracaoDoFormulario(20)).toBe('personalizado')
    expect(duracaoDoFormulario(0)).toBe('personalizado')
    expect(duracaoDoFormulario(240)).toBe('personalizado')
  })
})

describe('hrefAgenda (modal de reunião)', () => {
  const padrao = { visao: 'semana' as const, hoje: '2026-10-25' }

  it('nova reunião no horário clicado', () => {
    const href = hrefAgenda({ visao: 'semana', dia: '2026-10-27', nova: true, hora: '14:30' }, padrao)
    const qs = new URL(href, 'http://x').searchParams
    expect(qs.get('nova')).toBe('1')
    expect(qs.get('hora')).toBe('14:30')
    expect(qs.get('dia')).toBe('2026-10-27')
  })

  it('editar reunião existente', () => {
    const href = hrefAgenda({ visao: 'semana', dia: '2026-10-25', editar: 'abc' }, padrao)
    expect(new URL(href, 'http://x').searchParams.get('editar')).toBe('abc')
  })
})

describe('horaFimDoFormulario', () => {
  it('soma a duração escolhida', () => {
    expect(horaFimDoFormulario('10:00', '90', '')).toBe('11:30')
    expect(horaFimDoFormulario('23:30', '30', '')).toBe('00:00')
  })
  it('recusa passar da meia-noite', () => {
    expect(horaFimDoFormulario('23:30', '60', '')).toBeNull()
  })
  it('personalizada usa o término livre', () => {
    expect(horaFimDoFormulario('10:00', 'personalizado', '10:20')).toBe('10:20')
    expect(horaFimDoFormulario('10:00', 'personalizado', '')).toBeNull()
  })
})

describe('conflitosDeHorario', () => {
  const base = { titulo: 'R', status: 'agendado' }
  const ocupados = [
    { ...base, id: 'a', usuarioId: 'u1', inicio: '2026-10-27T13:00:00.000Z', fim: '2026-10-27T14:00:00.000Z' },
    { ...base, id: 'b', usuarioId: 'u2', inicio: '2026-10-27T13:00:00.000Z', fim: '2026-10-27T14:00:00.000Z' },
    { ...base, id: 'c', usuarioId: 'u1', inicio: '2026-10-27T15:00:00.000Z', fim: '2026-10-27T16:00:00.000Z', status: 'cancelado' },
  ]
  const alvo = (ini: string, fim: string, excetoId?: string) => ({
    usuarioId: 'u1',
    inicio: new Date(ini),
    fim: new Date(fim),
    excetoId,
  })

  it('acha sobreposição do mesmo responsável', () => {
    expect(conflitosDeHorario(ocupados, alvo('2026-10-27T13:30:00Z', '2026-10-27T14:30:00Z')).map((o) => o.id)).toEqual(['a'])
  })
  it('encostar no fim não é conflito', () => {
    expect(conflitosDeHorario(ocupados, alvo('2026-10-27T14:00:00Z', '2026-10-27T14:30:00Z'))).toEqual([])
  })
  it('ignora outra pessoa, cancelada e a própria reunião', () => {
    expect(conflitosDeHorario(ocupados, alvo('2026-10-27T15:00:00Z', '2026-10-27T16:00:00Z'))).toEqual([])
    expect(conflitosDeHorario(ocupados, alvo('2026-10-27T13:00:00Z', '2026-10-27T14:00:00Z', 'a'))).toEqual([])
  })
})
