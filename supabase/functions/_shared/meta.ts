/**
 * Webhooks da Meta (Facebook Lead Ads e WhatsApp Cloud API).
 * Puro (Web Crypto): Deno (Edge Function) e Node (testes).
 *
 * Segurança: o corpo só é aceito com `X-Hub-Signature-256` válido (HMAC-SHA256
 * do corpo CRU com o App Secret do app da Meta). A empresa nunca vem do
 * corpo: page_id / phone_number_id (assinados pela Meta) apontam para uma
 * fonte da empresa já VALIDADA com o token dela.
 */

const codificador = new TextEncoder()

function hexParaBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** `sha256=<hex>` confere com o corpo cru? (comparação em tempo constante pelo Web Crypto) */
export async function assinaturaMetaValida(appSecret: string, corpoCru: string, cabecalho: string | null): Promise<boolean> {
  if (!appSecret || !cabecalho?.startsWith('sha256=')) return false
  const esperado = hexParaBytes(cabecalho.slice(7))
  if (!esperado) return false
  const chave = await crypto.subtle.importKey('raw', codificador.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
  return crypto.subtle.verify('HMAC', chave, esperado, codificador.encode(corpoCru))
}

/** Desafio GET da Meta: devolve o challenge só com o verify token certo. */
export function respostaVerificacao(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null
  if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== verifyToken) return null
  const desafio = params.get('hub.challenge')
  return desafio && /^[A-Za-z0-9_-]{1,200}$/.test(desafio) ? desafio : null
}

export type EventoLeadgen = { leadgenId: string; pageId: string; formId: string | null }
export type ContatoWhatsapp = { phoneNumberId: string; waId: string; nome: string | null; mensagemId: string | null }

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const id = (v: unknown): string | null =>
  (typeof v === 'string' || typeof v === 'number') && /^[0-9]{1,30}$/.test(String(v)) ? String(v) : null

/** Lead Ads: entry[].changes[] com field = leadgen. */
export function extrairLeadgen(corpo: unknown): EventoLeadgen[] {
  const raiz = obj(corpo)
  if (raiz?.object !== 'page') return []
  return lista(raiz.entry).flatMap((e) =>
    lista(obj(e)?.changes).flatMap((c) => {
      const mudanca = obj(c)
      const valor = obj(mudanca?.value)
      if (mudanca?.field !== 'leadgen' || !valor) return []
      const leadgenId = id(valor.leadgen_id)
      const pageId = id(valor.page_id)
      return leadgenId && pageId ? [{ leadgenId, pageId, formId: id(valor.form_id) }] : []
    }),
  )
}

/** WhatsApp: contatos que escreveram (status de entrega são ignorados). */
export function extrairContatosWhatsapp(corpo: unknown): ContatoWhatsapp[] {
  const raiz = obj(corpo)
  if (raiz?.object !== 'whatsapp_business_account') return []
  return lista(raiz.entry).flatMap((e) =>
    lista(obj(e)?.changes).flatMap((c) => {
      const mudanca = obj(c)
      const valor = obj(mudanca?.value)
      const phoneNumberId = id(obj(valor?.metadata)?.phone_number_id)
      if (mudanca?.field !== 'messages' || !valor || !phoneNumberId) return []
      const mensagens = lista(valor.messages).map(obj).filter((m): m is Obj => m !== null)
      return lista(valor.contacts).flatMap((ct) => {
        const contato = obj(ct)
        const waId = id(contato?.wa_id)
        if (!waId) return []
        const mensagem = mensagens.find((m) => id(m.from) === waId)
        if (!mensagem) return [] // só cria lead quando o contato mandou mensagem
        const nome = typeof obj(contato?.profile)?.name === 'string' ? (obj(contato?.profile)?.name as string) : null
        return [{ phoneNumberId, waId, nome, mensagemId: typeof mensagem.id === 'string' ? mensagem.id : null }]
      })
    }),
  )
}

export type DadosLead = { nome: string | null; telefone: string | null; email: string | null; empresa: string | null }

/** field_data do lead (Graph API) → dados do cliente. */
export function mapearCamposLeadMeta(fieldData: unknown): DadosLead {
  const valores = new Map<string, string>()
  for (const item of lista(fieldData)) {
    const o = obj(item)
    const nome = typeof o?.name === 'string' ? o.name.toLowerCase() : null
    const valor = lista(o?.values).find((v) => typeof v === 'string') as string | undefined
    if (nome && valor) valores.set(nome, valor.trim())
  }
  const primeiro = (...chaves: string[]) => chaves.map((k) => valores.get(k)).find(Boolean) ?? null
  const nomeCompleto =
    primeiro('full_name', 'nome_completo', 'nome') ??
    ([primeiro('first_name'), primeiro('last_name')].filter(Boolean).join(' ') || null)
  return {
    nome: nomeCompleto,
    telefone: primeiro('phone_number', 'telefone', 'whatsapp', 'celular'),
    email: primeiro('email', 'e-mail'),
    empresa: primeiro('company_name', 'empresa'),
  }
}
