/**
 * Payload do Respondi DA PRÓPRIA EMPRESA → lead. Puro: Deno e Node (testes).
 *
 * Cada empresa pode informar, na fonte, o título exato de cada pergunta
 * (`campos.nome`, `campos.telefone`, `campos.email`, `campos.empresa`); sem
 * isso, usa títulos comuns ("nome", "whatsapp", "e-mail"...). As demais
 * perguntas viram respostas do lead (gravadas se o formulário da fonte tiver
 * a pergunta cadastrada).
 */

export type CamposRespondi = Partial<Record<'nome' | 'telefone' | 'email' | 'empresa', string>>

export type LeadRespondi = {
  external_id: string
  nome: string | null
  telefone: string | null
  email: string | null
  empresa: string | null
  respostas: { pergunta_externa: string; resposta: string }[]
  atribuicao: Record<string, string>
}

const PADRAO: Record<keyof CamposRespondi, RegExp> = {
  nome: /\bnome\b/i,
  telefone: /whats|telefone|celular|fone/i,
  email: /e-?mail/i,
  empresa: /empresa|institui/i,
}

const normalizar = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')

function texto(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

export function mapearRespondi(corpo: unknown, campos: CamposRespondi = {}): LeadRespondi | null {
  if (!corpo || typeof corpo !== 'object') return null
  const raiz = corpo as Record<string, unknown>
  const r = raiz.respondent && typeof raiz.respondent === 'object' ? (raiz.respondent as Record<string, unknown>) : null
  const externalId = texto(r?.respondent_id)
  if (!r || !externalId) return null

  const respostas = new Map<string, string>()
  if (r.answers && typeof r.answers === 'object') {
    for (const [pergunta, valor] of Object.entries(r.answers as Record<string, unknown>)) {
      const v = texto(valor)
      if (v) respostas.set(pergunta.trim(), v)
    }
  }

  const usadas = new Set<string>()
  const achar = (campo: keyof CamposRespondi): string | null => {
    const titulo = campos[campo]
    for (const [pergunta, valor] of respostas) {
      const bate = titulo ? normalizar(pergunta) === normalizar(titulo) : PADRAO[campo].test(pergunta)
      if (bate && !usadas.has(pergunta)) {
        usadas.add(pergunta)
        return valor
      }
    }
    return null
  }

  // E-mail antes de nome: "Digite seu e-mail" não pode virar nome.
  const email = achar('email')
  const telefone = achar('telefone')
  const empresa = achar('empresa')
  const nome = achar('nome')

  const form = raiz.form && typeof raiz.form === 'object' ? (raiz.form as Record<string, unknown>) : {}
  const atribuicao: Record<string, string> = { respondent_id: externalId }
  for (const [k, v] of Object.entries({ form_id: form.form_id, form_name: form.form_name, data_formulario: r.date })) {
    const t = texto(v)
    if (t) atribuicao[k] = t.slice(0, 300)
  }
  const utms = r.respondent_utms && typeof r.respondent_utms === 'object' ? (r.respondent_utms as Record<string, unknown>) : {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
    const t = texto(utms[k])
    if (t) atribuicao[k] = t.slice(0, 300)
  }

  return {
    external_id: externalId.slice(0, 200),
    nome,
    telefone,
    email,
    empresa,
    respostas: [...respostas]
      .filter(([p]) => !usadas.has(p))
      .slice(0, 100)
      .map(([pergunta_externa, resposta]) => ({ pergunta_externa, resposta: resposta.slice(0, 5000) })),
    atribuicao,
  }
}
