import { describe, expect, it } from 'vitest'

import { assinarEstado, verificarEstado } from '../../supabase/functions/_shared/estado-oauth.ts'
import { validarLead } from '../../supabase/functions/_shared/lead.ts'
import { credencialDaRequisicao, slugDaRequisicao } from '../../supabase/functions/_shared/requisicao.ts'

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-x'
const NONCE = 'a'.repeat(64)
const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

describe('state OAuth assinado', () => {
  it('ida e volta com a empresa', async () => {
    const state = await assinarEstado(SEGREDO, { n: NONCE, t: TENANT_A })
    expect(await verificarEstado(SEGREDO, state)).toEqual({ n: NONCE, t: TENANT_A })
  })

  it('recusa empresa trocada, assinatura de outro segredo e lixo', async () => {
    const state = await assinarEstado(SEGREDO, { n: NONCE, t: TENANT_A })
    const [, assinatura] = state.split('.')
    const corpoB = btoa(JSON.stringify({ n: NONCE, t: TENANT_B })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    expect(await verificarEstado(SEGREDO, `${corpoB}.${assinatura}`)).toBeNull()
    expect(await verificarEstado(`${SEGREDO}-outro`, state)).toBeNull()
    expect(await verificarEstado(SEGREDO, NONCE)).toBeNull()
    expect(await verificarEstado(SEGREDO, 'a.b.c')).toBeNull()
  })

  it('exige segredo longo', async () => {
    await expect(assinarEstado('curto', { n: NONCE, t: TENANT_A })).rejects.toThrow()
  })
})

describe('requisição', () => {
  const token = `rx7_${'0'.repeat(32)}_${'f'.repeat(64)}`

  it('lê a credencial só do header', () => {
    expect(credencialDaRequisicao(new Headers({ Authorization: `Bearer ${token}` }))).toBe(token)
    expect(credencialDaRequisicao(new Headers({ 'X-RX7-Credencial': token }))).toBe(token)
    expect(credencialDaRequisicao(new Headers({ Authorization: 'Bearer eyJhbGciOi.jwt.qualquer' }))).toBeNull()
    expect(credencialDaRequisicao(new Headers({ 'X-RX7-Credencial': 'rx7_curto' }))).toBeNull()
    expect(credencialDaRequisicao(new Headers())).toBeNull()
  })

  it('valida o slug da empresa', () => {
    expect(slugDaRequisicao(new Headers({ 'x-rx7-tenant': 'empresa-a' }))).toBe('empresa-a')
    expect(slugDaRequisicao(new Headers({ 'x-rx7-tenant': '../x' }))).toBeNull()
    expect(slugDaRequisicao(new Headers())).toBeNull()
  })
})

describe('validarLead', () => {
  const base = { external_id: 'ext-1', dados: { nome: 'Maria', telefone: '+55 (21) 99999-0000' } }

  it('aceita e normaliza', () => {
    const r = validarLead({ ...base, atribuicao: { utm_source: 'meta', campo_estranho: 'x' } })
    expect(r.ok && r.lead.telefone).toBe('5521999990000')
    expect(r.ok && r.lead.atribuicao).toEqual({ utm_source: 'meta' })
    expect(r.ok && r.lead.formulario_slug).toBeNull()
  })

  it('recusa empresa no corpo e dados faltando', () => {
    expect(validarLead({ ...base, tenant_id: TENANT_B }).ok).toBe(false)
    expect(validarLead({ external_id: 'x', dados: { nome: 'Maria' } }).ok).toBe(false)
    expect(validarLead({ dados: { nome: 'Maria', email: 'm@x.com' } }).ok).toBe(false)
    expect(validarLead({ ...base, formulario_slug: 'Com Espaço' }).ok).toBe(false)
  })
})
