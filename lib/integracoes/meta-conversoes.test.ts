import { createHash, createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  classificarErro,
  corpoDoEvento,
  enviarEvento,
  idExternoDaEmpresa,
  normalizarTelefoneMeta,
  provaDoApp,
  type EventoFila,
} from '../../supabase/functions/_shared/meta-conversoes.ts'

const base: EventoFila = {
  evento_id: 1,
  conexao_id: 'c1',
  dataset_id: '1234567890',
  codigo_teste: null,
  evento: 'Reunião realizada',
  event_id: 'avante-n1-e1',
  event_time_unix: 1790000000,
  lead_id: '12345678901234567',
  valor: null,
  moeda: null,
  email: null,
  telefone: null,
}

describe('evento de Conversion Leads', () => {
  it('segue o formato da Meta: system_generated, lead_id, event_source crm e lead_event_source', async () => {
    const c = JSON.parse(await corpoDoEvento(base))
    expect(c.data[0]).toMatchObject({
      event_name: 'Reunião realizada',
      event_time: 1790000000,
      event_id: 'avante-n1-e1',
      action_source: 'system_generated',
      custom_data: { event_source: 'crm', lead_event_source: 'AVANTE CRM' },
    })
    expect(c.test_event_code).toBeUndefined()
  })

  it('lead_id de 17 dígitos vai como número SEM perder precisão', async () => {
    const texto = await corpoDoEvento(base)
    expect(texto).toContain('"lead_id":12345678901234567')
    expect(Number.isSafeInteger(12345678901234567)).toBe(false) // por isso não passa por Number()
  })

  it('sem ID de lead da Meta não há evento (nada é presumido)', async () => {
    await expect(corpoDoEvento({ ...base, lead_id: null })).rejects.toThrow(/ID de lead/)
    await expect(corpoDoEvento({ ...base, lead_id: '123' })).rejects.toThrow(/ID de lead/)
  })

  it('fechamento: valor e moeda; contato só com hash SHA-256 e só quando ligado', async () => {
    const c = JSON.parse(await corpoDoEvento({ ...base, valor: '1500.50', moeda: 'BRL', email: ' Ana@Exemplo.com ', telefone: '11999990001' }))
    expect(c.data[0].custom_data).toMatchObject({ value: 1500.5, currency: 'BRL' })
    expect(c.data[0].user_data.em).toEqual([createHash('sha256').update('ana@exemplo.com').digest('hex')])
    expect(c.data[0].user_data.ph).toEqual([createHash('sha256').update('5511999990001').digest('hex')])
    expect(JSON.stringify(c)).not.toContain('Ana@')
    expect(normalizarTelefoneMeta('5511999990001')).toBe('5511999990001')
  })

  it('código de teste do Gerenciador de Eventos só quando configurado', async () => {
    expect(JSON.parse(await corpoDoEvento({ ...base, codigo_teste: 'TEST123' })).test_event_code).toBe('TEST123')
  })
})

describe('erros da Meta', () => {
  it('classifica autorização, limite, temporário e permanente', () => {
    expect(classificarErro(400, { error: { code: 190, message: 'token' } }).resultado).toBe('autorizacao')
    expect(classificarErro(400, { error: { code: 80004 } }).resultado).toBe('limite')
    expect(classificarErro(429, {}).resultado).toBe('limite')
    expect(classificarErro(500, {}).resultado).toBe('temporario')
    expect(classificarErro(400, { error: { code: 100, error_subcode: 2804003, message: 'lead_id inválido' } }).resultado).toBe('permanente')
  })

  it('envio usa o dataset da conexão, Bearer e appsecret_proof', async () => {
    let url = ''
    let auth = ''
    const buscar = async (u: string, init?: RequestInit) => {
      url = u
      auth = String(new Headers(init?.headers).get('authorization'))
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'Abc' }))
    }
    const r = await enviarEvento(buscar, 'https://graph.exemplo/v23.0', 'token-de-sistema', 'segredo-app', base)
    expect(r).toEqual({ resultado: 'ok', erro: null, fbtrace: 'Abc' })
    expect(url).toBe(`https://graph.exemplo/v23.0/1234567890/events?appsecret_proof=${createHmac('sha256', 'segredo-app').update('token-de-sistema').digest('hex')}`)
    expect(auth).toBe('Bearer token-de-sistema')
    expect(await provaDoApp('token-de-sistema', 'segredo-app')).toBe(createHmac('sha256', 'segredo-app').update('token-de-sistema').digest('hex'))
  })
})

describe('ID externo da empresa na Meta', () => {
  it('estável por empresa, diferente entre empresas e sem revelar o tenant', async () => {
    const s = 'segredo-de-estado-com-pelo-menos-32-caracteres!!'
    const a = await idExternoDaEmpresa(s, '11111111-1111-4111-8111-111111111111')
    expect(a).toBe(await idExternoDaEmpresa(s, '11111111-1111-4111-8111-111111111111'))
    expect(a).not.toBe(await idExternoDaEmpresa(s, '22222222-2222-4222-8222-222222222222'))
    expect(a).not.toContain('1111')
  })
})
