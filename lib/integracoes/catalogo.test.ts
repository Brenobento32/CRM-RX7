import { describe, expect, it } from 'vitest'

import { CATALOGO, situacaoDaFonte } from './catalogo'

describe('catálogo de fontes', () => {
  it('Meta e WhatsApp nunca aparecem como prontos', () => {
    for (const tipo of ['meta_lead_ads', 'whatsapp_cloud']) {
      expect(CATALOGO.find((i) => i.tipo === tipo)?.situacao).toBe('requer_configuracao')
    }
  })

  it('situação não declara "recebendo" sem validação e sem lead real', () => {
    const base = { status: 'ativa' as const, validadaEm: null, ultimoLeadEm: null }
    expect(situacaoDaFonte({ ...base, tipo: 'meta_lead_ads' }).tom).toBe('espera')
    expect(situacaoDaFonte({ ...base, tipo: 'meta_lead_ads', ultimoLeadEm: '2026-10-22' }).rotulo).toMatch(/validação/)
    expect(situacaoDaFonte({ ...base, tipo: 'webhook' }).rotulo).toMatch(/primeiro lead/)
    expect(situacaoDaFonte({ ...base, tipo: 'webhook', ultimoLeadEm: '2026-10-22' }).tom).toBe('ok')
    expect(situacaoDaFonte({ ...base, tipo: 'webhook', status: 'revogada', ultimoLeadEm: 'x' }).rotulo).toBe('Revogada')
  })
})
