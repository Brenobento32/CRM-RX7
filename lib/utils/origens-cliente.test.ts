import { describe, expect, it } from 'vitest'

import { resumoOrigensCliente } from './origens-cliente'

const rotulos = { formulario: 'Formulário', whatsapp: 'WhatsApp', manual: 'Manual' } as const

describe('resumoOrigensCliente', () => {
  it('sem nenhuma negociação: travessão', () => {
    expect(resumoOrigensCliente([], rotulos)).toBe('—')
  })

  it('uma única origem, uma negociação: o rótulo dela', () => {
    expect(resumoOrigensCliente(['formulario'], rotulos)).toBe('Formulário')
  })

  it('duas negociações, mesma origem: continua sendo só aquela, não "múltiplas"', () => {
    expect(resumoOrigensCliente(['whatsapp', 'whatsapp'], rotulos)).toBe('WhatsApp')
  })

  it('duas negociações, origens diferentes: "Múltiplas origens"', () => {
    expect(resumoOrigensCliente(['formulario', 'whatsapp'], rotulos)).toBe('Múltiplas origens')
  })

  it('três negociações, três origens diferentes: "Múltiplas origens"', () => {
    expect(resumoOrigensCliente(['formulario', 'whatsapp', 'manual'], rotulos)).toBe('Múltiplas origens')
  })
})
