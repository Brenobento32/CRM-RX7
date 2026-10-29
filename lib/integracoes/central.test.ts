import { describe, expect, it } from 'vitest'

import { INFO, INTEGRACOES, cartoesWhatsapp, estadoDoCartao, grupoDoCartao, infoDoCartao, lerLinhasCentral, limiteAtingido, textoDoLimite, type LinhaCentral } from './central'

const base: LinhaCentral = {
  integracao: 'google_sheets',
  lancada: true,
  noPlano: true,
  regra: null,
  permitida: true,
  emUso: 0,
  comErro: 0,
  pendentes: 0,
  ultimaAtividade: null,
  solicitadaEm: null,
  planoNome: 'Business',
  limiteFontes: 5,
  usoFontes: 0,
  limiteFontesDefinido: true,
  limiteNumeros: 2,
  limiteNumerosDefinido: true,
  usoNumeros: 0,
}

describe('Central de Integrações — cartões', () => {
  it('WhatsApp: UMA integração no banco, DOIS cartões oficiais (número novo e app existente); nenhum QR não oficial', () => {
    expect(INTEGRACOES).toEqual(['formularios', 'google_sheets', 'whatsapp_oficial', 'meta_conversoes'])
    expect(INFO.whatsapp_oficial.nome).toBe('WhatsApp Business — API Oficial')
    expect(INFO.whatsapp_app.nome).toBe('WhatsApp Business — Conectar aplicativo existente')
    expect(JSON.stringify(INFO)).not.toMatch(/espelhamento|WhatsApp Web/i)
  })
  it('os dois cartões contam cada modo e herdam a MESMA permissão da linha do banco', () => {
    const linha = { ...base, integracao: 'whatsapp_oficial' as const, emUso: 3, ultimaAtividade: '2026-10-28T10:00:00Z' }
    const [a, b] = cartoesWhatsapp(linha, [
      { modo: 'cloud_api', situacao: 'conectado', comErro: false },
      { modo: 'cloud_api', situacao: 'pendente_registro', comErro: false },
      { modo: 'coexistencia', situacao: 'conectado', comErro: true },
      { modo: 'coexistencia', situacao: 'desconectado', comErro: false },
    ])
    expect([a.cartao, a.emUso, a.pendentes, a.comErro]).toEqual(['whatsapp_oficial', 2, 1, 0])
    expect([b.cartao, b.emUso, b.comErro, estadoDoCartao(b)]).toEqual(['whatsapp_app', 1, 1, 'erro'])
    expect(infoDoCartao(b).nome).toContain('aplicativo existente')
    expect(grupoDoCartao({ ...b, permitida: false })).toBe('upgrade')
    expect(limiteAtingido({ ...b, usoNumeros: 2 })).toBe(true)
  })
  it('não lançada nunca aparece como operacional (vai para "em breve")', () => {
    expect(grupoDoCartao({ ...base, lancada: false, permitida: true })).toBe('em_breve')
  })
  it('lançada e permitida = cartão liberado; lançada sem permissão = upgrade', () => {
    expect(grupoDoCartao(base)).toBe('liberada')
    expect(grupoDoCartao({ ...base, permitida: false })).toBe('upgrade')
  })
})

describe('Central de Integrações — estado do cartão', () => {
  it('sem uso: não conectado; limite do plano cheio: limite atingido', () => {
    expect(estadoDoCartao(base)).toBe('nao_conectado')
    expect(estadoDoCartao({ ...base, usoFontes: 5 })).toBe('limite_atingido')
  })
  it('conectado sem atividade ainda; ativo com atividade; erro tem prioridade', () => {
    expect(estadoDoCartao({ ...base, emUso: 1 })).toBe('conectado')
    expect(estadoDoCartao({ ...base, emUso: 1, pendentes: 1, ultimaAtividade: '2026-10-28T10:00:00Z' })).toBe('conectado')
    expect(estadoDoCartao({ ...base, emUso: 2, pendentes: 1, ultimaAtividade: '2026-10-28T10:00:00Z' })).toBe('ativo')
    expect(estadoDoCartao({ ...base, emUso: 2, comErro: 1, ultimaAtividade: '2026-10-28T10:00:00Z' })).toBe('erro')
  })
})

describe('Central de Integrações — limites reais (ausência não é ilimitado)', () => {
  it('limite não cadastrado = "a definir", nunca liberado', () => {
    expect(estadoDoCartao({ ...base, limiteFontes: null, limiteFontesDefinido: false })).toBe('limite_a_definir')
    expect(textoDoLimite({ ...base, limiteFontes: null, limiteFontesDefinido: false, usoFontes: 3 })).toContain('limite a definir')
  })
  it('os dois cartões de WhatsApp usam o MESMO limite de números', () => {
    const cheio = { ...base, usoNumeros: 2 }
    expect(limiteAtingido({ ...cheio, integracao: 'whatsapp_oficial' })).toBe(true)
    expect(limiteAtingido({ ...cheio, integracao: 'whatsapp_oficial', cartao: 'whatsapp_app' })).toBe(true)
    expect(limiteAtingido({ ...cheio, integracao: 'google_sheets' })).toBe(false)
    expect(estadoDoCartao({ ...base, integracao: 'whatsapp_oficial', cartao: 'whatsapp_app', limiteNumeros: null, limiteNumerosDefinido: false })).toBe('limite_a_definir')
  })
  it('empresa interna: definido sem limite', () => {
    expect(textoDoLimite({ ...base, planoNome: null, limiteFontes: null, usoFontes: 3, limiteNumeros: null, usoNumeros: 1 })).toBe(
      'Sem plano vinculado: 3 fonte(s) de captação em uso (sem limite de plano); 1 número(s) de WhatsApp em uso (sem limite de plano).',
    )
    expect(textoDoLimite({ ...base, usoFontes: 3, usoNumeros: 1 })).toBe('Plano Business: 3 de 5 fonte(s) de captação; 1 de 2 número(s) de WhatsApp.')
  })
})

describe('Central de Integrações — leitura do banco', () => {
  it('converte as colunas e descarta integração desconhecida', () => {
    const linhas = lerLinhasCentral([
      { integracao: 'whatsapp_oficial', lancada: true, no_plano: false, regra: 'liberar', permitida: true, em_uso: 1, com_erro: 0, pendentes: 0,
        ultima_atividade: '2026-10-28T10:00:00Z', solicitada_em: null, plano_nome: 'Pro', limite_fontes: 2, uso_fontes: 1,
        limite_fontes_definido: true, limite_numeros: null, limite_numeros_definido: false, uso_numeros: 1 },
      { integracao: 'meta_lead_ads', lancada: true },
    ])
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({ integracao: 'whatsapp_oficial', regra: 'liberar', limiteNumeros: null, limiteNumerosDefinido: false, usoNumeros: 1 })
    expect(lerLinhasCentral(null)).toEqual([])
  })
})
