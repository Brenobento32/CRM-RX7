/**
 * Edge Function `agenda-google` — conexão OAuth com o Google Calendar da
 * empresa e diagnóstico das cores usadas (Agenda 2.0, Fase A).
 *
 * Como `admin-usuarios`, é um dos poucos lugares com a chave service_role. O
 * client secret do Google e o refresh token também só existem aqui: o secret
 * no ambiente das Edge Functions, o token no Supabase Vault.
 *
 * Escopo: calendar.readonly. Nada é escrito no Google, e nesta fase nenhum
 * evento do Google é gravado no CRM.
 *
 * Rotas:
 *   POST (JWT de gerente)  { acao: 'iniciar', retorno }  → { url } do consentimento
 *   POST (JWT de gerente)  { acao: 'diagnostico', dias_passado, dias_futuro }
 *   POST (JWT de gerente)  { acao: 'desconectar' }
 *   GET  /callback?code&state   ← o Google redireciona o navegador para cá
 *
 * O deploy é com --no-verify-jwt, porque o /callback chega do Google sem JWT.
 * As rotas POST verificam o JWT aqui dentro (getUser + is_gerente), e o
 * /callback só aceita um `state` de uso único criado por um gerente.
 *
 * Multiempresa: uma conexão por empresa. A empresa da chamada POST vem do
 * header `x-rx7-tenant` e é validada pelo banco (`tenant_atual()` + papel de
 * gerente nela). O `state` do OAuth é assinado (HMAC) com a empresa e
 * gravado no banco (uso único, 10 min); no /callback a empresa sai do estado
 * gravado e precisa bater com a assinada — nunca de um parâmetro da URL.
 * Desconectar uma empresa revoga e apaga só o token dela.
 *
 * Secrets (npx supabase secrets set …):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_STATE_SECRET  chave do HMAC do state (≥ 32 caracteres)
 *   GOOGLE_OAUTH_REDIRECT_URI  opcional: callback cadastrado no Google (padrão:
 *                              <SUPABASE_URL>/functions/v1/agenda-google/callback)
 *   CRM_URLS_PERMITIDAS        origens do CRM para onde o /callback pode voltar,
 *                              separadas por vírgula (localhost, domínio da Hostinger…)
 * A conta Google aceita por empresa fica em tenant_configuracoes.google_conta_permitida
 * (vazio = qualquer conta do gerente).
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

import { assinarEstado, verificarEstado } from '../_shared/estado-oauth.ts'
import { HEADER_TENANT, slugDaRequisicao } from '../_shared/requisicao.ts'

const ESCOPO = 'https://www.googleapis.com/auth/calendar.readonly'
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke'
const CALENDAR = 'https://www.googleapis.com/calendar/v3'

/** Nomes das cores de evento como aparecem no Google Agenda em português. */
const NOME_COR: Record<string, string> = {
  '1': 'Lavanda',
  '2': 'Sálvia',
  '3': 'Uva',
  '4': 'Flamingo',
  '5': 'Banana',
  '6': 'Tangerina',
  '7': 'Pavão',
  '8': 'Grafite',
  '9': 'Mirtilo',
  '10': 'Manjericão',
  '11': 'Tomate',
}

const LIMITE_EXEMPLOS = 5
/** Teto de segurança do diagnóstico: páginas de 250 eventos. */
const MAX_PAGINAS = 40

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
const segredoEstado = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET') ?? ''
const origensPermitidas = (Deno.env.get('CRM_URLS_PERMITIDAS') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean)

/** Precisa ser idêntica à cadastrada no Google Cloud (configurável para o domínio futuro). */
const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') ?? `${url}/functions/v1/agenda-google/callback`

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

function json(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const erro = (status: number, codigo: string, mensagem: string) =>
  json(status, { ok: false, codigo, mensagem })

function redirecionar(destino: string) {
  return new Response(null, { status: 302, headers: { Location: destino } })
}

/** Volta ao CRM com o resultado na query (?google=conectado|erro&motivo=…). */
function voltar(retorno: string, parametros: Record<string, string>) {
  const destino = new URL(retorno)
  for (const [k, v] of Object.entries(parametros)) destino.searchParams.set(k, v)
  return redirecionar(destino.toString())
}

function origemPermitida(retorno: unknown): retorno is string {
  if (typeof retorno !== 'string') return false
  try {
    const u = new URL(retorno)
    return origensPermitidas.includes(u.origin)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

class ErroGoogle extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string,
  ) {
    super(mensagem)
  }
}

async function trocarCodigo(code: string) {
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const corpo = await r.json()
  if (!r.ok) throw new ErroGoogle(`Troca do código recusada: ${corpo.error ?? r.status}`, 'troca_codigo')
  return corpo as { access_token: string; refresh_token?: string; scope: string }
}

async function renovarAcesso(refreshToken: string): Promise<string> {
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const corpo = await r.json()
  if (!r.ok) {
    // invalid_grant: token revogado, senha trocada ou app em modo Teste (7 dias).
    const codigo = corpo.error === 'invalid_grant' ? 'reconectar' : 'token'
    throw new ErroGoogle(`Renovação do acesso recusada: ${corpo.error ?? r.status}`, codigo)
  }
  return corpo.access_token as string
}

async function google<T>(token: string, caminho: string, params: Record<string, string> = {}): Promise<T> {
  const destino = new URL(`${CALENDAR}${caminho}`)
  for (const [k, v] of Object.entries(params)) destino.searchParams.set(k, v)
  const r = await fetch(destino, { headers: { Authorization: `Bearer ${token}` } })
  const corpo = await r.json()
  if (!r.ok) {
    throw new ErroGoogle(`Google Calendar respondeu ${r.status}: ${corpo.error?.message ?? ''}`, 'api')
  }
  return corpo as T
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

type Contexto = { usuarioId: string; tenantId: string }

async function iniciar(ctx: Contexto, retorno: unknown) {
  if (!clientId || !clientSecret || segredoEstado.length < 32) {
    return erro(500, 'configuracao', 'Integração Google não configurada (secrets ausentes).')
  }
  if (!origemPermitida(retorno)) {
    return erro(400, 'retorno_invalido', 'Endereço de retorno não permitido.')
  }

  // Estado gravado com a empresa e o gerente (uso único, 10 min; o banco
  // confere de novo que ele é gerente da empresa).
  const { data: nonce, error } = await admin.rpc('agenda_google_criar_estado', {
    p_tenant: ctx.tenantId,
    p_usuario: ctx.usuarioId,
    p_retorno: retorno,
  })
  if (error || typeof nonce !== 'string') return erro(500, 'estado', 'Não foi possível iniciar a conexão.')

  const { data: config } = await admin
    .from('tenant_configuracoes')
    .select('google_conta_permitida')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  const contaPermitida = config?.google_conta_permitida ?? null

  const state = await assinarEstado(segredoEstado, { n: nonce, t: ctx.tenantId })

  const destino = new URL(GOOGLE_AUTH)
  destino.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPO,
    // offline + consent: garante o refresh token mesmo em reconexões.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    ...(contaPermitida ? { login_hint: contaPermitida } : {}),
    state,
  }).toString()

  return json(200, { ok: true, url: destino.toString() })
}

type Estado = { tenant_id: string; usuario_id: string; retorno: string; expirado: boolean }

async function callback(req: Request) {
  const params = new URL(req.url).searchParams
  const invalido = () =>
    new Response('Link de conexão inválido ou já usado. Volte ao CRM e tente de novo.', { status: 400 })

  // 1. Assinatura: state forjado ou alterado nem chega ao banco.
  const assinado = segredoEstado.length >= 32 ? await verificarEstado(segredoEstado, params.get('state') ?? '') : null
  if (!assinado) return invalido()

  // 2. Uso único: a linha deixa de existir nesta leitura.
  const { data: estados } = await admin.rpc('agenda_google_consumir_estado', { p_nonce: assinado.n })
  const estado = (estados as Estado[] | null)?.[0]
  // 3. A empresa vem do estado gravado e precisa bater com a assinada.
  if (!estado || estado.tenant_id !== assinado.t) return invalido()
  if (estado.expirado) return voltar(estado.retorno, { google: 'erro', motivo: 'expirado' })

  const negado = params.get('error')
  if (negado) return voltar(estado.retorno, { google: 'erro', motivo: negado === 'access_denied' ? 'negado' : 'google' })

  const code = params.get('code')
  if (!code) return voltar(estado.retorno, { google: 'erro', motivo: 'google' })

  try {
    const tokens = await trocarCodigo(code)
    const escopos = tokens.scope.split(' ')
    if (!escopos.includes(ESCOPO)) return voltar(estado.retorno, { google: 'erro', motivo: 'escopo' })
    if (!tokens.refresh_token) return voltar(estado.retorno, { google: 'erro', motivo: 'sem_refresh' })

    // A agenda principal tem como id o e-mail da conta.
    const primaria = await google<{ id: string }>(tokens.access_token, '/calendars/primary')
    const email = primaria.id.toLowerCase()

    // Grava só na empresa do estado; o banco recusa conta não permitida
    // para a empresa e quem não for mais gerente dela.
    const { error } = await admin.rpc('agenda_google_salvar_conexao', {
      p_tenant: estado.tenant_id,
      p_conta_email: email,
      p_calendar_id: primaria.id,
      p_escopos: escopos,
      p_refresh_token: tokens.refresh_token,
      p_usuario_id: estado.usuario_id,
    })
    if (error) {
      await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(tokens.refresh_token)}`, { method: 'POST' }).catch(() => {})
      if (error.code === '42501') return voltar(estado.retorno, { google: 'erro', motivo: 'conta' })
      if (error.code === 'RX002' || error.code === 'RX003') return voltar(estado.retorno, { google: 'erro', motivo: 'plano' })
      throw new Error(`Falha ao gravar a conexão: ${error.code}`)
    }

    return voltar(estado.retorno, { google: 'conectado' })
  } catch (e) {
    console.error('agenda-google callback', e)
    return voltar(estado.retorno, { google: 'erro', motivo: 'google' })
  }
}

type Credencial = { conta_email: string; calendar_id: string; refresh_token: string }

async function credencial(tenantId: string): Promise<Credencial | null> {
  const { data, error } = await admin.rpc('agenda_google_obter_credencial', { p_tenant: tenantId })
  if (error) throw new Error(`Falha ao ler a credencial: ${error.message}`)
  return (data as Credencial[])[0] ?? null
}

type EventoGoogle = {
  summary?: string
  colorId?: string
  status?: string
  eventType?: string
  start?: { date?: string; dateTime?: string }
}

type GrupoCor = {
  colorId: string | null
  nome: string
  hex: string | null
  eventos: number
  diaInteiro: number
  primeiro: string | null
  ultimo: string | null
  exemplos: string[]
}

function inteiroEntre(v: unknown, min: number, max: number, padrao: number) {
  const n = typeof v === 'number' ? Math.trunc(v) : padrao
  return Math.min(Math.max(n, min), max)
}

async function diagnostico(ctx: Contexto, corpo: Record<string, unknown>) {
  const cred = await credencial(ctx.tenantId)
  if (!cred) return erro(409, 'desconectado', 'Nenhuma conta Google conectada.')

  const diasPassado = inteiroEntre(corpo.dias_passado, 0, 365, 90)
  const diasFuturo = inteiroEntre(corpo.dias_futuro, 0, 365, 90)
  const agora = Date.now()
  const timeMin = new Date(agora - diasPassado * 86_400_000).toISOString()
  const timeMax = new Date(agora + diasFuturo * 86_400_000).toISOString()

  try {
    const token = await renovarAcesso(cred.refresh_token)

    const [paleta, agenda] = await Promise.all([
      google<{ event: Record<string, { background: string }> }>(token, '/colors'),
      google<{ backgroundColor?: string }>(token, `/users/me/calendarList/${encodeURIComponent(cred.calendar_id)}`),
    ])

    const grupos = new Map<string, GrupoCor>()
    const ignoradosPorTipo: Record<string, number> = {}
    let total = 0
    let paginaToken: string | undefined
    let paginas = 0

    do {
      const pagina = await google<{ items?: EventoGoogle[]; nextPageToken?: string }>(
        token,
        `/calendars/${encodeURIComponent(cred.calendar_id)}/events`,
        {
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          fields: 'items(summary,colorId,status,eventType,start),nextPageToken',
          ...(paginaToken ? { pageToken: paginaToken } : {}),
        },
      )

      for (const ev of pagina.items ?? []) {
        if (ev.status === 'cancelled') continue
        // Ausência, foco, local de trabalho etc. não são compromissos.
        if (ev.eventType && ev.eventType !== 'default') {
          ignoradosPorTipo[ev.eventType] = (ignoradosPorTipo[ev.eventType] ?? 0) + 1
          continue
        }

        total++
        const chave = ev.colorId ?? 'padrao'
        const grupo =
          grupos.get(chave) ??
          ({
            colorId: ev.colorId ?? null,
            nome: ev.colorId ? (NOME_COR[ev.colorId] ?? `Cor ${ev.colorId}`) : 'Cor padrão da agenda',
            hex: ev.colorId ? (paleta.event[ev.colorId]?.background ?? null) : (agenda.backgroundColor ?? null),
            eventos: 0,
            diaInteiro: 0,
            primeiro: null,
            ultimo: null,
            exemplos: [],
          } satisfies GrupoCor)

        const inicio = ev.start?.dateTime ?? ev.start?.date ?? null
        grupo.eventos++
        if (ev.start?.date && !ev.start.dateTime) grupo.diaInteiro++
        if (inicio && (!grupo.primeiro || inicio < grupo.primeiro)) grupo.primeiro = inicio
        if (inicio && (!grupo.ultimo || inicio > grupo.ultimo)) grupo.ultimo = inicio
        const titulo = ev.summary?.trim()
        if (titulo && grupo.exemplos.length < LIMITE_EXEMPLOS && !grupo.exemplos.includes(titulo)) {
          grupo.exemplos.push(titulo)
        }
        grupos.set(chave, grupo)
      }

      paginaToken = pagina.nextPageToken
      paginas++
    } while (paginaToken && paginas < MAX_PAGINAS)

    return json(200, {
      ok: true,
      conta: cred.conta_email,
      periodo: { inicio: timeMin, fim: timeMax, diasPassado, diasFuturo },
      total,
      truncado: Boolean(paginaToken),
      ignoradosPorTipo,
      cores: [...grupos.values()].sort((a, b) => b.eventos - a.eventos),
    })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e)
    await admin.rpc('agenda_google_registrar_erro', { p_tenant: ctx.tenantId, p_erro: mensagem })
    if (e instanceof ErroGoogle && e.codigo === 'reconectar') {
      return erro(409, 'reconectar', 'O Google recusou o acesso salvo. Conecte a conta de novo.')
    }
    console.error('agenda-google diagnostico', e)
    return erro(502, 'google', 'Não foi possível ler o Google Calendar agora.')
  }
}

/** Revoga e apaga só a conexão desta empresa. */
async function desconectar(ctx: Contexto) {
  const cred = await credencial(ctx.tenantId)
  if (cred) {
    // Revoga no Google; se falhar (já revogado), segue removendo do CRM.
    await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(cred.refresh_token)}`, { method: 'POST' }).catch(() => {})
  }
  const { error } = await admin.rpc('agenda_google_remover_conexao', { p_tenant: ctx.tenantId })
  if (error) return erro(500, 'remover', 'Não foi possível remover a conexão.')
  return json(200, { ok: true })
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Mesma regra da RLS: o JWT de quem chama + a empresa da aba passam por
 * `tenant_atual()` e `is_gerente()` no banco.
 */
async function exigirGerente(req: Request): Promise<Contexto | Response> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) return erro(401, 'nao_autenticado', 'Sessão ausente.')

  const slug = slugDaRequisicao(req.headers)
  if (!slug) return erro(403, 'sem_empresa', 'Empresa não informada.')

  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization, [HEADER_TENANT]: slug } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: usuario } = await comoUsuario.auth.getUser()
  if (!usuario?.user) return erro(401, 'nao_autenticado', 'Sessão inválida.')

  const [{ data: tenantId }, { data: gerente, error }] = await Promise.all([
    comoUsuario.rpc('tenant_atual'),
    comoUsuario.rpc('is_gerente'),
  ])
  if (!tenantId) return erro(403, 'sem_empresa', 'Empresa não informada ou sem acesso.')
  if (error || gerente !== true) return erro(403, 'sem_permissao', 'Somente gerentes gerenciam a agenda Google.')

  return { usuarioId: usuario.user.id, tenantId: tenantId as string }
}

Deno.serve(async (req) => {
  const caminho = new URL(req.url).pathname

  if (req.method === 'GET' && caminho.endsWith('/callback')) return callback(req)
  if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')

  const ctx = await exigirGerente(req)
  if (ctx instanceof Response) return ctx

  let corpo: Record<string, unknown>
  try {
    corpo = (await req.json()) as Record<string, unknown>
  } catch {
    return erro(400, 'pedido_invalido', 'Dados inválidos.')
  }

  try {
    switch (corpo.acao) {
      case 'iniciar':
        return await iniciar(ctx, corpo.retorno)
      case 'diagnostico':
        return await diagnostico(ctx, corpo)
      case 'desconectar':
        return await desconectar(ctx)
      default:
        return erro(400, 'pedido_invalido', 'Ação desconhecida.')
    }
  } catch (e) {
    console.error('agenda-google', e)
    return erro(500, 'interno', 'Erro inesperado na integração Google.')
  }
})
