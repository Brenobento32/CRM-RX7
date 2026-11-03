import { describe, expect, it } from 'vitest'

import { criarAtualizarFechamentoSchema, criarFechamentoSchema } from '@/lib/validations/funil'

import {
  camposDiferentesDoPadrao,
  normalizarRegras,
  PADRAO_POR_PERFIL,
  problemaNasRegras,
  REGRAS_ANTERIORES,
  tiposVisiveis,
} from './regras-comerciais'

const ID = '00000000-0000-4000-8000-000000000001'
const base = { negociacao_id: ID, posicao: '1000', valor_vendido: '1.200,00', data_fechamento: '2026-11-01' }
const generico = { tiposVenda: PADRAO_POR_PERFIL.generico.tiposVenda, campos: PADRAO_POR_PERFIL.generico.campos }
const agencia = { tiposVenda: PADRAO_POR_PERFIL.agencia.tiposVenda, campos: PADRAO_POR_PERFIL.agencia.campos }
const erros = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => String(i.path[0]))

describe('regras comerciais — normalização', () => {
  it('sem resposta do banco (antes da migration): comportamento anterior, agência', () => {
    expect(normalizarRegras(null)).toEqual(REGRAS_ANTERIORES)
    expect(REGRAS_ANTERIORES.tiposVenda).toEqual(['tcv', 'mrr'])
    expect(REGRAS_ANTERIORES.campos.contrato_enviado).toBe('obrigatorio')
  })

  it('JSON do banco vira tipo seguro: valores desconhecidos caem no padrão do perfil', () => {
    const r = normalizarRegras({
      perfil: 'generico',
      metas_ativo: false,
      tipos_venda: ['venda', 'xyz'],
      campos: { contrato_enviado: 'confirmar', status_pagamento: 'qualquer' },
      configurado: true,
    })
    expect(r).toMatchObject({ perfil: 'generico', metasAtivo: false, tiposVenda: ['venda'] })
    expect(r.campos.contrato_enviado).toBe('confirmar')
    expect(r.campos.status_pagamento).toBe('opcional')
    expect(r.campos.status_onboarding).toBe('oculto')
  })

  it('o banco guarda só o que difere do padrão do perfil', () => {
    expect(camposDiferentesDoPadrao('generico', PADRAO_POR_PERFIL.generico.campos)).toEqual({})
    expect(camposDiferentesDoPadrao('agencia', { ...PADRAO_POR_PERFIL.agencia.campos, contrato_assinado: 'confirmar' })).toEqual({
      contrato_assinado: 'confirmar',
    })
  })

  it('regras incoerentes são recusadas (mesma checagem do banco)', () => {
    expect(problemaNasRegras(PADRAO_POR_PERFIL.generico.campos, [])).toMatch(/ao menos um tipo/)
    expect(problemaNasRegras({ ...PADRAO_POR_PERFIL.generico.campos, contrato_assinado: 'obrigatorio' }, ['venda'])).toMatch(/contrato enviado/)
    expect(problemaNasRegras({ ...PADRAO_POR_PERFIL.agencia.campos, status_pagamento: 'confirmar' }, ['tcv'])).toMatch(/só vale para contrato/)
    expect(problemaNasRegras(PADRAO_POR_PERFIL.agencia.campos, ['tcv'])).toBeNull()
  })

  it('Metas mostra os tipos liberados e, para não esconder histórico, os que já têm dados', () => {
    expect(tiposVisiveis(['venda'])).toEqual(['venda'])
    expect(tiposVisiveis(['venda'], ['tcv'])).toEqual(['tcv', 'venda'])
    expect(tiposVisiveis(['mrr', 'tcv'])).toEqual(['tcv', 'mrr'])
  })
})

describe('fechamento conforme as regras da empresa (servidor)', () => {
  it('genérica: Venda comum fecha só com tipo, valor e data; itens de agência viram "não se aplica"', () => {
    const r = criarFechamentoSchema(generico).safeParse({ ...base, tipo_venda: 'venda', contrato_enviado: 'sim', status_onboarding: 'concluido' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toMatchObject({ tipo_venda: 'venda', contrato_enviado: null, contrato_assinado: null, status_onboarding: null, status_pagamento: null })
    }
  })

  it('genérica: TCV não é aceito; o erro diz quais tipos existem', () => {
    const r = criarFechamentoSchema(generico).safeParse({ ...base, tipo_venda: 'tcv' })
    expect(erros(r)).toEqual(['tipo_venda'])
    expect(r.success ? '' : r.error.issues[0].message).toMatch(/Venda comum/)
  })

  it('agência: continua exigindo contrato, pagamento e onboarding (como antes)', () => {
    const r = criarFechamentoSchema(agencia).safeParse({ ...base, tipo_venda: 'tcv' })
    expect(erros(r).sort()).toEqual(['contrato_assinado', 'contrato_enviado', 'status_onboarding', 'status_pagamento'])
    const ok = criarFechamentoSchema(agencia).safeParse({
      ...base,
      tipo_venda: 'mrr',
      contrato_enviado: 'sim',
      contrato_assinado: 'nao',
      status_pagamento: 'pago',
      status_onboarding: 'em_andamento',
    })
    expect(ok.success).toBe(true)
  })

  it('"confirmar": contrato assinado precisa ser Sim', () => {
    const regras = { ...agencia, campos: { ...agencia.campos, contrato_assinado: 'confirmar' as const } }
    const completo = { ...base, tipo_venda: 'tcv', contrato_enviado: 'sim', status_pagamento: 'pago', status_onboarding: 'concluido' }
    const r = criarFechamentoSchema(regras).safeParse({ ...completo, contrato_assinado: 'nao' })
    expect(r.success ? '' : r.error.issues.map((i) => i.message).join()).toMatch(/Confirme "Contrato assinado"/)
    expect(criarFechamentoSchema(regras).safeParse({ ...completo, contrato_assinado: 'sim' }).success).toBe(true)
  })

  it('opcional pode ficar vazio; obrigatório não; link inválido é recusado', () => {
    const regras = { ...generico, campos: { ...generico.campos, link_contrato: 'opcional' as const, observacoes: 'obrigatorio' as const } }
    expect(erros(criarFechamentoSchema(regras).safeParse({ ...base, tipo_venda: 'venda', link_contrato: '' }))).toEqual(['observacoes'])
    expect(erros(criarFechamentoSchema(regras).safeParse({ ...base, tipo_venda: 'venda', link_contrato: 'nao-e-link', observacoes: 'ok' }))).toEqual([
      'link_contrato',
    ])
  })

  it('serviço obrigatório exige ao menos um', () => {
    const regras = { ...generico, campos: { ...generico.campos, servicos: 'obrigatorio' as const } }
    expect(erros(criarFechamentoSchema(regras).safeParse({ ...base, tipo_venda: 'venda', servico_ids: [] }))).toEqual(['servico_ids'])
    expect(criarFechamentoSchema(regras).safeParse({ ...base, tipo_venda: 'venda', servico_ids: [ID] }).success).toBe(true)
  })

  it('edição: tipo vazio mantém o gravado; tipo não liberado é recusado', () => {
    const edicao = { negociacao_id: ID, valor_vendido: '500', data_fechamento: '2026-11-01' }
    const r = criarAtualizarFechamentoSchema(generico).safeParse({ ...edicao, tipo_venda: '' })
    expect(r.success && r.data.tipo_venda).toBe(null)
    expect(erros(criarAtualizarFechamentoSchema(generico).safeParse({ ...edicao, tipo_venda: 'mrr' }))).toEqual(['tipo_venda'])
  })
})
