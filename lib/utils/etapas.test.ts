import { describe, expect, it } from 'vitest'

import {
  calcularDataChegada,
  classeTextoAgenda,
  corDeFundoAgenda,
  corDeNicho,
  COR_AGENDA_PADRAO,
  PALETA_ETAPAS,
  TEXTO_SOBRE_COR,
} from '@/lib/utils/etapas'

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

describe('corDeNicho', () => {
  it('Instituição de Ensino (ou qualquer nicho) usa o hex da cor configurada, nunca um valor hardcoded', () => {
    expect(corDeNicho('laranja')).toBe(PALETA_ETAPAS.laranja.hex)
  })

  it('todo nicho usa a própria cor da paleta — nenhum depende de hardcode exclusivo', () => {
    for (const cor of Object.keys(PALETA_ETAPAS) as (keyof typeof PALETA_ETAPAS)[]) {
      expect(corDeNicho(cor)).toBe(PALETA_ETAPAS[cor].hex)
    }
  })

  it('"Outros"/sem nicho usa cinza, nunca fica sem cor', () => {
    expect(corDeNicho(null)).toBe(PALETA_ETAPAS.cinza.hex)
  })
})

describe('calcularDataChegada', () => {
  const CRIADO_HOJE = '2026-10-13T16:34:46.118686+00:00'

  it('usa data_formulario quando presente e válida', () => {
    expect(calcularDataChegada('2026-10-08 12:13:19', CRIADO_HOJE)).toBe(new Date('2026-10-08 12:13:19').toISOString())
  })

  it('lead histórico com data_formulario antiga não "sobe" por ter sido importado hoje', () => {
    const chegadaHistorica = calcularDataChegada('2026-10-08 12:13:19', CRIADO_HOJE)
    const chegadaRecente = calcularDataChegada('2026-10-13 10:00:00', CRIADO_HOJE)
    expect(new Date(chegadaHistorica).getTime()).toBeLessThan(new Date(chegadaRecente).getTime())
    // Nenhuma das duas é o momento da importação (CRIADO_HOJE) — a data real manda.
    expect(chegadaHistorica).not.toBe(CRIADO_HOJE)
    expect(chegadaRecente).not.toBe(CRIADO_HOJE)
  })

  it('sem data_formulario, cai no fallback (criadoEm)', () => {
    expect(calcularDataChegada(null, CRIADO_HOJE)).toBe(CRIADO_HOJE)
    expect(calcularDataChegada(undefined, CRIADO_HOJE)).toBe(CRIADO_HOJE)
    expect(calcularDataChegada('', CRIADO_HOJE)).toBe(CRIADO_HOJE)
  })

  it('data_formulario em formato inválido (texto qualquer) cai no fallback, não inventa data', () => {
    expect(calcularDataChegada('não é uma data', CRIADO_HOJE)).toBe(CRIADO_HOJE)
  })

  it('ordenação decrescente (mais recente primeiro) fica correta entre histórico e novo', () => {
    const leadA = { nome: 'A', chegada: calcularDataChegada('2026-10-08 12:13:19', CRIADO_HOJE) }
    const leadB = { nome: 'B', chegada: calcularDataChegada('2026-10-13 10:00:00', CRIADO_HOJE) }
    const ordenados = [leadA, leadB].sort((x, y) => new Date(y.chegada).getTime() - new Date(x.chegada).getTime())
    expect(ordenados.map((l) => l.nome)).toEqual(['B', 'A'])
  })
})
