import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  assinaturaMetaValida,
  extrairContatosWhatsapp,
  extrairLeadgen,
  mapearCamposLeadMeta,
  respostaVerificacao,
} from '../../supabase/functions/_shared/meta.ts'
import { mapearRespondi } from '../../supabase/functions/_shared/respondi.ts'

const SEGREDO = 'app-secret-de-teste'
const assinar = (corpo: string, segredo = SEGREDO) => `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`

describe('assinatura da Meta', () => {
  const corpo = JSON.stringify({ object: 'page', entry: [] })

  it('aceita só o HMAC do corpo cru com o App Secret', async () => {
    expect(await assinaturaMetaValida(SEGREDO, corpo, assinar(corpo))).toBe(true)
    expect(await assinaturaMetaValida(SEGREDO, corpo + ' ', assinar(corpo))).toBe(false)
    expect(await assinaturaMetaValida(SEGREDO, corpo, assinar(corpo, 'outro'))).toBe(false)
    expect(await assinaturaMetaValida(SEGREDO, corpo, null)).toBe(false)
    expect(await assinaturaMetaValida('', corpo, assinar(corpo, ''))).toBe(false)
  })

  it('verificação GET só com o verify token certo', () => {
    const p = (q: string) => new URLSearchParams(q)
    expect(respostaVerificacao(p('hub.mode=subscribe&hub.verify_token=abc&hub.challenge=123'), 'abc')).toBe('123')
    expect(respostaVerificacao(p('hub.mode=subscribe&hub.verify_token=x&hub.challenge=123'), 'abc')).toBeNull()
    expect(respostaVerificacao(p('hub.mode=subscribe&hub.verify_token=&hub.challenge=123'), '')).toBeNull()
  })
})

describe('payloads da Meta', () => {
  it('extrai leadgen e ignora outros campos', () => {
    const corpo = {
      object: 'page',
      entry: [{ changes: [
        { field: 'leadgen', value: { leadgen_id: '111', page_id: '222', form_id: '333' } },
        { field: 'feed', value: { post_id: '9' } },
        { field: 'leadgen', value: { leadgen_id: 'abc', page_id: '222' } },
      ] }],
    }
    expect(extrairLeadgen(corpo)).toEqual([{ leadgenId: '111', pageId: '222', formId: '333' }])
    expect(extrairLeadgen({ object: 'whatsapp_business_account', entry: [] })).toEqual([])
  })

  it('extrai contato do WhatsApp só quando ele mandou mensagem', () => {
    const corpo = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: '555' },
        contacts: [{ wa_id: '5521999990000', profile: { name: 'Ana' } }, { wa_id: '5521888880000' }],
        messages: [{ from: '5521999990000', id: 'wamid.1', type: 'text' }],
      } }, { field: 'messages', value: { metadata: { phone_number_id: '555' }, statuses: [{ id: 'x' }] } }] }],
    }
    expect(extrairContatosWhatsapp(corpo)).toEqual([
      { phoneNumberId: '555', waId: '5521999990000', nome: 'Ana', mensagemId: 'wamid.1' },
    ])
  })

  it('mapeia field_data do lead', () => {
    expect(mapearCamposLeadMeta([
      { name: 'first_name', values: ['Ana'] }, { name: 'last_name', values: ['Souza'] },
      { name: 'phone_number', values: ['+5521999990000'] }, { name: 'email', values: ['ana@x.com'] },
    ])).toEqual({ nome: 'Ana Souza', telefone: '+5521999990000', email: 'ana@x.com', empresa: null })
  })
})

describe('Respondi da empresa', () => {
  const corpo = {
    form: { form_id: 'f1', form_name: 'Site' },
    respondent: {
      respondent_id: 'r-1',
      answers: { 'Seu nome completo': 'Ana', 'Digite seu e-mail': 'ana@x.com', 'Seu WhatsApp': '(21) 99999-0000', 'Quantos alunos?': '50' },
      respondent_utms: { utm_source: 'meta' },
    },
  }

  it('usa títulos comuns e guarda o resto como respostas', () => {
    const r = mapearRespondi(corpo)
    expect(r).toMatchObject({ external_id: 'r-1', nome: 'Ana', email: 'ana@x.com', telefone: '(21) 99999-0000' })
    expect(r?.respostas).toEqual([{ pergunta_externa: 'Quantos alunos?', resposta: '50' }])
    expect(r?.atribuicao).toMatchObject({ respondent_id: 'r-1', form_id: 'f1', utm_source: 'meta' })
  })

  it('respeita o mapa da fonte e recusa payload sem respondent_id', () => {
    expect(mapearRespondi(corpo, { nome: 'Quantos alunos?' })?.nome).toBe('50')
    expect(mapearRespondi({ respondent: {} })).toBeNull()
  })
})
