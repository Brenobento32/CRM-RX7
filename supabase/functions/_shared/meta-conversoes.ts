/**
 * Meta Ads — Conversões do CRM (Conversions API for CRM / Conversion Leads).
 * Peças puras (Web Crypto + fetch injetado): rodam no Deno e no Node.
 *
 * Payload exigido pela Meta para Conversion Leads:
 *   event_name (etapa do CRM), event_time (unix, até 7 dias), action_source =
 *   'system_generated', user_data.lead_id (ID do lead dos Lead Ads, 15–17
 *   dígitos), custom_data.event_source = 'crm', custom_data.lead_event_source
 *   = nome do CRM. event_id para o AVANTE não repetir o mesmo evento.
 *
 * Autorização por empresa: Meta Business Extension (MBE, canal
 * CONVERSIONS_API) — o Administrador autoriza na janela da Meta, o servidor
 * troca o code por um token de usuário do sistema da empresa. Exige a
 * permissão privada `manage_business_extension` liberada pela Meta.
 */

export type Busca = (entrada: string, init?: RequestInit) => Promise<Response>

export const LEAD_EVENT_SOURCE = 'AVANTE CRM'

export type EventoFila = {
  evento_id: number
  conexao_id: string
  dataset_id: string
  codigo_teste: string | null
  evento: string
  event_id: string
  event_time_unix: number
  lead_id: string | null
  valor: number | string | null
  moeda: string | null
  email: string | null
  telefone: string | null
}

const codificador = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', codificador.encode(texto)))
}

async function hmacHex(chave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', codificador.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, codificador.encode(texto)))
}

/** appsecret_proof da Graph API (HMAC-SHA256 do token com o App Secret). */
export const provaDoApp = (token: string, appSecret: string) => hmacHex(appSecret, token)

/** ID externo estável e opaco da empresa na Meta (não revela o tenant_id). */
export async function idExternoDaEmpresa(segredo: string, tenantId: string): Promise<string> {
  return `avante-${(await hmacHex(segredo, `capi:${tenantId}`)).slice(0, 32)}`
}

/** Normalização da Meta antes do hash: e-mail minúsculo sem espaços; telefone só dígitos com DDI. */
export const normalizarEmailMeta = (e: string) => e.trim().toLowerCase()
export function normalizarTelefoneMeta(t: string): string | null {
  const d = t.replace(/[^0-9]/g, '')
  if (d.length < 10) return null
  return d.length <= 11 ? `55${d}` : d
}

/**
 * Corpo JSON de UM evento. O lead_id vai como NÚMERO (formato do exemplo da
 * Meta) sem passar por Number(): 16–17 dígitos perderiam precisão em JS.
 */
export async function corpoDoEvento(ev: EventoFila): Promise<string> {
  if (!ev.lead_id || !/^[0-9]{15,17}$/.test(ev.lead_id)) throw new Error('Evento sem ID de lead da Meta válido.')
  const user_data: Record<string, unknown> = { lead_id: '__LEAD_ID__' }
  if (ev.email) user_data.em = [await sha256Hex(normalizarEmailMeta(ev.email))]
  const tel = ev.telefone ? normalizarTelefoneMeta(ev.telefone) : null
  if (tel) user_data.ph = [await sha256Hex(tel)]
  const custom_data: Record<string, unknown> = { event_source: 'crm', lead_event_source: LEAD_EVENT_SOURCE }
  const valor = ev.valor === null || ev.valor === undefined ? null : Number(ev.valor)
  if (valor !== null && Number.isFinite(valor) && valor > 0) {
    custom_data.value = Math.round(valor * 100) / 100
    custom_data.currency = ev.moeda ?? 'BRL'
  }
  const corpo = {
    data: [
      {
        event_name: ev.evento,
        event_time: Number(ev.event_time_unix),
        event_id: ev.event_id,
        action_source: 'system_generated',
        user_data,
        custom_data,
      },
    ],
    ...(ev.codigo_teste ? { test_event_code: ev.codigo_teste } : {}),
  }
  return JSON.stringify(corpo).replace('"__LEAD_ID__"', ev.lead_id)
}

export type ResultadoEnvio = { resultado: 'ok' | 'temporario' | 'permanente' | 'autorizacao' | 'limite'; erro: string | null; fbtrace: string | null }

/** Erro da Graph → o que fazer: tentar de novo, desistir, reconectar ou esperar o limite. */
export function classificarErro(status: number, corpo: Record<string, unknown>): ResultadoEnvio {
  const e = (corpo.error ?? {}) as { code?: number; error_subcode?: number; message?: string; fbtrace_id?: string }
  const msg = `${e.code ?? status}${e.error_subcode ? `/${e.error_subcode}` : ''} ${String(e.message ?? 'Erro da Meta')}`.slice(0, 300)
  const fbtrace = typeof e.fbtrace_id === 'string' ? e.fbtrace_id : null
  if (e.code === 190 || e.code === 102 || status === 401) return { resultado: 'autorizacao', erro: msg, fbtrace }
  if (status === 429 || [4, 17, 32, 613, 80004].includes(Number(e.code))) return { resultado: 'limite', erro: msg, fbtrace }
  if (status >= 500 || e.code === 1 || e.code === 2) return { resultado: 'temporario', erro: msg, fbtrace }
  return { resultado: 'permanente', erro: msg, fbtrace }
}

export async function enviarEvento(buscar: Busca, graphUrl: string, token: string, appSecret: string, ev: EventoFila): Promise<ResultadoEnvio> {
  let r: Response
  try {
    const prova = await provaDoApp(token, appSecret)
    r = await buscar(`${graphUrl}/${encodeURIComponent(ev.dataset_id)}/events?appsecret_proof=${prova}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: await corpoDoEvento(ev),
    })
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Evento sem ID')) return { resultado: 'permanente', erro: e.message, fbtrace: null }
    return { resultado: 'temporario', erro: 'Não foi possível falar com a Meta.', fbtrace: null }
  }
  let corpo: Record<string, unknown> = {}
  try {
    corpo = (await r.json()) as Record<string, unknown>
  } catch {
    corpo = {}
  }
  if (r.ok && Number(corpo.events_received) >= 1) {
    return { resultado: 'ok', erro: null, fbtrace: typeof corpo.fbtrace_id === 'string' ? corpo.fbtrace_id : null }
  }
  if (r.ok) return { resultado: 'temporario', erro: 'A Meta não confirmou o recebimento do evento.', fbtrace: null }
  return classificarErro(r.status, corpo)
}

// ------------------------------------------------------------------ autorização (MBE)
async function graphJson(buscar: Busca, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await buscar(url, init)
  let c: Record<string, unknown> = {}
  try {
    c = (await r.json()) as Record<string, unknown>
  } catch {
    c = {}
  }
  if (!r.ok) {
    const e = (c.error ?? {}) as { message?: string }
    throw new Error(String(e.message ?? `A Meta respondeu ${r.status}.`).slice(0, 300))
  }
  return c
}

/** Depois da janela da Meta: dados da instalação desta empresa (negócio e dataset autorizados). */
export async function lerInstalacao(buscar: Busca, graphUrl: string, token: string, idExterno: string): Promise<{ businessId: string; datasetId: string }> {
  const c = await graphJson(buscar, `${graphUrl}/fbe_business/fbe_installs?fbe_external_business_id=${encodeURIComponent(idExterno)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const i = ((c.data as Record<string, unknown>[] | undefined) ?? [])[0] ?? {}
  const businessId = String(i.business_manager_id ?? '')
  const datasetId = String(i.pixel_id ?? '')
  if (!/^[0-9]{5,30}$/.test(businessId) || !/^[0-9]{5,30}$/.test(datasetId)) {
    throw new Error('A Meta não devolveu o negócio e o conjunto de dados autorizados.')
  }
  return { businessId, datasetId }
}

/** Token de usuário do sistema do negócio da empresa (o que fica no cofre). */
export async function tokenDeSistema(
  buscar: Busca,
  graphUrl: string,
  tokenUsuario: string,
  appSecret: string,
  businessId: string,
  idExterno: string,
): Promise<string> {
  const prova = await provaDoApp(tokenUsuario, appSecret)
  const c = await graphJson(
    buscar,
    `${graphUrl}/${encodeURIComponent(businessId)}/system_user_access_tokens?fbe_external_business_id=${encodeURIComponent(idExterno)}&appsecret_proof=${prova}`,
    { method: 'POST', headers: { Authorization: `Bearer ${tokenUsuario}` } },
  )
  if (typeof c.access_token !== 'string' || c.access_token.length < 20) throw new Error('A Meta não devolveu o token do sistema.')
  return c.access_token
}

export async function nomeDoDataset(buscar: Busca, graphUrl: string, token: string, datasetId: string): Promise<string | null> {
  try {
    const c = await graphJson(buscar, `${graphUrl}/${encodeURIComponent(datasetId)}?fields=name`, { headers: { Authorization: `Bearer ${token}` } })
    return typeof c.name === 'string' ? c.name.slice(0, 200) : null
  } catch {
    return null
  }
}
