import { describe, expect, it } from 'vitest'

import { tratarIntegracoes, type Dependencias, type ErroBanco } from '../../supabase/functions/_shared/integracoes-servico.ts'

/**
 * Coexistência oficial (app WhatsApp Business + Cloud API): a conexão pede só
 * os CONTATOS do app; o histórico antigo só sai com autorização separada do
 * Administrador (POST /whatsapp/historico), conferida pelo banco antes de
 * qualquer chamada à Meta. Banco e Meta são falsos; nada sai da máquina.
 */
const BASE = 'http://local/functions/v1/integracoes'
const GRAPH = 'https://meta.falsa/v23.0'
const T_A = '11111111-1111-4111-8111-111111111111'
const NUMERO = '66666666-6666-4666-8666-666666666666'
const FUNIL = '77777777-7777-4777-8777-777777777777'
const ETAPA = '88888888-8888-4888-8888-888888888888'
const RESP = '99999999-9999-4999-8999-999999999999'
const WABA = '10000000001'
const PHONE = '20000000002'

type Chamada = { nome: string; args?: Record<string, unknown> }
type Resp = { data: unknown; error: ErroBanco }
type Rpcs = Record<string, (args?: Record<string, unknown>) => Resp>
type Externa = { url: string; corpo: Record<string, unknown> | null }

function metaFalsa(opts: { historico?: Response } = {}) {
  return (url: string, corpo: Record<string, unknown> | null): Response => {
    if (url.includes('/oauth/access_token')) return Response.json({ access_token: 'tok-novo' })
    if (url.includes(`/${WABA}/phone_numbers`)) return Response.json({ data: [{ id: PHONE, display_phone_number: '+55 11 90000-0002', verified_name: 'Empresa A' }] })
    if (url.includes(`/${WABA}/subscribed_apps`)) return Response.json({ success: true })
    if (url.endsWith(`/${PHONE}/smb_app_data`)) {
      if (corpo?.sync_type === 'history' && opts.historico) return opts.historico
      return Response.json({ request_id: `req-${String(corpo?.sync_type)}` })
    }
    return new Response('{}', { status: 404 })
  }
}

function montar(opts: { admin?: Rpcs; usuario?: Rpcs; meta?: ReturnType<typeof metaFalsa>; semMeta?: boolean } = {}) {
  const chamadasAdmin: Chamada[] = []
  const chamadasUsuario: Chamada[] = []
  const externas: Externa[] = []
  const ordem: string[] = []
  const rpc = (mapa: Rpcs | undefined, registro: Chamada[], quem: string) => (nome: string, args?: Record<string, unknown>) => {
    registro.push({ nome, args })
    ordem.push(`${quem}:${nome}`)
    const f = mapa?.[nome]
    return Promise.resolve(f ? f(args) : { data: null, error: null })
  }
  const meta = opts.meta ?? metaFalsa()
  const deps: Dependencias = {
    admin: { rpc: rpc(opts.admin, chamadasAdmin, 'admin') },
    comoUsuario: () => ({
      rpc: rpc({ exigir_administrador_integracoes: () => ({ data: T_A, error: null }), ...opts.usuario }, chamadasUsuario, 'usuario'),
      auth: { getUser: async () => ({ data: { user: { id: 'u-admin' } }, error: null }) },
    }),
    buscar: async (url, init) => {
      const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      externas.push({ url: String(url), corpo })
      ordem.push(`meta:${String(url).replace(GRAPH, '')}`)
      return meta(String(url), corpo)
    },
    google: null,
    meta: opts.semMeta ? null : { graphUrl: GRAPH, appId: 'app', appSecret: 'segredo-app', configId: 'cfg', verifyToken: 'verifica' },
    segredoEstado: 'segredo-de-estado-com-pelo-menos-32-caracteres!!',
    segredoCron: 'segredo-do-agendador-com-32-caracteres-ou-mais',
    urlApp: 'https://avante.local',
  }
  return { deps, chamadasAdmin, chamadasUsuario, externas, ordem }
}

const post = (rota: string, corpo: unknown) =>
  new Request(`${BASE}${rota}`, { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(corpo) })
const historico = (corpo: Record<string, unknown> = { numero: NUMERO, confirmar: true }) => post('/whatsapp/historico', corpo)
const pedidosDeSync = (externas: Externa[]) => externas.filter((e) => e.url.endsWith('/smb_app_data')).map((e) => e.corpo?.sync_type)

/** Banco falso que autoriza (prazo e repetição conferidos no banco de verdade) e tem a credencial. */
const autoriza: Rpcs = { whatsapp_historico_autorizar: () => ({ data: PHONE, error: null }) }
const comToken: Rpcs = { whatsapp_obter_token: () => ({ data: [{ token: 'tok-guardado', phone_number_id: PHONE, tenant_id: T_A }], error: null }) }

describe('conexão em coexistência', () => {
  it('pede só os contatos do app; o histórico NÃO é pedido automaticamente', async () => {
    const admin: Rpcs = { whatsapp_salvar_numero: () => ({ data: NUMERO, error: null }) }
    const m = montar({ admin, usuario: { whatsapp_conexao_recente: () => ({ data: [], error: null }) } })
    const r = await tratarIntegracoes(
      post('/whatsapp/concluir', { code: 'code-unico', wabaId: WABA, phoneNumberId: PHONE, funil: FUNIL, etapa: ETAPA, responsavel: RESP, modo: 'coexistencia' }),
      m.deps,
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, situacao: 'conectado', modo: 'coexistencia', sincronizacao: { contatos: 'pedida' } })
    expect(pedidosDeSync(m.externas)).toEqual(['smb_app_state_sync'])
    const registros = m.chamadasAdmin.filter((c) => c.nome === 'whatsapp_sincronizacao_registrar').map((c) => c.args?.p_tipo)
    expect(registros).toEqual(['contatos'])
  })
})

describe('POST /whatsapp/historico (autorização separada)', () => {
  it('sem a confirmação explícita: recusa sem falar com o banco nem com a Meta', async () => {
    const m = montar({ usuario: autoriza, admin: comToken })
    const r = await tratarIntegracoes(historico({ numero: NUMERO }), m.deps)
    expect(r.status).toBe(422)
    expect(m.chamadasUsuario.some((c) => c.nome === 'whatsapp_historico_autorizar')).toBe(false)
    expect(m.externas).toHaveLength(0)
  })

  it('número inválido: recusa sem chamar nada', async () => {
    const m = montar({ usuario: autoriza, admin: comToken })
    const r = await tratarIntegracoes(historico({ numero: 'x', confirmar: true }), m.deps)
    expect(r.status).toBe(422)
    expect(m.externas).toHaveLength(0)
  })

  it('autorizado: o banco confere e registra ANTES; só depois a Meta recebe o pedido de histórico', async () => {
    const m = montar({ usuario: autoriza, admin: comToken })
    const r = await tratarIntegracoes(historico(), m.deps)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, situacao: 'pedida' })
    expect(m.chamadasUsuario.find((c) => c.nome === 'whatsapp_historico_autorizar')?.args).toEqual({ p_numero: NUMERO })
    const i = (s: string) => m.ordem.indexOf(s)
    expect(i('usuario:whatsapp_historico_autorizar')).toBeGreaterThan(-1)
    expect(i('usuario:whatsapp_historico_autorizar')).toBeLessThan(i(`meta:/${PHONE}/smb_app_data`))
    expect(pedidosDeSync(m.externas)).toEqual(['history'])
    expect(m.chamadasAdmin.find((c) => c.nome === 'whatsapp_sincronizacao_registrar')?.args).toMatchObject({
      p_numero: NUMERO,
      p_tipo: 'historico',
      p_ok: true,
      p_request_id: 'req-history',
    })
  })

  it('o phone_number_id vem do banco (do número da empresa), nunca do corpo', async () => {
    const m = montar({ usuario: autoriza, admin: comToken })
    await tratarIntegracoes(historico({ numero: NUMERO, confirmar: true, phoneNumberId: '99999999999' }), m.deps)
    expect(m.externas.map((e) => e.url)).toEqual([`${GRAPH}/${PHONE}/smb_app_data`])
  })

  it.each([
    ['23505', 'O histórico deste número já foi pedido nesta conexão. A Meta só permite uma vez.', 409],
    ['23514', 'O prazo da Meta para importar o histórico (24 horas depois da conexão) terminou.', 422],
    ['P0002', 'Número não encontrado nesta empresa.', 404],
    ['RX030', 'Integração desligada.', 422],
  ])('banco recusa (%s): mensagem clara e nada vai para a Meta', async (code, message, status) => {
    const m = montar({ usuario: { whatsapp_historico_autorizar: () => ({ data: null, error: { code, message } }) }, admin: comToken })
    const r = await tratarIntegracoes(historico(), m.deps)
    expect(r.status).toBe(status)
    expect((await r.json()).mensagem ?? '').toContain(message.slice(0, 20))
    expect(m.externas).toHaveLength(0)
    expect(m.chamadasAdmin.some((c) => c.nome === 'whatsapp_obter_token')).toBe(false)
  })

  it('quem não é Administrador: recusado antes da autorização', async () => {
    const m = montar({
      usuario: { exigir_administrador_integracoes: () => ({ data: null, error: { code: '42501', message: 'Somente o Administrador da empresa gerencia as integrações.' } }), ...autoriza },
      admin: comToken,
    })
    const r = await tratarIntegracoes(historico(), m.deps)
    expect(r.status).toBe(403)
    expect(m.chamadasUsuario.some((c) => c.nome === 'whatsapp_historico_autorizar')).toBe(false)
    expect(m.externas).toHaveLength(0)
  })

  it('sem credencial do número: registra a falha (libera novo pedido) e não chama a Meta', async () => {
    const m = montar({ usuario: autoriza, admin: { whatsapp_obter_token: () => ({ data: [], error: null }) } })
    const r = await tratarIntegracoes(historico(), m.deps)
    expect(r.status).toBe(503)
    expect(m.externas).toHaveLength(0)
    expect(m.chamadasAdmin.find((c) => c.nome === 'whatsapp_sincronizacao_registrar')?.args).toMatchObject({ p_tipo: 'historico', p_ok: false })
  })

  it('Meta recusa o pedido: fica registrado como erro (o Administrador pode tentar de novo no prazo)', async () => {
    const meta = metaFalsa({ historico: Response.json({ error: { code: 100, message: 'Invalid parameter' } }, { status: 400 }) })
    const m = montar({ usuario: autoriza, admin: comToken, meta })
    const r = await tratarIntegracoes(historico(), m.deps)
    expect(r.status).toBe(502)
    expect(m.chamadasAdmin.find((c) => c.nome === 'whatsapp_sincronizacao_registrar')?.args).toMatchObject({ p_tipo: 'historico', p_ok: false })
  })

  it('Meta não configurada na plataforma: nada acontece', async () => {
    const m = montar({ usuario: autoriza, admin: comToken, semMeta: true })
    const r = await tratarIntegracoes(historico(), m.deps)
    expect(r.status).toBe(503)
    expect(m.chamadasUsuario).toHaveLength(0)
    expect(m.externas).toHaveLength(0)
  })
})
