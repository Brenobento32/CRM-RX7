import { describe, expect, it } from 'vitest'

import {
  calcularDataChegada,
  classeTextoAgenda,
  corDeFundoAgenda,
  corDeNicho,
  COR_AGENDA_PADRAO,
  PALETA_ETAPAS,
  podeMoverNegociacaoColaborador,
  podeVerEtapaColaborador,
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

describe('podeVerEtapaColaborador', () => {
  it('1. GERENTE vê qualquer etapa, mesmo sem acesso ao funil nem permissão', () => {
    expect(podeVerEtapaColaborador({ papel: 'gerente', acessoFunil: false, podeVerEtapa: false })).toBe(true)
  })

  it('7/17. owner_id não é parâmetro desta função — estruturalmente não há como ele conceder bypass (SDR e CLOSER)', () => {
    // Não existe campo "dono"/"owner"/"responsavel" na assinatura: a única
    // forma de obter `true` pra SDR/CLOSER é acessoFunil && podeVerEtapa.
    expect(podeVerEtapaColaborador({ papel: 'sdr', acessoFunil: false, podeVerEtapa: false })).toBe(false)
    expect(podeVerEtapaColaborador({ papel: 'closer', acessoFunil: false, podeVerEtapa: false })).toBe(false)
  })

  it('2. SDR/CLOSER sem acesso ao funil não veem, mesmo com a etapa marcada pode_ver', () => {
    expect(podeVerEtapaColaborador({ papel: 'sdr', acessoFunil: false, podeVerEtapa: true })).toBe(false)
    expect(podeVerEtapaColaborador({ papel: 'closer', acessoFunil: false, podeVerEtapa: true })).toBe(false)
  })

  it('3. SDR/CLOSER com acesso ao funil mas SEM pode_ver nesta etapa não veem — acesso ao funil não herda pra etapas', () => {
    expect(podeVerEtapaColaborador({ papel: 'sdr', acessoFunil: true, podeVerEtapa: false })).toBe(false)
    expect(podeVerEtapaColaborador({ papel: 'closer', acessoFunil: true, podeVerEtapa: false })).toBe(false)
  })

  it('4/6. SDR/CLOSER com acesso ao funil E pode_ver na etapa veem', () => {
    expect(podeVerEtapaColaborador({ papel: 'sdr', acessoFunil: true, podeVerEtapa: true })).toBe(true)
    expect(podeVerEtapaColaborador({ papel: 'closer', acessoFunil: true, podeVerEtapa: true })).toBe(true)
  })
})

describe('podeMoverNegociacaoColaborador', () => {
  const SEM_HANDOFF = null

  it('13. GERENTE move qualquer etapa, mesmo sem permissão nenhuma', () => {
    expect(
      podeMoverNegociacaoColaborador({
        papel: 'gerente',
        podeMoverOrigem: false,
        podeMoverDestino: false,
        ordemOrigem: 1000,
        ordemDestino: 5000,
        ordemLimiteHandoffSdr: 2000,
      }),
    ).toBe(true)
  })

  it('7/8/17. owner_id não é parâmetro — sem pode_mover configurado, SDR/CLOSER nunca movem, mesmo imaginando que "seriam donos"', () => {
    const base = { ordemOrigem: 1000, ordemDestino: 2000, ordemLimiteHandoffSdr: SEM_HANDOFF }
    expect(podeMoverNegociacaoColaborador({ ...base, papel: 'closer', podeMoverOrigem: false, podeMoverDestino: false })).toBe(false)
    expect(podeMoverNegociacaoColaborador({ ...base, papel: 'sdr', podeMoverOrigem: false, podeMoverDestino: false })).toBe(false)
  })

  it('10. não-gerente sem pode_mover na origem OU no destino não move (SDR e CLOSER)', () => {
    const base = { ordemOrigem: 1000, ordemDestino: 2000, ordemLimiteHandoffSdr: SEM_HANDOFF }
    expect(podeMoverNegociacaoColaborador({ ...base, papel: 'closer', podeMoverOrigem: true, podeMoverDestino: false })).toBe(false)
    expect(podeMoverNegociacaoColaborador({ ...base, papel: 'closer', podeMoverOrigem: false, podeMoverDestino: true })).toBe(false)
    expect(podeMoverNegociacaoColaborador({ ...base, papel: 'sdr', podeMoverOrigem: true, podeMoverDestino: false })).toBe(false)
  })

  it('9. com pode_mover na origem E no destino, CLOSER move (sem handoff envolvido)', () => {
    expect(
      podeMoverNegociacaoColaborador({
        papel: 'closer',
        podeMoverOrigem: true,
        podeMoverDestino: true,
        ordemOrigem: 3000,
        ordemDestino: 4000,
        ordemLimiteHandoffSdr: SEM_HANDOFF,
      }),
    ).toBe(true)
  })

  it('12. CLOSER não é afetado pelo teto do handoff do SDR, mesmo cruzando a mesma ordem', () => {
    expect(
      podeMoverNegociacaoColaborador({
        papel: 'closer',
        podeMoverOrigem: true,
        podeMoverDestino: true,
        ordemOrigem: 1000,
        ordemDestino: 3000,
        ordemLimiteHandoffSdr: 2000, // seria o limite SE fosse SDR — closer ignora
      }),
    ).toBe(true)
  })

  it('11. SDR com pode_mover=true nas duas etapas AINDA é bloqueado pelo teto do handoff — permissão não burla a regra comercial', () => {
    expect(
      podeMoverNegociacaoColaborador({
        papel: 'sdr',
        podeMoverOrigem: true,
        podeMoverDestino: true, // configurado "errado" de propósito, pra provar que não adianta
        ordemOrigem: 1000,
        ordemDestino: 3000,
        ordemLimiteHandoffSdr: 2000,
      }),
    ).toBe(false)
  })

  it('SDR dentro do teto, com permissão, move normalmente', () => {
    expect(
      podeMoverNegociacaoColaborador({
        papel: 'sdr',
        podeMoverOrigem: true,
        podeMoverDestino: true,
        ordemOrigem: 1000,
        ordemDestino: 2000,
        ordemLimiteHandoffSdr: 2000,
      }),
    ).toBe(true)
  })

  it('9. visualizar não concede movimentar — pode_ver não é parâmetro desta função', () => {
    // podeMoverNegociacaoColaborador nunca recebe podeVerEtapa como parâmetro:
    // é estruturalmente impossível "ver" virar "mover" por engano aqui.
    const resultado = podeMoverNegociacaoColaborador({
      papel: 'closer',
      podeMoverOrigem: false,
      podeMoverDestino: false,
      ordemOrigem: 1000,
      ordemDestino: 2000,
      ordemLimiteHandoffSdr: SEM_HANDOFF,
    })
    expect(resultado).toBe(false)
  })
})
