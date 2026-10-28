import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { assinarEstado } from '../../supabase/functions/_shared/estado-oauth.ts'
import { processarFila, tratarIntegracoes, type Dependencias, type ErroBanco } from '../../supabase/functions/_shared/integracoes-servico.ts'

/**
 * Serviço `integracoes` com dependências falsas: banco (RPCs gravadas), usuário
 * logado e Google/Meta simulados. Nenhuma chamada sai da máquina.
 */
const SEGREDO_ESTADO = 'segredo-de-estado-com-pelo-menos-32-caracteres!!'
const APP_SECRET = 'app-secret-teste'
const BASE = 'http://local/functions/v1/integracoes'
const T_A = '11111111-1111-4111-8111-111111111111'
const T_B = '22222222-2222-4222-8222-222222222222'
const CONTA = '33333333-3333-4333-8333-333333333333'
const FONTE = '44444444-4444-4444-8444-444444444444'
const CONVERSA = '55555555-5555-4555-8555-555555555555'
const NONCE = 'a'.repeat(64)

type Chamada = { nome: string; args?: Record<string, unknown> }
type Resp = { data: unknown; error: ErroBanco }
type Rpcs = Record<string, (args?: Record<string, unknown>) => Resp>

function montar(opts: { admin?: Rpcs; usuario?: Rpcs; logado?: boolean; buscar?: (url: string, init?: RequestInit) => Response } = {}) {
  const chamadasAdmin: Chamada[] = []
  const chamadasUsuario: Chamada[] = []
  const externas: string[] = []
  const rpc = (mapa: Rpcs | undefined, registro: Chamada[]) => (nome: string, args?: Record<string, unknown>) => {
    registro.push({ nome, args })
    const f = mapa?.[nome]
    return Promise.resolve(f ? f(args) : { data: null, error: null })
  }
  const deps: Dependencias = {
    admin: { rpc: rpc(opts.admin, chamadasAdmin) },
    comoUsuario: () => ({
      rpc: rpc(opts.usuario, chamadasUsuario),
      auth: { getUser: async () => ({ data: { user: opts.logado === false ? null : { id: 'u-admin' } }, error: null }) },
    }),
    buscar: async (url, init) => {
      externas.push(String(url))
      return opts.buscar ? opts.buscar(String(url), init) : new Response('{}', { status: 500 })
    },
    google: {
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: `${BASE}/google/callback`,
      authUrl: 'https://google.falso/auth',
      tokenUrl: 'https://google.falso/token',
      revokeUrl: 'https://google.falso/revoke',
      sheetsUrl: 'https://google.falso/sheets',
      chaveApiPicker: 'chave',
      appIdPicker: 'app',
    },
    meta: { graphUrl: 'https://meta.falsa/v23.0', appId: 'app', appSecret: APP_SECRET, configId: 'cfg', verifyToken: 'verifica' },
    segredoEstado: SEGREDO_ESTADO,
    segredoCron: 'segredo-do-agendador-com-32-caracteres-ou-mais',
    urlApp: 'https://avante.local',
  }
  return { deps, chamadasAdmin, chamadasUsuario, externas }
}

const post = (rota: string, corpo: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${rota}`, { method: 'POST', headers: { Authorization: 'Bearer jwt', ...headers }, body: JSON.stringify(corpo) })
const assinar = (corpo: string, segredo = APP_SECRET) => `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`
const adminA: Rpcs = { exigir_administrador_integracoes: () => ({ data: T_A, error: null }) }

describe('webhook do WhatsApp', () => {
  const corpo = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, messages: [{ id: 'wamid.1', from: '5511999990001', type: 'text', text: { body: 'oi' } }] } }] }],
  })

  it('assinatura forjada ou ausente: 401 e nada chega ao banco', async () => {
    for (const cabecalho of [assinar(corpo, 'outro-segredo'), '', 'sha256=00']) {
      const { deps, chamadasAdmin } = montar()
      const r = await tratarIntegracoes(new Request(`${BASE}/whatsapp/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': cabecalho }, body: corpo }), deps)
      expect(r.status).toBe(401)
      expect(chamadasAdmin).toHaveLength(0)
    }
  })

  it('assinatura válida: registra pelo phone_number_id (a empresa vem do banco, não do corpo)', async () => {
    const { deps, chamadasAdmin } = montar()
    const r = await tratarIntegracoes(new Request(`${BASE}/whatsapp/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': assinar(corpo) }, body: corpo }), deps)
    expect(r.status).toBe(200)
    expect(chamadasAdmin).toEqual([
      { nome: 'whatsapp_registrar_entrada', args: expect.objectContaining({ p_phone_number_id: '1234567890', p_wa_message_id: 'wamid.1', p_de: '5511999990001' }) },
    ])
    expect(JSON.stringify(chamadasAdmin)).not.toContain('tenant')
  })

  it('falha temporária no banco devolve 500 (a Meta reenvia; a gravação é idempotente)', async () => {
    const { deps } = montar({ admin: { whatsapp_registrar_entrada: () => ({ data: null, error: { code: '40001', message: 'x' } }) } })
    const r = await tratarIntegracoes(new Request(`${BASE}/whatsapp/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': assinar(corpo) }, body: corpo }), deps)
    expect(r.status).toBe(500)
  })

  it('verificação GET só com o verify token certo', async () => {
    const { deps } = montar()
    const ok = await tratarIntegracoes(new Request(`${BASE}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=42`), deps)
    expect(await ok.text()).toBe('42')
    const nao = await tratarIntegracoes(new Request(`${BASE}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42`), deps)
    expect(nao.status).toBe(403)
  })
})

describe('envio do WhatsApp (controle de custo)', () => {
  it('banco bloqueia (fora da janela gratuita, cobrança, limite): nenhuma chamada à Meta', async () => {
    for (const [bloqueio, status] of [
      ['fora_da_janela', 422],
      ['bloqueado_por_cobranca', 422],
      ['limite_diario', 429],
    ] as const) {
      const { deps, externas, chamadasAdmin } = montar({
        usuario: { whatsapp_preparar_envio: () => ({ data: [{ mensagem_id: null, numero_id: 'n1', phone_number_id: null, destino: null, bloqueio, mensagem: 'Bloqueado.' }], error: null }) },
      })
      const r = await tratarIntegracoes(post('/whatsapp/enviar', { conversa: CONVERSA, texto: 'oi' }), deps)
      expect(r.status).toBe(status)
      expect(((await r.json()) as { codigo: string }).codigo).toBe(bloqueio)
      expect(externas).toHaveLength(0)
      expect(chamadasAdmin).toHaveLength(0)
    }
  })

  it('banco recusa (sem permissão, número pausado): nenhuma chamada à Meta', async () => {
    for (const [code, status] of [
      ['42501', 403],
      ['RX020', 422],
      ['P0002', 404],
    ] as const) {
      const { deps, externas } = montar({ usuario: { whatsapp_preparar_envio: () => ({ data: null, error: { code, message: 'regra' } }) } })
      const r = await tratarIntegracoes(post('/whatsapp/enviar', { conversa: CONVERSA, texto: 'oi' }), deps)
      expect(r.status).toBe(status)
      expect(externas).toHaveLength(0)
    }
  })

  it('autorizado pelo banco: envia texto livre e confirma com o ID da Meta', async () => {
    const { deps, externas, chamadasAdmin } = montar({
      usuario: { whatsapp_preparar_envio: () => ({ data: [{ mensagem_id: 'm1', numero_id: 'n1', phone_number_id: '1234567890', destino: '5511999990001' }], error: null }) },
      admin: { whatsapp_obter_token: () => ({ data: [{ token: 'tok' }], error: null }) },
      buscar: () => new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] })),
    })
    const r = await tratarIntegracoes(post('/whatsapp/enviar', { conversa: CONVERSA, texto: ' oi ' }), deps)
    expect(r.status).toBe(200)
    expect(externas).toEqual(['https://meta.falsa/v23.0/1234567890/messages'])
    expect(chamadasAdmin.at(-1)).toEqual({ nome: 'whatsapp_confirmar_envio', args: { p_mensagem: 'm1', p_wa_message_id: 'wamid.OUT', p_ok: true, p_erro: null } })
  })

  it('sem sessão: 401 antes de qualquer coisa', async () => {
    const { deps, chamadasUsuario } = montar({ logado: false })
    expect((await tratarIntegracoes(post('/whatsapp/enviar', { conversa: CONVERSA, texto: 'oi' }), deps)).status).toBe(401)
    expect(chamadasUsuario).toHaveLength(0)
  })
})

describe('OAuth do Google', () => {
  it('só o Administrador inicia; a URL leva o state assinado', async () => {
    const negado = montar({ usuario: { exigir_administrador_integracoes: () => ({ data: null, error: { code: '42501', message: 'Somente o Administrador.' } }) } })
    expect((await tratarIntegracoes(post('/google/iniciar', {}), negado.deps)).status).toBe(403)

    const { deps } = montar({ usuario: { ...adminA, integracao_criar_estado: () => ({ data: 'nonce123', error: null }) } })
    const r = await tratarIntegracoes(post('/google/iniciar', { retorno: '/configuracoes/integracoes/google-sheets' }), deps)
    const { url } = (await r.json()) as { url: string }
    expect(new URL(url).searchParams.get('state')).toMatch(/\./)
  })

  it('callback com state forjado ou de outra empresa não salva nada', async () => {
    const forjado = montar()
    const r1 = await tratarIntegracoes(new Request(`${BASE}/google/callback?state=abc.def&code=x`), forjado.deps)
    expect(r1.headers.get('Location')).toContain('estado_invalido')
    expect(forjado.chamadasAdmin).toHaveLength(0)

    const state = await assinarEstado(SEGREDO_ESTADO, { n: NONCE, t: T_A })
    const outra = montar({
      admin: { integracao_consumir_estado: () => ({ data: [{ tenant_id: T_B, usuario_id: 'u', provedor: 'google', retorno: '/x' }], error: null }) },
    })
    const r2 = await tratarIntegracoes(new Request(`${BASE}/google/callback?state=${encodeURIComponent(state)}&code=x`), outra.deps)
    expect(r2.headers.get('Location')).toContain('estado_expirado')
    expect(outra.chamadasAdmin.map((c) => c.nome)).toEqual(['integracao_consumir_estado'])
    expect(outra.externas).toHaveLength(0)
  })

  it('retorno do OAuth para outro site cai na tela padrão (sem redirecionamento aberto)', async () => {
    const state = await assinarEstado(SEGREDO_ESTADO, { n: NONCE, t: T_A })
    const { deps } = montar({
      admin: { integracao_consumir_estado: () => ({ data: [{ tenant_id: T_A, usuario_id: 'u', provedor: 'google', retorno: '//site-malicioso.example/x' }], error: null }) },
    })
    const r = await tratarIntegracoes(new Request(`${BASE}/google/callback?state=${encodeURIComponent(state)}&error=access_denied`), deps)
    expect(new URL(r.headers.get('Location')!).origin).toBe('https://avante.local')
  })

  it('sem o escopo drive.file: revoga o token e não salva a conta', async () => {
    const state = await assinarEstado(SEGREDO_ESTADO, { n: NONCE, t: T_A })
    const { deps, chamadasAdmin, externas } = montar({
      admin: { integracao_consumir_estado: () => ({ data: [{ tenant_id: T_A, usuario_id: 'u', provedor: 'google', retorno: '/x' }], error: null }) },
      buscar: (url) => (url.includes('/token') ? new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'openid email' })) : new Response('')),
    })
    const r = await tratarIntegracoes(new Request(`${BASE}/google/callback?state=${encodeURIComponent(state)}&code=x`), deps)
    expect(r.headers.get('Location')).toContain('permissao_negada')
    expect(chamadasAdmin.map((c) => c.nome)).not.toContain('google_salvar_conta')
    expect(externas.some((u) => u.startsWith('https://google.falso/revoke'))).toBe(true)
  })

  it('o refresh token nunca volta na resposta; conta de outra empresa não abre planilha', async () => {
    const { deps } = montar({ usuario: { ...adminA, google_contas_da_empresa: () => ({ data: [{ id: CONTA, ativa: true }], error: null }) } })
    const r = await tratarIntegracoes(post('/google/planilha', { conta: '99999999-9999-4999-8999-999999999999', link: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit' }), deps)
    expect(r.status).toBe(404)
  })

  it('planilha privada sem autorização do arquivo: 403 autorizar_arquivo (link sozinho não basta)', async () => {
    const { deps } = montar({
      usuario: { ...adminA, google_contas_da_empresa: () => ({ data: [{ id: CONTA, ativa: true }], error: null }) },
      admin: { google_obter_refresh_token: () => ({ data: 'refresh-secreto', error: null }) },
      buscar: (url) => (url.includes('/token') ? new Response(JSON.stringify({ access_token: 'acesso' })) : new Response('{}', { status: 404 })),
    })
    const r = await tratarIntegracoes(post('/google/planilha', { conta: CONTA, link: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit' }), deps)
    const corpo = await r.text()
    expect(r.status).toBe(403)
    expect(JSON.parse(corpo).codigo).toBe('autorizar_arquivo')
    expect(corpo).not.toContain('refresh-secreto')
  })
})

describe('fila de sincronização', () => {
  const reservada = { fonte_id: FONTE, conta_id: CONTA, planilha_id: 'P'.repeat(30), aba_nome: 'Leads', linha_cabecalho: 1, mapeamento: { nome: 'Nome', telefone: 'Telefone' }, coluna_chave: null, primeira: false }

  it('autorização revogada: marca a conta e a planilha, sem ler linhas', async () => {
    const { deps, chamadasAdmin } = montar({
      admin: { sheets_reservar: () => ({ data: [reservada], error: null }), google_obter_refresh_token: () => ({ data: 'r', error: null }) },
      buscar: () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    })
    const resumo = await processarFila(deps)
    expect(resumo[0]).toMatchObject({ ok: false })
    expect(chamadasAdmin.map((c) => c.nome)).toEqual(['sheets_reservar', 'google_obter_refresh_token', 'google_registrar_erro_conta', 'sheets_concluir'])
    expect(chamadasAdmin.at(-1)?.args).toMatchObject({ p_ok: false, p_autorizacao: true })
  })

  it('colunas renomeadas na planilha: erro claro, nada é importado', async () => {
    const { deps, chamadasAdmin } = montar({
      admin: { sheets_reservar: () => ({ data: [reservada], error: null }), google_obter_refresh_token: () => ({ data: 'r', error: null }) },
      buscar: (url) => (url.includes('/token') ? new Response(JSON.stringify({ access_token: 'a' })) : new Response(JSON.stringify({ values: [['Cliente', 'Celular'], ['Ana', '11999990001']] }))),
    })
    await processarFila(deps)
    expect(chamadasAdmin.map((c) => c.nome)).not.toContain('sheets_processar_linhas')
    expect(String(chamadasAdmin.at(-1)?.args?.p_erro)).toMatch(/Colunas mudaram/)
  })

  it('lê, envia ao banco em lote e conclui com sucesso', async () => {
    const { deps, chamadasAdmin } = montar({
      admin: {
        sheets_reservar: () => ({ data: [reservada], error: null }),
        google_obter_refresh_token: () => ({ data: 'r', error: null }),
        sheets_processar_linhas: (a) => ({ data: { importada: (a?.p_linhas as unknown[]).length }, error: null }),
      },
      buscar: (url) =>
        url.includes('/token')
          ? new Response(JSON.stringify({ access_token: 'a' }))
          : new Response(JSON.stringify({ values: [['Nome', 'Telefone'], ['Ana', '11999990001'], ['Bia', '11999990002']] })),
    })
    const resumo = await processarFila(deps)
    expect(resumo[0]).toMatchObject({ ok: true, linhas: 2, importada: 2 })
    expect(chamadasAdmin.at(-1)).toMatchObject({ nome: 'sheets_concluir', args: { p_ok: true } })
  })

  it('agendador exige o segredo', async () => {
    const { deps, chamadasAdmin } = montar()
    expect((await tratarIntegracoes(post('/cron', {}, { 'x-cron-secret': 'errado' }), deps)).status).toBe(401)
    expect(chamadasAdmin).toHaveLength(0)
  })
})
