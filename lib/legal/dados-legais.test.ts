import { describe, expect, it } from 'vitest'

import { DADOS_LEGAIS, pendencias } from './dados-legais'

describe('dados legais das páginas públicas', () => {
  it('não há campo pendente (o aviso de rascunho some)', () => {
    expect(pendencias()).toEqual([])
  })

  it('um campo vazio volta a aparecer como pendente', () => {
    expect(pendencias({ ...DADOS_LEGAIS, cnpj: null })).toEqual(['CNPJ'])
  })

  it('não publica endereço completo nem encarregado nomeado', () => {
    expect(Object.keys(DADOS_LEGAIS)).not.toContain('endereco')
    expect(Object.keys(DADOS_LEGAIS)).not.toContain('encarregado')
    expect(DADOS_LEGAIS.localidade).toBe('Petrópolis – RJ')
  })
})
