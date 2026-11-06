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

  it('modalidade do valor: TCV (total) e MRR (uma mensalidade) identificados, sem mudar o valor', async () => {
    const tcv = JSON.parse(await corpoDoEvento({ ...base, valor: '12000.00', moeda: 'BRL', modalidade: 'tcv' }))
    expect(tcv.data[0].custom_data).toMatchObject({ value: 12000, currency: 'BRL', tipo_venda: 'TCV' })
    const mrr = JSON.parse(await corpoDoEvento({ ...base, valor: '1500.00', moeda: 'BRL', modalidade: 'mrr' }))
    expect(mrr.data[0].custom_data).toMatchObject({ value: 1500, currency: 'BRL', tipo_venda: 'MRR' })
  })

  it('modalidade sem valor, desconhecida ou ausente (banco antigo): nada de tipo_venda', async () => {
    const semValor = JSON.parse(await corpoDoEvento({ ...base, modalidade: 'mrr' }))
    expect(semValor.data[0].custom_data).not.toHaveProperty('tipo_venda')
    const estranha = JSON.parse(await corpoDoEvento({ ...base, valor: '10.00', moeda: 'BRL', modalidade: '<script>' }))
    expect(estranha.data[0].custom_data).not.toHaveProperty('tipo_venda')
    const antigo = JSON.parse(await corpoDoEvento({ ...base, valor: '10.00', moeda: 'BRL' }))
    expect(antigo.data[0].custom_data).toEqual({ event_source: 'crm', lead_event_source: 'AVANTE CRM', value: 10, currency: 'BRL' })
  })

  it('lead_id inválido ou ausente: nada é montado (nunca um evento sem o lead da Meta)', async () => {
    await expect(corpoDoEvento({ ...base, lead_id: null })).rejects.toThrow('Evento sem ID de lead da Meta válido.')
    await expect(corpoDoEvento({ ...base, lead_id: '123' })).rejects.toThrow('Evento sem ID de lead da Meta válido.')
  })
})
