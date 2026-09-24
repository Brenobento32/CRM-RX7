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
 * Secrets (npx supabase secrets set …):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_CONTA_PERMITIDA   e-mail da única conta aceita na conexão
 *   CRM_URLS_PERMITIDAS      origens do CRM para onde o /callback pode voltar,
 *                            separadas por vírgula (ex.: http://localhost:3000,https://crm…)
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

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
const contaPermitida = (Deno.env.get('GOOGLE_CONTA_PERMITIDA') ?? '').trim().toLowerCase()
const origensPermitidas = (Deno.env.get('CRM_URLS_PERMITIDAS') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean)

/** Precisa ser idêntica à cadastrada no Google Cloud. */
const redirectUri = `${url}/functions/v1/agenda-google/callback`

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

async function iniciar(usuarioId: string, retorno: unknown) {
  if (!clientId || !clientSecret || !contaPermitida) {
    return erro(500, 'configuracao', 'Integração Google não configurada (secrets ausentes).')
  }
  if (!origemPermitida(retorno)) {
    return erro(400, 'retorno_invalido', 'Endereço de retorno não permitido.')
  }

  const nonce = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
  const { error } = await admin
    .from('agenda_google_oauth_estados')
    .insert({ nonce, usuario_id: usuarioId, retorno })
  if (error) return erro(500, 'estado', 'Não foi possível iniciar a conexão.')

  // Limpeza oportunista de estados vencidos.
  await admin.from('agenda_google_oauth_estados').delete().lt('expira_em', new Date().toISOString())

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
    login_hint: contaPermitida,
    state: nonce,
  }).toString()

  return json(200, { ok: true, url: destino.toString() })
}

async function callback(req: Request) {
  const params = new URL(req.url).searchParams
  const nonce = params.get('state') ?? ''

  // Uso único: o DELETE devolve a linha e ela deixa de existir.
  const { data: estados } = await admin
    .from('agenda_google_oauth_estados')
    .delete()
    .eq('nonce', nonce)
    .select('usuario_id, retorno, expira_em')

  const estado = estados?.[0]
  if (!estado) return new Response('Link de conexão inválido ou já usado. Volte ao CRM e tente de novo.', { status: 400 })
  if (new Date(estado.expira_em) < new Date()) {
    return voltar(estado.retorno, { google: 'erro', motivo: 'expirado' })
  }

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

    if (email !== contaPermitida) {
      await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(tokens.refresh_token)}`, { method: 'POST' })
      return voltar(estado.retorno, { google: 'erro', motivo: 'conta', conta: email })
    }

    const { error } = await admin.rpc('agenda_google_salvar_conexao', {
      p_conta_email: email,
      p_calendar_id: primaria.id,
      p_escopos: escopos,
      p_refresh_token: tokens.refresh_token,
      p_usuario_id: estado.usuario_id,
    })
    if (error) throw new Error(`Falha ao gravar a conexão: ${error.message}`)

    return voltar(estado.retorno, { google: 'conectado' })
  } catch (e) {
    console.error('agenda-google callback', e)
    return voltar(estado.retorno, { google: 'erro', motivo: 'google' })
  }
}

type Credencial = { conta_email: string; calendar_id: string; refresh_token: string }

async function credencial(): Promise<Credencial | null> {
  const { data, error } = await admin.rpc('agenda_google_obter_credencial')
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

async function diagnostico(corpo: Record<string, unknown>) {
  const cred = await credencial()
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
    await admin.rpc('agenda_google_registrar_erro', { p_erro: mensagem })
    if (e instanceof ErroGoogle && e.codigo === 'reconectar') {
      return erro(409, 'reconectar', 'O Google recusou o acesso salvo. Conecte a conta de novo.')
    }
    console.error('agenda-google diagnostico', e)
    return erro(502, 'google', 'Não foi possível ler o Google Calendar agora.')
  }
}

async function desconectar() {
  const cred = await credencial()
  if (cred) {
    // Revoga no Google; se falhar (já revogado), segue removendo do CRM.
    await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(cred.refresh_token)}`, { method: 'POST' }).catch(() => {})
  }
  const { error } = await admin.rpc('agenda_google_remover_conexao')
  if (error) return erro(500, 'remover', 'Não foi possível remover a conexão.')
  return json(200, { ok: true })
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Mesma regra da RLS: o JWT de quem chama passa por `is_gerente()`. */
async function exigirGerente(req: Request): Promise<string | Response> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) return erro(401, 'nao_autenticado', 'Sessão ausente.')

  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: usuario } = await comoUsuario.auth.getUser()
  if (!usuario?.user) return erro(401, 'nao_autenticado', 'Sessão inválida.')

  const { data: gerente, error } = await comoUsuario.rpc('is_gerente')
  if (error || gerente !== true) return erro(403, 'sem_permissao', 'Somente gerentes gerenciam a agenda Google.')

  return usuario.user.id
}

Deno.serve(async (req) => {
  const caminho = new URL(req.url).pathname

  if (req.method === 'GET' && caminho.endsWith('/callback')) return callback(req)
  if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')

  const gerente = await exigirGerente(req)
  if (gerente instanceof Response) return gerente

  let corpo: Record<string, unknown>
  try {
    corpo = (await req.json()) as Record<string, unknown>
  } catch {
    return erro(400, 'pedido_invalido', 'Dados inválidos.')
  }

  try {
    switch (corpo.acao) {
      case 'iniciar':
        return await iniciar(gerente, corpo.retorno)
      case 'diagnostico':
        return await diagnostico(corpo)
      case 'desconectar':
        return await desconectar()
      default:
        return erro(400, 'pedido_invalido', 'Ação desconhecida.')
    }
  } catch (e) {
    console.error('agenda-google', e)
    return erro(500, 'interno', 'Erro inesperado na integração Google.')
  }
})
