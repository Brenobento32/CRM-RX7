import { describe, expect, it } from 'vitest'

import {
  calcularDataChegada,
  classeTextoAgenda,
  corDeFundoAgenda,
  corDeNicho,
  COR_AGENDA_PADRAO,
  PALETA_ETAPAS,
  sdrPodeMoverPara,
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

describe('sdrPodeMoverPara', () => {
  // Mesma numeração de ordem usada pelo Funil Principal: Lead Novo(500) <
  // MQL(800) < Reunião agendada(1000) < Reunião realizada(2000) < Proposta
  // enviada(3000) < Negociação(4000). Limite = ordem de "Reunião realizada".
  const LIMITE = 2000

  it('permite avançar livremente antes do limite (Lead Novo -> MQL)', () => {
    expect(sdrPodeMoverPara(500, 800, LIMITE)).toBe(true)
  })

  it('permite avançar até Reunião agendada', () => {
    expect(sdrPodeMoverPara(800, 1000, LIMITE)).toBe(true)
  })

  it('permite ENTRAR em Reunião realizada (é o próprio limite, inclusivo)', () => {
    expect(sdrPodeMoverPara(1000, 2000, LIMITE)).toBe(true)
  })

  it('impede pular direto de uma etapa anterior para além do limite', () => {
    expect(sdrPodeMoverPara(1000, 3000, LIMITE)).toBe(false)
  })

  it('impede mover a negociação já em Reunião realizada, mesmo "pra frente"', () => {
    expect(sdrPodeMoverPara(2000, 3000, LIMITE)).toBe(false)
  })

  it('impede mover a negociação já em Reunião realizada "pra trás" também', () => {
    expect(sdrPodeMoverPara(2000, 800, LIMITE)).toBe(false)
  })

  it('impede qualquer movimento de uma negociação já além do limite (Proposta enviada)', () => {
    expect(sdrPodeMoverPara(3000, 4000, LIMITE)).toBe(false)
  })

  it('CLOSER/gerente não chamam esta função — mas o limite null (funil sem a etapa técnica) libera tudo', () => {
    expect(sdrPodeMoverPara(500, 999999, null)).toBe(true)
    expect(sdrPodeMoverPara(999999, 500, null)).toBe(true)
  })

  it('não depende do texto da etapa — só de números de ordem, nunca de nome', () => {
    // Mesmos números, "etapas" hipotéticas com nomes completamente diferentes
    // do Funil Principal — o resultado é idêntico, prova que a regra nunca
    // olha o nome/rótulo, só a posição.
    expect(sdrPodeMoverPara(10, 20, 20)).toBe(true)
    expect(sdrPodeMoverPara(20, 30, 20)).toBe(false)
  })
})
