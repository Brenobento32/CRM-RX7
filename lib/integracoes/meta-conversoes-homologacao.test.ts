import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { CONFIRMACAO_HOMOLOGACAO, tratarIntegracoes, type Dependencias, type ErroBanco } from '../../supabase/functions/_shared/integracoes-servico.ts'
import { homologacaoVigente, lerConfigHomologacao, semSegredos, type ConfigHomologacao } from '../../supabase/functions/_shared/meta-conversoes.ts'

/**
 * Homologação de UM evento da CAPI (Super Admin), fora da fila geral.
 * Banco e Meta são falsos: conta cada chamada para provar que nada sai sem
 * todas as travas (secret ligado, empresa, Super Admin, confirmação).
 */
const BASE = 'http://local/functions/v1/integracoes'
const GRAPH = 'https://meta.falsa/v23.0'
const T_A = '11111111-1111-4111-8111-111111111111'
const T_B = '22222222-2222-4222-8222-222222222222'
const NEG = '33333333-3333-4333-8333-333333333333'
const DS = '1437190367856606'
const FORM = '1459591029473591'
const LEAD = '12345678901234567'
const TOKEN = 'tok-sistema-capi-xxxxxxxxxxxxxx'
const CODIGO = 'TEST12345'
const EVENT_TIME = 1793740000

const cfgValida = (sobre: Partial<ConfigHomologacao> = {}): ConfigHomologacao => ({
  empresa: T_A,
  dataset: DS,
  formulario: FORM,
  negociacao: NEG,
  leadId: LEAD,
  ate: new Date(Date.now() + 3600_000).toISOString(),
  ...sobre,
})

type Chamada = { nome: string; args?: Record<string, unknown> }
type Resp = { data: unknown; error: ErroBanco }

const linha = (reservar: boolean, sobre: Record<string, unknown> = {}) => ({
  homologacao: reservar ? '44444444-4444-4444-8444-444444444444' : null,
  dataset: DS,
  negocio: '938379700973334',
  nome_evento: 'Lead recebido',
  id_evento: `avante-homologacao-${NEG}`,
  momento_unix: String(EVENT_TIME),
  lead: LEAD,
  credencial: reservar ? TOKEN : null,
  ja_feita: false,
  ...sobre,
})

function montar(
  opts: {
    cfg?: ConfigHomologacao | null
    tenant?: string
    superAdmin?: boolean
    preparar?: (args?: Record<string, unknown>) => Resp
    meta?: () => Response
    /** Sessão recusada pelo Auth (sem token, token falso ou vencido). */
    semSessao?: boolean
    /** Banco recusa a empresa (ex.: Super Admin sem a janela do "Acessar CRM"). */
    semJanela?: boolean
  } = {},
) {
  const admin: Chamada[] = []
  const externas: { url: string; metodo: string; auth: string | null; corpo: string }[] = []
  const usuario = { criados: 0, getUser: 0 }
  const deps: Dependencias = {
    admin: {
      rpc: (nome, args) => {
        admin.push({ nome, args })
        if (nome === 'capi_homologacao_preparar') {
          return Promise.resolve(opts.preparar ? opts.preparar(args) : { data: [linha(args?.p_reservar === true)], error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
    },
    comoUsuario: () => {
      usuario.criados++
      return {
        rpc: (nome: string) => {
          if (nome === 'exigir_administrador_integracoes') {
            return Promise.resolve(opts.semJanela ? { data: null, error: { code: '42501', message: 'Empresa não informada ou sem acesso.' } } : { data: opts.tenant ?? T_A, error: null })
          }
          if (nome === 'is_super_admin') return Promise.resolve({ data: opts.superAdmin ?? true, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        auth: {
          getUser: async () => {
            usuario.getUser++
            return opts.semSessao ? { data: { user: null }, error: { status: 401 } } : { data: { user: { id: 'u-super' } }, error: null }
          },
        },
      }
    },
    buscar: async (url, init) => {
      externas.push({ url: String(url), metodo: String(init?.method ?? 'GET'), auth: new Headers(init?.headers).get('Authorization'), corpo: String(init?.body ?? '') })
      return opts.meta ? opts.meta() : Response.json({ events_received: 1, fbtrace_id: 'TraceOk' })
    },
    google: null,
    meta: { graphUrl: GRAPH, appId: 'app', appSecret: 'segredo-app', configId: 'cfg', configIdAds: 'cfg-ads', verifyToken: 'v' },
    segredoEstado: 'segredo-de-estado-com-pelo-menos-32-caracteres!!',
    segredoCron: 'segredo-do-agendador-com-32-caracteres-ou-mais',
    urlApp: 'https://avante.local',
    homologacaoCapi: opts.cfg === undefined ? cfgValida() : opts.cfg,
  }
  return { deps, admin, externas, usuario }
}

const post = (rota: string, corpo: unknown = {}) =>
  new Request(`${BASE}${rota}`, { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(corpo) })
const pedido = (sobre: Record<string, unknown> = {}) => ({ negociacao: NEG, codigoTeste: CODIGO, confirmacao: CONFIRMACAO_HOMOLOGACAO, ...sobre })
const SITUACAO = '/meta-conversoes/homologacao'
const ENVIAR = '/meta-conversoes/homologacao/enviar'

describe('configuração (secret CAPI_HOMOLOGACAO)', () => {
  it('desligada por padrão: vazio, JSON inválido ou campos errados não ligam nada', () => {
    expect(lerConfigHomologacao(undefined)).toBeNull()
    expect(lerConfigHomologacao('')).toBeNull()
    expect(lerConfigHomologacao('{')).toBeNull()
    expect(lerConfigHomologacao('[]')).toBeNull()
    const base = { empresa: T_A, dataset: DS, formulario: FORM, negociacao: NEG, lead_id: LEAD, ate: '2026-11-10T23:59:00-03:00' }
    expect(lerConfigHomologacao(JSON.stringify({ ...base, empresa: 'rio-x7' }))).toBeNull()
    expect(lerConfigHomologacao(JSON.stringify({ ...base, lead_id: '1234567890123' }))).toBeNull()
    expect(lerConfigHomologacao(JSON.stringify({ ...base, dataset: 'abc' }))).toBeNull()
    expect(lerConfigHomologacao(JSON.stringify({ ...base, ate: 'amanhã' }))).toBeNull()
    expect(lerConfigHomologacao(JSON.stringify({ ...base, formulario: undefined }))).toBeNull()
    // O formulário autorizado leva só os dígitos; o "f:" da planilha é tratado no banco (20261111090000).
    expect(lerConfigHomologacao(JSON.stringify({ ...base, formulario: `f:${FORM}` }))).toBeNull()
    expect(lerConfigHomologacao(JSON.stringify(base))).toEqual({ empresa: T_A, dataset: DS, formulario: FORM, negociacao: NEG, leadId: LEAD, ate: base.ate })
  })

  it('vale só no prazo, e o prazo nunca passa de 7 dias', () => {
    const agora = Date.parse('2026-11-04T12:00:00Z')
    expect(homologacaoVigente(cfgValida({ ate: '2026-11-04T13:00:00Z' }), agora)).toBe(true)
    expect(homologacaoVigente(cfgValida({ ate: '2026-11-04T11:00:00Z' }), agora)).toBe(false)
    expect(homologacaoVigente(cfgValida({ ate: '2026-11-20T12:00:00Z' }), agora)).toBe(false)
  })

  it('mensagens sem segredos', () => {
    expect(semSegredos(`100 código ${CODIGO} inválido; token ${TOKEN}`, [CODIGO, TOKEN])).toBe('100 código *** inválido; token ***')
  })
})

describe('travas antes de qualquer envio', () => {
  it('sem o secret: situação "indisponível" e envio 404, sem tocar no banco nem na Meta', async () => {
    const { deps, admin, externas, usuario } = montar({ cfg: null })
    expect(await (await tratarIntegracoes(post(SITUACAO), deps)).json()).toEqual({ ok: true, disponivel: false })
    expect((await tratarIntegracoes(post(ENVIAR, pedido()), deps)).status).toBe(404)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
    // Nem a sessão é consultada: a rota simplesmente não existe.
    expect(usuario.criados).toBe(0)
  })

  it('sem o secret, chamada direta sem sessão nenhuma: 404 igual', async () => {
    const { deps, admin, externas } = montar({ cfg: null, semSessao: true })
    const r = await tratarIntegracoes(new Request(`${BASE}${ENVIAR}`, { method: 'POST', body: JSON.stringify(pedido()) }), deps)
    expect(r.status).toBe(404)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
  })

  it('com o secret, chamada direta sem sessão válida (sem token, falso ou vencido): 401 e nada sai', async () => {
    const { deps, admin, externas, usuario } = montar({ semSessao: true })
    const r = await tratarIntegracoes(new Request(`${BASE}${ENVIAR}`, { method: 'POST', headers: { Authorization: 'Bearer token-falso' }, body: JSON.stringify(pedido()) }), deps)
    expect(r.status).toBe(401)
    expect(usuario.getUser).toBe(1)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
    expect(await (await tratarIntegracoes(post(SITUACAO), deps)).json()).toEqual({ ok: true, disponivel: false })
  })

  it('Super Admin sem a janela do "Acessar CRM" (o banco não resolve a empresa): recusado e nada sai', async () => {
    const { deps, admin, externas } = montar({ semJanela: true })
    expect((await tratarIntegracoes(post(ENVIAR, pedido()), deps)).status).toBe(403)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
  })

  it('a empresa vem do banco, nunca do corpo: campo "empresa" no pedido é ignorado', async () => {
    const { deps, admin } = montar()
    await tratarIntegracoes(post(ENVIAR, pedido({ empresa: T_B, tenant: T_B })), deps)
    expect(admin[0].args?.p_tenant).toBe(T_A)
  })

  it('prazo vencido: igual a desligada', async () => {
    const { deps, admin, externas } = montar({ cfg: cfgValida({ ate: new Date(Date.now() - 1000).toISOString() }) })
    expect((await tratarIntegracoes(post(ENVIAR, pedido()), deps)).status).toBe(404)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
  })

  it('outra empresa: a homologação nem aparece', async () => {
    const { deps, admin, externas } = montar({ tenant: T_B })
    expect(await (await tratarIntegracoes(post(SITUACAO), deps)).json()).toEqual({ ok: true, disponivel: false })
    expect((await tratarIntegracoes(post(ENVIAR, pedido()), deps)).status).toBe(404)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
  })

  it('Administrador da empresa que não é Super Admin: recusado', async () => {
    const { deps, admin, externas } = montar({ superAdmin: false })
    expect((await tratarIntegracoes(post(ENVIAR, pedido()), deps)).status).toBe(403)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
  })

  it.each([
    ['negociação diferente da autorizada', pedido({ negociacao: '55555555-5555-4555-8555-555555555555' })],
    ['sem a confirmação digitada', pedido({ confirmacao: 'enviar' })],
    ['sem código de teste', pedido({ codigoTeste: '' })],
    ['código de teste inválido', pedido({ codigoTeste: 'x y' })],
  ])('%s: recusado antes de reservar', async (_nome, corpo) => {
    const { deps, admin, externas } = montar()
    expect((await tratarIntegracoes(post(ENVIAR, corpo), deps)).status).toBe(422)
    expect(admin).toEqual([])
    expect(externas).toEqual([])
  })

  it('negociação já homologada (banco recusa a repetição): 409 e nada sai', async () => {
    const { deps, externas } = montar({
      preparar: () => ({ data: null, error: { code: '23505', message: 'Esta negociação já teve o evento de homologação. Não há reenvio.' } }),
    })
    const r = await tratarIntegracoes(post(ENVIAR, pedido()), deps)
    expect(r.status).toBe(409)
    expect(externas).toEqual([])
  })

  it('envio geral ligado (banco recusa): 422 e nada sai', async () => {
    const { deps, externas } = montar({
      preparar: () => ({ data: null, error: { code: '23514', message: 'A homologação só roda com o envio geral desligado (situação atual: ativa).' } }),
    })
    expect((await tratarIntegracoes(post(ENVIAR, pedido()), deps)).status).toBe(422)
    expect(externas).toEqual([])
  })
})

describe('situação (nada é gravado nem enviado)', () => {
  it('mostra o que seria enviado, sem credencial e só o fim do ID do lead', async () => {
    const { deps, admin, externas } = montar()
    const r = await tratarIntegracoes(post(SITUACAO), deps)
    const c = await r.json()
    expect(c).toMatchObject({ ok: true, disponivel: true, pronto: true, jaFeita: false, negociacao: NEG, evento: 'Lead recebido', eventId: `avante-homologacao-${NEG}`, eventTime: EVENT_TIME, leadFinal: '4567', dataset: DS })
    expect(JSON.stringify(c)).not.toContain(TOKEN)
    expect(JSON.stringify(c)).not.toContain(LEAD)
    expect(admin).toEqual([{ nome: 'capi_homologacao_preparar', args: { p_tenant: T_A, p_usuario: 'u-super', p_negociacao: NEG, p_lead_id: LEAD, p_dataset: DS, p_formulario: FORM, p_reservar: false } }])
    expect(externas).toEqual([])
  })
})

describe('envio de UM evento', () => {
  it('payload de CRM da Meta: Lead recebido, lead_id, system_generated, crm, event_id próprio, código de teste, sem valor e sem contato', async () => {
    const { deps, admin, externas } = montar()
    const r = await tratarIntegracoes(post(ENVIAR, pedido()), deps)
    expect(r.status).toBe(200)
    expect(externas).toHaveLength(1)
    const e = externas[0]
    expect(e.metodo).toBe('POST')
    expect(e.url).toBe(`${GRAPH}/${DS}/events?appsecret_proof=${createHmac('sha256', 'segredo-app').update(TOKEN).digest('hex')}`)
    expect(e.auth).toBe(`Bearer ${TOKEN}`)
    expect(e.corpo).toContain(`"lead_id":${LEAD}`)
    const corpo = JSON.parse(e.corpo)
    expect(corpo).toEqual({
      data: [
        {
          event_name: 'Lead recebido',
          event_time: EVENT_TIME,
          event_id: `avante-homologacao-${NEG}`,
          action_source: 'system_generated',
          user_data: { lead_id: Number(LEAD) },
          custom_data: { event_source: 'crm', lead_event_source: 'AVANTE CRM' },
        },
      ],
      test_event_code: CODIGO,
    })
    expect(admin.map((a) => a.nome)).toEqual(['capi_homologacao_preparar', 'capi_homologacao_concluir'])
    expect(admin[0].args?.p_reservar).toBe(true)
    expect(admin[1].args).toEqual({ p_homologacao: '44444444-4444-4444-8444-444444444444', p_resultado: 'ok', p_erro: null, p_fbtrace: 'TraceOk' })
    const resposta = await r.json()
    expect(resposta).toMatchObject({ ok: true, aceito: true, resultado: 'ok', fbtrace: 'TraceOk', evento: 'Lead recebido', dataset: DS })
    expect(JSON.stringify(resposta)).not.toContain(TOKEN)
    expect(JSON.stringify(resposta)).not.toContain(CODIGO)
  })

  it('erro da Meta: registrado como rejeitado, sem código de teste nem token na mensagem', async () => {
    const { deps, admin, externas } = montar({
      meta: () => Response.json({ error: { code: 100, error_subcode: 2804003, message: `test_event_code ${CODIGO} / lead_id inválido`, fbtrace_id: 'TraceErro' } }, { status: 400 }),
    })
    const r = await tratarIntegracoes(post(ENVIAR, pedido()), deps)
    const c = await r.json()
    expect(externas).toHaveLength(1)
    expect(c).toMatchObject({ ok: true, aceito: false, resultado: 'permanente', fbtrace: 'TraceErro' })
    expect(JSON.stringify(c)).not.toContain(CODIGO)
    const concluir = admin.find((a) => a.nome === 'capi_homologacao_concluir')
    expect(concluir?.args?.p_resultado).toBe('permanente')
    expect(String(concluir?.args?.p_erro)).not.toContain(CODIGO)
    expect(String(concluir?.args?.p_erro)).toContain('***')
  })

  it('nunca usa a fila geral nem a credencial da fila', async () => {
    const { deps, admin } = montar()
    await tratarIntegracoes(post(ENVIAR, pedido()), deps)
    expect(admin.some((a) => ['capi_reservar', 'capi_concluir', 'capi_obter_token', 'capi_acao', 'meta_ads_credencial'].includes(a.nome))).toBe(false)
  })
})
