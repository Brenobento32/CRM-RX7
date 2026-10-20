import { describe, expect, it } from 'vitest'

import { filtrarPipelinePrincipal, processarMetricasFunil, type LinhaFunilMetricasRpc } from '@/lib/utils/funil-metricas'

/** Uma linha completa, com overrides só do que o teste precisa variar. */
function linha(overrides: Partial<LinhaFunilMetricasRpc>): LinhaFunilMetricasRpc {
  return {
    etapa_id: 'etapa',
    nome: 'Etapa',
    cor: 'azul',
    tipo: 'aberta',
    ordem: 1000,
    pos_fechamento: false,
    participa_conversao: true,
    quantidade: 0,
    valor: 0,
    alcancaram: 0,
    tempo_medio_segundos: null,
    permanencias: 0,
    parados_medio_segundos: null,
    parados_7_dias: 0,
    total_entraram: 0,
    desqualificados: 0,
    ...overrides,
  }
}

/** Funil de exemplo: Lead Novo -> Reunião -> (Fechado | Perdido), + Recuperação (pos_fechamento). */
function funilExemplo(overrides: Record<string, Partial<LinhaFunilMetricasRpc>> = {}): LinhaFunilMetricasRpc[] {
  const base: Record<string, LinhaFunilMetricasRpc> = {
    leadNovo: linha({
      etapa_id: 'lead-novo',
      nome: 'Lead Novo',
      ordem: 500,
      quantidade: 3,
      alcancaram: 10,
      total_entraram: 10,
    }),
    reuniao: linha({
      etapa_id: 'reuniao',
      nome: 'Reunião',
      ordem: 1000,
      quantidade: 2,
      alcancaram: 6,
      total_entraram: 10,
    }),
    fechado: linha({
      etapa_id: 'fechado',
      nome: 'Fechado',
      tipo: 'ganha',
      ordem: 100000,
      quantidade: 2,
      valor: 20000,
      alcancaram: 3,
      total_entraram: 10,
    }),
    perdido: linha({
      etapa_id: 'perdido',
      nome: 'Perdido',
      tipo: 'perdida',
      ordem: 100001,
      quantidade: 1,
      alcancaram: 2,
      total_entraram: 10,
    }),
    recuperacao: linha({
      etapa_id: 'recuperacao',
      nome: 'Recuperação',
      ordem: 100002,
      pos_fechamento: true,
      quantidade: 1,
      valor: 5000,
      alcancaram: 1,
      total_entraram: 10,
    }),
  }
  for (const [chave, override] of Object.entries(overrides)) {
    base[chave] = { ...base[chave], ...override }
  }
  return Object.values(base)
}

describe('processarMetricasFunil', () => {
  it('propaga totalEntraram da RPC sem recalcular', () => {
    const { resumo } = processarMetricasFunil(funilExemplo())
    expect(resumo.totalEntraram).toBe(10)
  })

  it('conversaoAcumulada = alcancaram / totalEntraram', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const reuniao = etapas.find((e) => e.etapaId === 'reuniao')!
    expect(reuniao.conversaoAcumulada).toBeCloseTo(6 / 10)
  })

  it('conversaoAcumulada é null quando totalEntraram é zero', () => {
    const dados = funilExemplo().map((l) => ({ ...l, total_entraram: 0 }))
    const { etapas } = processarMetricasFunil(dados)
    expect(etapas.every((e) => e.conversaoAcumulada === null)).toBe(true)
  })

  it('conversaoProxima = alcancaram(próxima) / alcancaram(atual)', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const leadNovo = etapas.find((e) => e.etapaId === 'lead-novo')!
    expect(leadNovo.proxima?.nome).toBe('Reunião')
    expect(leadNovo.conversaoProxima).toBeCloseTo(6 / 10)
  })

  it('conversaoProxima é null quando a etapa atual tem zero alcance', () => {
    const dados = funilExemplo({ leadNovo: { alcancaram: 0 } })
    const { etapas } = processarMetricasFunil(dados)
    const leadNovo = etapas.find((e) => e.etapaId === 'lead-novo')!
    expect(leadNovo.conversaoProxima).toBeNull()
  })

  it('a última etapa aberta do pipeline normal tem Fechado como próxima', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const reuniao = etapas.find((e) => e.etapaId === 'reuniao')!
    expect(reuniao.proxima?.nome).toBe('Fechado')
  })

  it('recuperação nunca é a "próxima" de uma etapa normal', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const reuniao = etapas.find((e) => e.etapaId === 'reuniao')!
    // A última etapa normal antes do fechamento vai direto para "Fechado",
    // nunca para "Recuperação" (ordem maior, mas fora da sequência).
    expect(reuniao.proxima?.nome).not.toBe('Recuperação')
  })

  it('a própria etapa de recuperação nunca tem "próxima"', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const recuperacao = etapas.find((e) => e.etapaId === 'recuperacao')!
    expect(recuperacao.proxima).toBeNull()
    expect(recuperacao.conversaoProxima).toBeNull()
  })

  it('resumo.oportunidades e pipelineValor excluem a zona de recuperação', () => {
    const { resumo } = processarMetricasFunil(funilExemplo())
    // Só Lead Novo (3) + Reunião (2) — Recuperação (1, valor 5000) fica de fora.
    expect(resumo.oportunidades).toBe(5)
    expect(resumo.pipelineValor).toBe(0)
  })

  it('resumo.ganhos/perdidos e conversão vêm das etapas ganha/perdida', () => {
    const { resumo } = processarMetricasFunil(funilExemplo())
    expect(resumo.ganhos).toBe(2)
    expect(resumo.perdidos).toBe(1)
    expect(resumo.conversao).toBeCloseTo(2 / 3)
    expect(resumo.fechadoValor).toBe(20000)
  })

  it('conversão é null sem nenhuma etapa encerrada no período', () => {
    const dados = funilExemplo({
      fechado: { quantidade: 0, valor: 0 },
      perdido: { quantidade: 0 },
    })
    const { resumo } = processarMetricasFunil(dados)
    expect(resumo.conversao).toBeNull()
  })

  it('funil sem nenhuma negociação: tudo zero, sem erro', () => {
    const dados = funilExemplo().map((l) => ({
      ...l,
      quantidade: 0,
      valor: 0,
      alcancaram: 0,
      total_entraram: 0,
      parados_7_dias: 0,
    }))
    const { resumo, etapas } = processarMetricasFunil(dados)
    expect(resumo.totalEntraram).toBe(0)
    expect(resumo.oportunidades).toBe(0)
    expect(etapas.every((e) => e.conversaoAcumulada === null)).toBe(true)
  })

  it('etapa sem nenhuma passagem: alcancaram zero, tempo null', () => {
    const dados = funilExemplo({ reuniao: { alcancaram: 0, tempo_medio_segundos: null } })
    const { etapas } = processarMetricasFunil(dados)
    const reuniao = etapas.find((e) => e.etapaId === 'reuniao')!
    expect(reuniao.alcancaram).toBe(0)
    expect(reuniao.tempoMedioSegundos).toBeNull()
    expect(reuniao.conversaoAcumulada).toBe(0)
  })

  it('TCV/MRR (valor) nunca entra na matemática de conversão — conversão é só contagem', () => {
    // Fechado com valor altíssimo e poucos negócios; Perdido com valor
    // baixo e muitos negócios. Se "valor" contaminasse a conversão, o
    // resultado mudaria — mas conversao/conversaoAcumulada/conversaoProxima
    // só olham quantidade/alcancaram, nunca valor.
    const dados = funilExemplo({
      fechado: { quantidade: 1, valor: 1_000_000, alcancaram: 1 },
      perdido: { quantidade: 3, valor: 10, alcancaram: 3 },
    })
    const { resumo } = processarMetricasFunil(dados)
    expect(resumo.ganhos).toBe(1)
    expect(resumo.perdidos).toBe(3)
    expect(resumo.conversao).toBeCloseTo(1 / 4)
    // fechadoValor é o único lugar onde "valor" aparece no resumo — campo
    // separado, nunca combinado com ganhos/perdidos/conversao.
    expect(resumo.fechadoValor).toBe(1_000_000)
  })
})

describe('filtrarPipelinePrincipal', () => {
  it('exclui recuperação e perdida, inclui abertas normais e ganha, na ordem', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const pipeline = filtrarPipelinePrincipal(etapas)
    expect(pipeline.map((e) => e.nome)).toEqual(['Lead Novo', 'Reunião', 'Fechado'])
  })

  it('No Show nunca pertence ao pipeline principal', () => {
    const dados = [
      ...funilExemplo(),
      linha({
        etapa_id: 'no-show',
        nome: 'No Show',
        ordem: 750,
        participa_conversao: false,
        quantidade: 1,
        alcancaram: 3,
        total_entraram: 10,
      }),
    ]
    const { etapas } = processarMetricasFunil(dados)
    const pipeline = filtrarPipelinePrincipal(etapas)
    expect(pipeline.map((e) => e.nome)).not.toContain('No Show')
  })

  it('Perdido nunca pertence ao pipeline principal (já coberto acima, reforçado por tipo)', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const pipeline = filtrarPipelinePrincipal(etapas)
    expect(pipeline.some((e) => e.tipo === 'perdida')).toBe(false)
  })

  it('Recuperação (pós-fechamento) nunca pertence ao pipeline principal (já coberto acima, reforçado por flag)', () => {
    const { etapas } = processarMetricasFunil(funilExemplo())
    const pipeline = filtrarPipelinePrincipal(etapas)
    expect(pipeline.some((e) => e.posFechamento)).toBe(false)
  })

  it('o gráfico usa os MESMOS objetos da tabela — nenhum valor recalculado', () => {
    // Mesma garantia que "a tabela diz MQL=70, o gráfico tem que dizer
    // MQL=70": filtrarPipelinePrincipal nunca copia/recalcula, só filtra —
    // os elementos retornados são referências idênticas às de `etapas`.
    const { etapas } = processarMetricasFunil(funilExemplo())
    const pipeline = filtrarPipelinePrincipal(etapas)
    for (const etapaPipeline of pipeline) {
      const etapaTabela = etapas.find((e) => e.etapaId === etapaPipeline.etapaId)
      expect(etapaPipeline).toBe(etapaTabela) // mesma referência, não só mesmo valor
    }
  })

  it('funil sem recuperação/perdida: pipeline = tudo que não é recuperação', () => {
    const dados = funilExemplo().filter((l) => l.etapa_id !== 'recuperacao' && l.etapa_id !== 'perdido')
    const { etapas } = processarMetricasFunil(dados)
    const pipeline = filtrarPipelinePrincipal(etapas)
    expect(pipeline.map((e) => e.nome)).toEqual(['Lead Novo', 'Reunião', 'Fechado'])
  })
})

/**
 * Cenário real que motivou a correção: Reunião agendada = 10, No Show = 3,
 * Reunião realizada = 7. ANTES desta correção, "No Show" era uma etapa
 * `aberta` comum (`posFechamento = false`) igual qualquer outra — entrava no
 * meio da sequência e virava a "etapa anterior" de Reunião realizada,
 * resultando em 7 ÷ 3 = 233,3% (errado: não existe conversão acima de 100%
 * entre etapas consecutivas reais do pipeline aqui). Depois da correção,
 * Reunião realizada compara com Reunião agendada (sua verdadeira antecessora
 * no pipeline, pulando o No Show): 7 ÷ 10 = 70%.
 */
describe('No Show não contamina a conversão do pipeline principal (cenário real)', () => {
  function funilComNoShow(): LinhaFunilMetricasRpc[] {
    return [
      linha({
        etapa_id: 'agendada',
        nome: 'Reunião agendada',
        ordem: 1000,
        quantidade: 4,
        valor: 40000,
        parados_7_dias: 1,
        alcancaram: 10,
        total_entraram: 10,
      }),
      linha({
        etapa_id: 'no-show',
        nome: 'No Show',
        ordem: 1500,
        pos_fechamento: false,
        participa_conversao: false,
        // quantidade (estado atual) e alcancaram (coorte) DIFERENTES de
        // propósito — mesmo exemplo do pedido: "quantidade atual = 2,
        // alcancaram na coorte = 3" — prova que cada agregado usa o número
        // certo, nunca confunde os dois.
        quantidade: 2,
        valor: 1500,
        parados_7_dias: 1,
        alcancaram: 3,
        total_entraram: 10,
      }),
      linha({
        etapa_id: 'realizada',
        nome: 'Reunião realizada',
        ordem: 2000,
        quantidade: 7,
        valor: 70000,
        parados_7_dias: 2,
        alcancaram: 7,
        total_entraram: 10,
      }),
      linha({
        etapa_id: 'fechado',
        nome: 'Fechado',
        tipo: 'ganha',
        ordem: 100000,
        quantidade: 2,
        valor: 20000,
        alcancaram: 2,
        total_entraram: 10,
      }),
    ]
  }

  it('conversão de Reunião realizada é 7/10 = 70%, nunca 7/3', () => {
    const { etapas } = processarMetricasFunil(funilComNoShow())
    const agendada = etapas.find((e) => e.etapaId === 'agendada')!
    expect(agendada.proxima?.nome).toBe('Reunião realizada')
    expect(agendada.conversaoProxima).toBeCloseTo(0.7)
    expect(agendada.conversaoProxima).not.toBeCloseTo(7 / 3)
  })

  it('No Show nunca é a "próxima etapa" de ninguém, e ela mesma não tem "próxima"', () => {
    const { etapas } = processarMetricasFunil(funilComNoShow())
    const noShow = etapas.find((e) => e.etapaId === 'no-show')!
    expect(noShow.proxima).toBeNull()
    expect(noShow.conversaoProxima).toBeNull()
    expect(etapas.every((e) => e.proxima?.nome !== 'No Show')).toBe(true)
  })

  it('No Show continua disponível na coleção completa de etapas (pro Kanban/badge lateral), só fora do pipeline', () => {
    const { etapas } = processarMetricasFunil(funilComNoShow())
    const noShow = etapas.find((e) => e.etapaId === 'no-show')
    expect(noShow).toBeDefined()
    expect(noShow?.quantidade).toBe(2)
    expect(noShow?.alcancaram).toBe(3)
    expect(filtrarPipelinePrincipal(etapas).map((e) => e.nome)).toEqual(['Reunião agendada', 'Reunião realizada', 'Fechado'])
  })

  it('uma taxa de conversão acima de 100% (entrada direta) continua exibida por inteiro, nunca limitada', () => {
    // Mais chegaram em "Reunião realizada" do que o total de "Reunião agendada" alcançou — entradas diretas de outra origem.
    const dados = funilComNoShow().map((l) => (l.etapa_id === 'realizada' ? { ...l, alcancaram: 15 } : l))
    const { etapas } = processarMetricasFunil(dados)
    const agendada = etapas.find((e) => e.etapaId === 'agendada')!
    expect(agendada.conversaoProxima).toBeCloseTo(1.5)
    expect(agendada.conversaoProxima).toBeGreaterThan(1)
  })

  // ---------------------------------------------------------------------
  // Correção desta rodada: No Show vazava nos AGREGADOS do resumo
  // (oportunidades/pipelineValor/parados), que somam direto sobre `etapas`
  // e não passavam por `filtrarPipelinePrincipal` — só a conversão/gráfico
  // tinham sido corrigidos na rodada anterior.
  // ---------------------------------------------------------------------

  it('No Show fica fora de "oportunidades" (só Reunião agendada + Reunião realizada contam: 4 + 7 = 11)', () => {
    const { resumo } = processarMetricasFunil(funilComNoShow())
    expect(resumo.oportunidades).toBe(11)
  })

  it('No Show fica fora de "pipelineValor" (só 40000 + 70000 = 110000, nunca soma o 1500 do No Show)', () => {
    const { resumo } = processarMetricasFunil(funilComNoShow())
    expect(resumo.pipelineValor).toBe(110000)
  })

  it('No Show fica fora de "parados" (há +7 dias) — só 1 + 2 = 3, nunca soma o 1 do No Show', () => {
    const { resumo } = processarMetricasFunil(funilComNoShow())
    expect(resumo.parados).toBe(3)
  })

  it('etapas abertas normais (fora do No Show) continuam contando normalmente nos agregados', () => {
    // Guarda de regressão: a correção exclui só o No Show, nunca as demais
    // etapas abertas normais do pipeline.
    const { resumo } = processarMetricasFunil(funilComNoShow())
    expect(resumo.oportunidades).toBeGreaterThan(0)
    expect(resumo.pipelineValor).toBeGreaterThan(0)
  })

  it('recuperação (pós-fechamento) também continua fora destes agregados (comportamento pré-existente, preservado)', () => {
    const { resumo } = processarMetricasFunil(funilExemplo())
    // funilExemplo: Lead Novo (3) + Reunião (2) = 5 — Recuperação (1, valor 5000) de fora, igual antes desta rodada.
    expect(resumo.oportunidades).toBe(5)
    expect(resumo.pipelineValor).toBe(0)
  })

  it('o badge lateral do No Show deve usar `alcancaram` (coorte), nunca `quantidade` (estado atual) — os dois são diferentes neste fixture', () => {
    const { etapas } = processarMetricasFunil(funilComNoShow())
    const noShow = etapas.find((e) => e.etapaId === 'no-show')!
    expect(noShow.quantidade).toBe(2)
    expect(noShow.alcancaram).toBe(3)
    expect(noShow.alcancaram).not.toBe(noShow.quantidade)
  })
})

/**
 * Cálculo DEFINITIVO: pipeline principal usa o marcador estruturado
 * (`participa_conversao`/`participaConversao`), nunca o nome — provado aqui
 * com uma etapa que NÃO se chama "No Show" nenhum pouco, só marcada
 * `participa_conversao: false`. Se o filtro dependesse do nome, esta etapa
 * continuaria contaminando a sequência.
 */
describe('participaConversao — cálculo definitivo, não depende de nome', () => {
  function funilComEtapaLateralGenerica(): LinhaFunilMetricasRpc[] {
    return [
      linha({
        etapa_id: 'agendada',
        nome: 'Reunião agendada',
        ordem: 1000,
        quantidade: 4,
        valor: 40000,
        parados_7_dias: 1,
        alcancaram: 10,
        total_entraram: 10,
      }),
      linha({
        etapa_id: 'lateral-generica',
        nome: 'Agendamento duplicado', // nome qualquer, nunca "No Show"
        ordem: 1500,
        pos_fechamento: false,
        participa_conversao: false,
        quantidade: 2,
        valor: 1500,
        parados_7_dias: 1,
        alcancaram: 3,
        total_entraram: 10,
      }),
      linha({
        etapa_id: 'realizada',
        nome: 'Reunião realizada',
        ordem: 2000,
        quantidade: 7,
        valor: 70000,
        parados_7_dias: 2,
        alcancaram: 7,
        total_entraram: 10,
      }),
      linha({
        etapa_id: 'fechado',
        nome: 'Fechado',
        tipo: 'ganha',
        ordem: 100000,
        quantidade: 2,
        valor: 20000,
        alcancaram: 2,
        total_entraram: 10,
      }),
    ]
  }

  it('etapa com participa_conversao=false fica fora do pipeline principal, mesmo com nome genérico', () => {
    const { etapas } = processarMetricasFunil(funilComEtapaLateralGenerica())
    const pipeline = filtrarPipelinePrincipal(etapas)
    expect(pipeline.map((e) => e.nome)).not.toContain('Agendamento duplicado')
  })

  it('conversão principal pula a etapa marcada, igual faria com No Show por nome', () => {
    const { etapas } = processarMetricasFunil(funilComEtapaLateralGenerica())
    const agendada = etapas.find((e) => e.etapaId === 'agendada')!
    expect(agendada.proxima?.nome).toBe('Reunião realizada')
    expect(agendada.conversaoProxima).toBeCloseTo(0.7)
  })

  it('oportunidades/pipelineValor/parados excluem a etapa marcada, mesmo com nome genérico', () => {
    const { resumo } = processarMetricasFunil(funilComEtapaLateralGenerica())
    expect(resumo.oportunidades).toBe(11) // 4 + 7, nunca +2 da lateral
    expect(resumo.pipelineValor).toBe(110000) // 40000 + 70000, nunca +1500
    expect(resumo.parados).toBe(3) // 1 + 2, nunca +1
  })

})

/**
 * `desqualificados` — total único da coorte (`etapas_funil`-independente,
 * mesmo padrão de `totalEntraram`), repassado pro resumo sem recalcular.
 */
describe('resumo.desqualificados', () => {
  it('repassa o total vindo da RPC, igual totalEntraram', () => {
    const dados = funilExemplo().map((l) => ({ ...l, desqualificados: 3 }))
    const { resumo } = processarMetricasFunil(dados)
    expect(resumo.desqualificados).toBe(3)
  })

  it('não depende de nenhuma etapa específica — é um total da coorte, não por etapa', () => {
    // Mesmo variando quantidade/valor/tipo das etapas, o número vem de UMA
    // ÚNICA coluna repetida (primeira linha), nunca de uma soma por etapa.
    const dados = funilExemplo({ perdido: { quantidade: 99 } }).map((l) => ({ ...l, desqualificados: 2 }))
    const { resumo } = processarMetricasFunil(dados)
    expect(resumo.desqualificados).toBe(2)
  })
})
