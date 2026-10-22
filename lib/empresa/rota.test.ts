import { describe, expect, it } from 'vitest'

import { caminhoDaEmpresa, separarPrefixo, slugValido } from './rota'

describe('separarPrefixo', () => {
  it('separa a empresa e a rota interna', () => {
    expect(separarPrefixo('/e/rio-x7/funil')).toEqual({ slug: 'rio-x7', resto: '/funil' })
    expect(separarPrefixo('/e/empresa-a/clientes/123')).toEqual({ slug: 'empresa-a', resto: '/clientes/123' })
    expect(separarPrefixo('/e/rio-x7')).toEqual({ slug: 'rio-x7', resto: '/' })
    expect(separarPrefixo('/e/rio-x7/')).toEqual({ slug: 'rio-x7', resto: '/' })
  })

  it('recusa slug inválido e caminho sem prefixo', () => {
    expect(separarPrefixo('/funil')).toBeNull()
    expect(separarPrefixo('/e/')).toBeNull()
    expect(separarPrefixo('/e/Rio-X7/funil')).toBeNull()
    expect(separarPrefixo('/e/rio_x7/funil')).toBeNull()
    expect(separarPrefixo('/e/..%2f/funil')).toBeNull()
    expect(separarPrefixo('/empresas')).toBeNull()
  })
})

describe('slugValido', () => {
  it('aceita só o formato do banco', () => {
    expect(slugValido('arquivo-legado')).toBe(true)
    expect(slugValido('a')).toBe(true)
    expect(slugValido('-a')).toBe(false)
    expect(slugValido('a--b')).toBe(false)
    expect(slugValido('a'.repeat(64))).toBe(false)
    expect(slugValido(null)).toBe(false)
  })
})

describe('caminhoDaEmpresa', () => {
  it('monta a URL da empresa', () => {
    expect(caminhoDaEmpresa('rio-x7')).toBe('/e/rio-x7')
    expect(caminhoDaEmpresa('rio-x7', '/')).toBe('/e/rio-x7')
    expect(caminhoDaEmpresa('rio-x7', '/funil?funil=1')).toBe('/e/rio-x7/funil?funil=1')
    expect(caminhoDaEmpresa('rio-x7', 'clientes')).toBe('/e/rio-x7/clientes')
  })
})
