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
    quantidade: 0,
    valor: 0,
    alcancaram: 0,
    tempo_medio_segundos: null,
    permanencias: 0,
    parados_medio_segundos: null,
    parados_7_dias: 0,
    total_entraram: 0,
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
