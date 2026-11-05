import { describe, expect, it } from 'vitest'

import { corpoDoEvento, type EventoFila } from '../../supabase/functions/_shared/meta-conversoes.ts'

/**
 * Venda fechada (20261113090100): o banco decide SE há valor (modalidade
 * aprovada + "Enviar o valor da venda" + fechamento válido). O corpo só
 * reflete isso: sem valor, nada de value/currency; com valor, BRL.
 */
const base: EventoFila = {
  evento_id: 1,
  conexao_id: 'c',
  dataset_id: '800000000000001',
  codigo_teste: null,
  evento: 'Venda fechada',
  event_id: 'avante-neg-etapa',
  event_time_unix: 1793800000,
  lead_id: '1234567890123456',
  valor: null,
  moeda: null,
  email: null,
  telefone: null,
}

describe('evento de venda fechada para a Meta', () => {
  it('sem valor aprovado: só o evento, sem value nem currency, e sem contato', async () => {
    const c = JSON.parse(await corpoDoEvento(base))
    expect(c.data[0].custom_data).toEqual({ event_source: 'crm', lead_event_source: 'AVANTE CRM' })
    expect(c.data[0].user_data).toEqual({ lead_id: 1234567890123456 })
    expect(c.data[0].event_time).toBe(1793800000)
    expect(c.data[0].event_id).toBe('avante-neg-etapa')
  })

  it('com valor aprovado: value com 2 casas e currency BRL', async () => {
    const c = JSON.parse(await corpoDoEvento({ ...base, valor: '2500.00', moeda: 'BRL' }))
    expect(c.data[0].custom_data).toMatchObject({ value: 2500, currency: 'BRL' })
  })

  it('lead_id inválido ou ausente: nada é montado (nunca um evento sem o lead da Meta)', async () => {
    await expect(corpoDoEvento({ ...base, lead_id: null })).rejects.toThrow('Evento sem ID de lead da Meta válido.')
    await expect(corpoDoEvento({ ...base, lead_id: '123' })).rejects.toThrow('Evento sem ID de lead da Meta válido.')
  })
})
