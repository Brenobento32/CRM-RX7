import { describe, expect, it } from 'vitest'

import { rotuloDaOrigem } from './funil'

describe('rótulo da origem do lead', () => {
  it('lead do Google Sheets aparece como "Google Sheets" sem mudar a classe gravada', () => {
    expect(rotuloDaOrigem('formulario', { fonte: 'google_sheets' })).toBe('Google Sheets')
  })

  it('demais casos mantêm o rótulo da classe', () => {
    expect(rotuloDaOrigem('formulario', null)).toBe('Formulário')
    expect(rotuloDaOrigem('formulario', { fonte: 'desconhecida' })).toBe('Formulário')
    expect(rotuloDaOrigem('whatsapp', { fonte: 'whatsapp_cloud' })).toBe('WhatsApp')
    expect(rotuloDaOrigem('manual')).toBe('Manual')
    expect(rotuloDaOrigem('formulario', { fonte: 123 })).toBe('Formulário')
  })
})
