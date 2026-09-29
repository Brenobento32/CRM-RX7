import { describe, expect, it } from 'vitest'

import { formatarDuracaoHistorico, montarHistorico, type LinhaHistoricoBruta } from '@/lib/utils/historico'

function linha(id: number, etapaNome: string, criadoEm: string): LinhaHistoricoBruta {
  return { id, etapaNome, etapaCor: 'azul', usuarioNome: 'Closer Teste', criadoEm }
}

describe('montarHistorico', () => {
  it('calcula entrada/saída/duração encadeando created_at consecutivos', () => {
    const linhas = [
      linha(1, 'Reunião agendada', '2026-09-24T09:00:00.000Z'),
      linha(2, 'Reunião realizada', '2026-09-26T14:20:00.000Z'),
      linha(3, 'Proposta enviada', '2026-09-29T10:15:00.000Z'),
    ]

    const agora = new Date('2026-09-29T12:15:00.000Z').getTime()
    const entradas = montarHistorico(linhas, agora)

    expect(entradas).toHaveLength(3)
    expect(entradas[0].saida).toBe('2026-09-26T14:20:00.000Z')
    expect(entradas[0].duracaoMs).toBe(Date.parse('2026-09-26T14:20:00.000Z') - Date.parse('2026-09-24T09:00:00.000Z'))
    expect(entradas[1].saida).toBe('2026-09-29T10:15:00.000Z')
  })

  it('a etapa mais recente não tem saída e a duração é até "agora"', () => {
    const linhas = [linha(1, 'Reunião agendada', '2026-09-24T09:00:00.000Z')]
    const agora = new Date('2026-09-24T11:00:00.000Z').getTime()

    const [entrada] = montarHistorico(linhas, agora)

    expect(entrada.saida).toBeNull()
    expect(entrada.duracaoMs).toBe(2 * 60 * 60 * 1000)
  })

  it('ordena por created_at mesmo se as linhas chegarem fora de ordem', () => {
    const linhas = [
      linha(2, 'Reunião realizada', '2026-09-26T14:20:00.000Z'),
      linha(1, 'Reunião agendada', '2026-09-24T09:00:00.000Z'),
    ]

    const entradas = montarHistorico(linhas, Date.parse('2026-09-27T00:00:00.000Z'))

    expect(entradas[0].id).toBe(1)
    expect(entradas[1].id).toBe(2)
  })

  it('suporta voltar para uma etapa anterior e passar pela mesma etapa mais de uma vez', () => {
    // Reunião agendada -> Proposta enviada -> volta pra Reunião agendada -> Proposta enviada de novo.
    const linhas = [
      linha(1, 'Reunião agendada', '2026-09-01T00:00:00.000Z'),
      linha(2, 'Proposta enviada', '2026-09-02T00:00:00.000Z'),
      linha(3, 'Reunião agendada', '2026-09-03T00:00:00.000Z'),
      linha(4, 'Proposta enviada', '2026-09-05T00:00:00.000Z'),
    ]

    const entradas = montarHistorico(linhas, Date.parse('2026-09-06T00:00:00.000Z'))

    expect(entradas.map((e) => e.etapaNome)).toEqual([
      'Reunião agendada',
      'Proposta enviada',
      'Reunião agendada',
      'Proposta enviada',
    ])
    // As duas passagens por "Reunião agendada" são entradas distintas, cada
    // uma com sua própria duração — nenhuma se funde com a outra.
    expect(entradas[0].duracaoMs).toBe(24 * 60 * 60 * 1000)
    expect(entradas[2].duracaoMs).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it('suporta a cadeia Perdido -> Recuperação -> Fechado sem perder nenhuma transição', () => {
    const linhas = [
      linha(1, 'Reunião agendada', '2026-09-01T00:00:00.000Z'),
      linha(2, 'Perdido', '2026-09-02T00:00:00.000Z'),
      linha(3, 'Recuperação', '2026-09-10T00:00:00.000Z'),
      linha(4, 'Fechado', '2026-09-12T00:00:00.000Z'),
    ]

    const entradas = montarHistorico(linhas, Date.parse('2026-09-13T00:00:00.000Z'))

    expect(entradas.map((e) => e.etapaNome)).toEqual(['Reunião agendada', 'Perdido', 'Recuperação', 'Fechado'])
    expect(entradas[3].saida).toBeNull()
  })
})

describe('formatarDuracaoHistorico', () => {
  it('mostra dias, horas e minutos quando há dias', () => {
    expect(formatarDuracaoHistorico((2 * 24 + 5) * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe('2d 5h20')
  })

  it('mostra horas e minutos quando há menos de um dia', () => {
    expect(formatarDuracaoHistorico(3 * 60 * 60 * 1000 + 5 * 60 * 1000)).toBe('3h05')
  })

  it('mostra só minutos quando há menos de uma hora', () => {
    expect(formatarDuracaoHistorico(45 * 60 * 1000)).toBe('45min')
  })

  it('nunca fica negativo', () => {
    expect(formatarDuracaoHistorico(-1000)).toBe('0min')
  })
})
