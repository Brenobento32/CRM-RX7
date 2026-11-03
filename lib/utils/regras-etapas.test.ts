import { describe, expect, it } from 'vitest'

import { regrasEtapaSchema, statusReativacaoSchema } from '@/lib/validations/super-admin'

import {
  camposFaltando,
  camposObrigatorios,
  camposVisiveis,
  descreverRequisitos,
  lerRequisitos,
  mostraCampo,
  normalizarRegraEtapa,
  preservarOcultos,
  problemaNoChecklist,
  type RegraEtapa,
} from './regras-etapas'

const ETAPA = '00000000-0000-4000-8000-000000000001'
const vazio = {
  valor_estimado: null,
  temperatura: null,
  data_primeira_reuniao: null,
  data_proposta: null,
  valor_proposta: null,
  forma_pagamento: null,
  objecao_principal: null,
  servico_ids: [] as string[],
}
const agendada: RegraEtapa = normalizarRegraEtapa(
  { valor_estimado: 'obrigatorio', temperatura: 'oculto', servicos: 'obrigatorio' },
  [{ id: 'abc', texto: 'Contato confirmado' }],
)

describe('exigências por etapa — leitura das regras', () => {
  it('sem regra = padrão: tudo opcional, nada escondido, nada exigido', () => {
    expect(camposVisiveis(undefined).size).toBe(8)
    expect(camposObrigatorios(undefined)).toEqual([])
    expect(camposFaltando(undefined, vazio)).toEqual([])
  })

  it('JSON do banco vira tipo seguro: valores e campos desconhecidos são ignorados', () => {
    const r = normalizarRegraEtapa({ valor_estimado: 'obrigatorio', cpf: 'obrigatorio', temperatura: 'talvez', data_proposta: 'opcional' }, [
      { id: 'x', texto: 'ok' },
      { texto: 'sem id' },
      'lixo',
    ])
    expect(r).toEqual({ campos: { valor_estimado: 'obrigatorio' }, checklist: [{ id: 'x', texto: 'ok' }] })
  })

  it('"Não usar" some do formulário; ao mover, vale a regra do destino', () => {
    expect(camposVisiveis(agendada).has('temperatura')).toBe(false)
    // editando numa etapa sem regra, mas movendo para "agendada": esconde o que o destino não usa
    expect(camposVisiveis(undefined, agendada).has('temperatura')).toBe(false)
    // estava escondido na etapa atual, mas o destino usa: aparece
    expect(camposVisiveis(agendada, normalizarRegraEtapa({}, [])).has('temperatura')).toBe(true)
  })

  it('card, painel e listas: "Não usar" esconde só naquela etapa (cada empresa/funil/etapa com a sua regra)', () => {
    const regras = { [ETAPA]: agendada }
    expect(mostraCampo(regras, ETAPA, 'temperatura')).toBe(false)
    expect(mostraCampo(regras, ETAPA, 'valor_estimado')).toBe(true)
    // outra etapa (ou outra empresa, que não enxerga estas regras): mostra como sempre
    expect(mostraCampo(regras, '00000000-0000-4000-8000-000000000002', 'temperatura')).toBe(true)
    expect(mostraCampo({}, ETAPA, 'temperatura')).toBe(true)
    expect(mostraCampo(regras, null, 'temperatura')).toBe(true)
  })

  it('campo obrigatório nunca fica escondido (um uso só por campo)', () => {
    for (const c of camposObrigatorios(agendada)) expect(camposVisiveis(undefined, agendada).has(c)).toBe(true)
  })
})

describe('exigências por etapa — validação ao mover (mesma do banco)', () => {
  it('campo obrigatório faltando', () => {
    expect(camposFaltando(agendada, vazio)).toEqual(['valor_estimado', 'servicos'])
    expect(camposFaltando(agendada, { ...vazio, valor_estimado: '   ' })).toContain('valor_estimado')
  })

  it('todos preenchidos', () => {
    expect(camposFaltando(agendada, { ...vazio, valor_estimado: '5000.00', servico_ids: ['s1'] })).toEqual([])
  })

  it('campo "Não usar" mantém o valor gravado (nunca apagado ao salvar)', () => {
    const atuais = { ...vazio, temperatura: 'quente', servico_ids: ['s9'] }
    const enviado = { ...vazio, valor_estimado: '10.00', temperatura: null }
    const r = preservarOcultos(enviado, atuais, camposVisiveis(agendada))
    expect(r.temperatura).toBe('quente')
    expect(r.valor_estimado).toBe('10.00')
    // serviços visíveis: vale o que foi enviado
    expect(r.servico_ids).toEqual([])
    const semServicos = normalizarRegraEtapa({ servicos: 'oculto' }, [])
    expect(preservarOcultos(enviado, atuais, camposVisiveis(semServicos)).servico_ids).toEqual(['s9'])
  })

  it('detalhe do erro RX101 do banco → requisitos para o formulário', () => {
    const r = lerRequisitos(
      JSON.stringify({ etapa_id: ETAPA, etapa: 'Reunião agendada', campos: ['valor_estimado', 'xyz'], checklist: [{ id: 'abc', texto: 'Contato confirmado' }] }),
    )
    expect(r).toEqual({ etapaId: ETAPA, etapaNome: 'Reunião agendada', campos: ['valor_estimado'], checklist: [{ id: 'abc', texto: 'Contato confirmado' }] })
    expect(descreverRequisitos(r!)).toBe('Para mover para "Reunião agendada", falta: Valor estimado, confirmar "Contato confirmado".')
    expect(lerRequisitos('não é json')).toBeNull()
    expect(lerRequisitos(null)).toBeNull()
  })
})

describe('exigências por etapa — formulário do Super Admin', () => {
  const base = {
    etapaId: ETAPA,
    campos: {
      valor_estimado: 'obrigatorio',
      temperatura: 'oculto',
      data_primeira_reuniao: 'opcional',
      data_proposta: 'opcional',
      valor_proposta: 'opcional',
      forma_pagamento: 'opcional',
      objecao_principal: 'opcional',
      servicos: 'opcional',
    },
    checklist: ['Contato confirmado', ''],
    motivo: 'Agendamento com valor',
  }

  it('aceita uma regra válida', () => {
    expect(regrasEtapaSchema.safeParse(base).success).toBe(true)
  })

  it('recusa uso inválido, checklist repetido, mais de 10 itens e falta de motivo', () => {
    expect(regrasEtapaSchema.safeParse({ ...base, campos: { ...base.campos, temperatura: 'talvez' } }).success).toBe(false)
    expect(problemaNoChecklist(['Item A', 'item a'])).toMatch(/repetido/)
    expect(problemaNoChecklist(Array.from({ length: 11 }, (_, i) => `Item ${i}`))).toMatch(/10 itens/)
    expect(problemaNoChecklist(['ok'])).toMatch(/3 a 200/)
    expect(regrasEtapaSchema.safeParse({ ...base, motivo: '' }).success).toBe(false)
  })
})

describe('reativação — escolha do Super Admin', () => {
  it('vazio = estado de antes da inativação; só Ativa, Teste ou Vencida', () => {
    expect(statusReativacaoSchema.parse('')).toBeNull()
    expect(statusReativacaoSchema.parse('vencida')).toBe('vencida')
    expect(statusReativacaoSchema.safeParse('cancelada').success).toBe(false)
    expect(statusReativacaoSchema.safeParse('suspensa').success).toBe(false)
  })
})
