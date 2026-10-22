/**
 * Validação do lead recebido pelo webhook genérico por empresa
 * (`ingestao-lead-empresa`). Só formato: a regra de negócio (dedup,
 * formulário/nicho, empresa) é do banco. Puro: Deno e Node (testes).
 */

export type Resposta = { pergunta_externa: string; resposta: string }

export type LeadEmpresa = {
  external_id: string
  formulario_slug: string | null
  nicho_slug: string | null
  nome: string
  telefone: string | null
  email: string | null
  empresa: string | null
  instagram: string | null
  respostas: Resposta[]
  atribuicao: Record<string, string> | null
}

const CHAVES_ATRIBUICAO = [
  'source', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid',
  'pontuacao', 'data_formulario', 'form_id', 'form_name',
] as const

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function texto(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null
}

/** null = ausente; undefined = presente mas inválido. */
function slug(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  return typeof v === 'string' && SLUG.test(v) ? v : undefined
}

/** Lead válido ou o primeiro problema (a mensagem nunca traz dado do lead). */
export function validarLead(corpo: unknown): { ok: true; lead: LeadEmpresa } | { ok: false; mensagem: string } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, mensagem: 'Payload inválido.' }
  const o = corpo as Record<string, unknown>
  // A empresa vem da credencial; nunca do corpo.
  if ('tenant_id' in o || 'empresa_id' in o || 'tenant' in o) {
    return { ok: false, mensagem: 'A empresa é definida pela credencial, não pelo corpo.' }
  }

  const externalId = texto(o.external_id, 200)
  if (!externalId) return { ok: false, mensagem: 'external_id é obrigatório.' }

  const formularioSlug = slug(o.formulario_slug)
  const nichoSlug = slug(o.nicho_slug)
  if (formularioSlug === undefined || nichoSlug === undefined) return { ok: false, mensagem: 'Slug inválido.' }

  const dados = o.dados && typeof o.dados === 'object' ? (o.dados as Record<string, unknown>) : {}
  const nome = texto(dados.nome, 200)
  if (!nome) return { ok: false, mensagem: 'dados.nome é obrigatório.' }

  const telefone = texto(dados.telefone, 40)?.replace(/\D/g, '') || null
  if (telefone && !/^\d{10,13}$/.test(telefone)) return { ok: false, mensagem: 'Telefone inválido.' }
  const email = texto(dados.email, 200)?.toLowerCase() ?? null
  if (email && !EMAIL.test(email)) return { ok: false, mensagem: 'E-mail inválido.' }
  if (!telefone && !email) return { ok: false, mensagem: 'Informe telefone ou e-mail.' }

  const respostas: Resposta[] = (Array.isArray(o.respostas) ? o.respostas : []).slice(0, 100).flatMap((r) => {
    if (!r || typeof r !== 'object') return []
    const item = r as Record<string, unknown>
    const pergunta = texto(item.pergunta_externa)
    const resposta = texto(item.resposta, 5000)
    return pergunta && resposta ? [{ pergunta_externa: pergunta, resposta }] : []
  })

  let atribuicao: Record<string, string> | null = null
  if (o.atribuicao && typeof o.atribuicao === 'object') {
    const a = o.atribuicao as Record<string, unknown>
    const filtrada: Record<string, string> = {}
    for (const k of CHAVES_ATRIBUICAO) {
      const v = texto(a[k])
      if (v) filtrada[k] = v
    }
    atribuicao = Object.keys(filtrada).length > 0 ? filtrada : null
  }

  return {
    ok: true,
    lead: {
      external_id: externalId,
      formulario_slug: formularioSlug,
      nicho_slug: nichoSlug,
      nome,
      telefone,
      email,
      empresa: texto(dados.empresa, 200),
      instagram: texto(dados.instagram, 200),
      respostas,
      atribuicao,
    },
  }
}
