import { describe, expect, it } from 'vitest'

import { classeTextoAgenda, corDeFundoAgenda, COR_AGENDA_PADRAO, PALETA_ETAPAS, TEXTO_SOBRE_COR } from '@/lib/utils/etapas'

describe('corDeFundoAgenda', () => {
  it('usa o hex da paleta quando há cor', () => {
    expect(corDeFundoAgenda('azul')).toBe(PALETA_ETAPAS.azul.hex)
    expect(corDeFundoAgenda('amarelo')).toBe(PALETA_ETAPAS.amarelo.hex)
  })

  it('cai no neutro padrão quando a cor é nula', () => {
    expect(corDeFundoAgenda(null)).toBe(COR_AGENDA_PADRAO)
  })

  it('a cor "cinza" da paleta e o neutro padrão têm o mesmo tom (mesmo hex)', () => {
    // Documenta por que a UI precisa de um sinal além da cor para diferenciar
    // "sem cor definida" de "cor Cinza escolhida" — ver semCorDefinida().
    expect(PALETA_ETAPAS.cinza.hex).toBe(COR_AGENDA_PADRAO)
  })
})

describe('classeTextoAgenda', () => {
  it('sem cor definida usa texto claro (mesmo grupo do neutro padrão)', () => {
    expect(classeTextoAgenda(null)).toBe('text-white')
  })

  it('cada cor da paleta usa o texto com mais contraste contra o próprio hex', () => {
    for (const [cor, contraste] of Object.entries(TEXTO_SOBRE_COR)) {
      const esperado = contraste === 'escuro' ? 'text-zinc-900' : 'text-white'
      expect(classeTextoAgenda(cor as keyof typeof TEXTO_SOBRE_COR)).toBe(esperado)
    }
  })

  it('amarelo e laranja (mais claras) usam texto escuro', () => {
    expect(classeTextoAgenda('amarelo')).toBe('text-zinc-900')
    expect(classeTextoAgenda('laranja')).toBe('text-zinc-900')
  })

  it('azul e vermelho (mais escuras) usam texto claro', () => {
    expect(classeTextoAgenda('azul')).toBe('text-white')
    expect(classeTextoAgenda('vermelho')).toBe('text-white')
  })
})
