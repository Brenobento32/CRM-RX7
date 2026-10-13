/**
 * Edge Function `ingestao-lead` — entrada automática de lead.
 *
 * DOIS formatos de payload aceitos, cada um com secret próprio (nunca o
 * mesmo valor):
 *
 * 1. FORMATO INTERNO (legado) — Google Apps Script → Google Sheets. Mantido
 *    como fallback enquanto a integração direta do Respondi não estiver
 *    comprovada (ver apps-script/scorpion-crm-ingestao-leads) — não é mais
 *    o caminho principal de entrada, mas continua funcionando sem alteração.
 *    Autenticado por header `X-Webhook-Secret` == `INGESTAO_LEAD_SECRET`.
 *    Corpo:
 *      { external_id, formulario_slug, nicho_slug, dados, respostas?, atribuicao? }
 *
 * 2. FORMATO NATIVO DO RESPONDI — webhook direto do Respondi, sem Apps
 *    Script no meio (arquitetura atual: Respondi → esta função → CRM).
 *    Autenticado por header `X-Webhook-Secret` == `RESPONDI_WEBHOOK_SECRET`.
 *    Fallback (só se o Respondi não suportar header customizado — CONFIRME
 *    isso na tela de configuração do webhook do Respondi antes de usar):
 *    `?token=...` na query string, comparado com o mesmo `RESPONDI_WEBHOOK_SECRET`.
 *    Header é preferível — nunca aparece em log de acesso/URL; query string é
 *    a alternativa que o Apps Script já usava antes desta mudança, nunca uma
 *    invenção nova. Corpo (payload oficial do Respondi):
 *      {
 *        form: { form_id, form_name },
 *        respondent: {
 *          respondent_id, date, score, status,
 *          respondent_utms?: { utm_source?, utm_medium?, utm_campaign?, utm_term?, utm_content?, gclid?, fbclid? },
 *          answers: { [tituloDaPergunta]: resposta },
 *          raw_answers?: [...] // usado só como fallback quando `answers` não tiver a pergunta
 *        }
 *      }
 *
 * Os dois caminhos convergem no mesmo formato interno ({ external_id,
 * formulario_slug, nicho_slug, dados, respostas, atribuicao }) e chamam a
 * mesma `ingerir_lead_formulario` (upsert atômico, dedup por external_id) —
 * nenhuma lógica de criação de cliente/negociação é duplicada aqui.
 *
 * Deploy com --no-verify-jwt: nenhum dos dois caminhos tem JWT de usuário
 * logado do CRM — a autenticação real é o header/token comparado em tempo
 * constante contra o secret correspondente.
 *
 * Secrets (npx supabase secrets set …):
 *   INGESTAO_LEAD_SECRET      formato interno (legado, Apps Script/planilha)
 *   RESPONDI_WEBHOOK_SECRET   formato nativo do Respondi — NUNCA o mesmo valor do de cima
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const segredoLegado = Deno.env.get('INGESTAO_LEAD_SECRET') ?? ''
const segredoRespondi = Deno.env.get('RESPONDI_WEBHOOK_SECRET') ?? ''

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const erro = (status: number, codigo: string, mensagem: string) =>
  json(status, { ok: false, codigo, mensagem })

/** Comparação em tempo constante — nunca um `===` direto num secret. */
function segredoBate(recebido: string, esperado: string): boolean {
  if (!esperado || recebido.length !== esperado.length) return false
  let diff = 0
  for (let i = 0; i < esperado.length; i++) {
    diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i)
  }
  return diff === 0
}

type Resposta = { pergunta_externa: string; resposta: string }

/**
 * Chaves canônicas de atribuição. `pontuacao` e `data_formulario` não são
 * campanha (Meta Ads/UTM): são dados nativos do formulário (Respondi),
 * preservados aqui por não haver hoje outra coluna/tabela própria para eles
 * — `pontuacao` nunca é usada para derivar temperatura/qualificação;
 * `data_formulario` é guardada como texto exatamente como a fonte mandou,
 * nunca convertida de timezone e nunca usada para sobrescrever
 * `negociacoes.created_at`.
 *
 * `gclid`/`fbclid`: cliques de Google/Meta Ads, quando o Respondi os
 * capturar via `respondent_utms` — preservados crus, sem interpretação.
 *
 * `respondent_id`/`form_id`/`form_name`: metadados do respondente/
 * formulário no Respondi — `respondent_id` também já é o `external_id` do
 * lead; mantido aqui dentro de `atribuicao` só por completude/
 * rastreabilidade, nunca usado para dedup (quem faz dedup é `external_id`).
 */
const CHAVES_ATRIBUICAO = [
  'source',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
  'pontuacao',
  'data_formulario',
  'respondent_id',
  'form_id',
  'form_name',
] as const

type Atribuicao = Partial<Record<(typeof CHAVES_ATRIBUICAO)[number], string>>

type Payload = {
  external_id: string
  formulario_slug: string
  nicho_slug: string
  dados: {
    nome: string
    telefone?: string
    email?: string
    empresa?: string
    instagram?: string
  }
  respostas?: Resposta[]
  atribuicao?: Atribuicao
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** Só as chaves conhecidas, só as preenchidas — nunca repassa campos arbitrários pro banco. */
function validarAtribuicao(v: unknown): Atribuicao | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>

  const atribuicao: Atribuicao = {}
  for (const chave of CHAVES_ATRIBUICAO) {
    const valor = texto(o[chave])
    if (valor) atribuicao[chave] = valor
  }
  return Object.keys(atribuicao).length > 0 ? atribuicao : undefined
}

/**
 * Formato interno (legado) — inalterado em relação à versão anterior desta
 * função. Validação mínima de formato; a regra de negócio (dedup, nicho/
 * formulário existir) é do banco.
 */
function validarPayloadInterno(corpo: Record<string, unknown>): Payload | null {
  const externalId = texto(corpo.external_id)
  const formularioSlug = texto(corpo.formulario_slug)
  const nichoSlug = texto(corpo.nicho_slug)
  const dados = corpo.dados && typeof corpo.dados === 'object' ? (corpo.dados as Record<string, unknown>) : null
  const nome = dados ? texto(dados.nome) : undefined

  if (!externalId || !formularioSlug || !nichoSlug || !dados || !nome) return null

  const respostasBrutas = Array.isArray(corpo.respostas) ? corpo.respostas : []
  const respostas: Resposta[] = respostasBrutas.flatMap((r) => {
    if (!r || typeof r !== 'object') return []
    const item = r as Record<string, unknown>
    const perguntaExterna = texto(item.pergunta_externa)
    const resposta = texto(item.resposta)
    return perguntaExterna && resposta ? [{ pergunta_externa: perguntaExterna, resposta }] : []
  })

  return {
    external_id: externalId,
    formulario_slug: formularioSlug,
    nicho_slug: nichoSlug,
    dados: {
      nome,
      telefone: texto(dados.telefone),
      email: texto(dados.email),
      empresa: texto(dados.empresa),
      instagram: texto(dados.instagram),
    },
    respostas,
    atribuicao: validarAtribuicao(corpo.atribuicao),
  }
}

// ===========================================================================
// Formato nativo do Respondi
// ===========================================================================

/** trim + lowercase + espaços duplicados colapsados — nunca remove palavra nem muda conteúdo. */
function normalizar(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ')
}

function valorDaResposta(v: unknown): string | undefined {
  if (typeof v === 'string') return texto(v)
  if (typeof v === 'number' || typeof v === 'boolean') return texto(String(v))
  return undefined
}

/**
 * Busca a resposta de uma pergunta por título, tentando cada variante
 * aceita (já normalizada na comparação, nunca alterando o conteúdo da
 * resposta). `answers` (mapa pergunta → resposta) é a fonte principal,
 * conforme a documentação do Respondi; `raw_answers` só entra como
 * fallback quando a pergunta não aparece em `answers`. O formato exato de
 * `raw_answers` não foi documentado em detalhe no pedido original — tenta
 * as chaves mais comuns de título (`question`/`title`/`label`) e de valor
 * (`answer`/`value`/`text`), sem inventar uma terceira forma além dessas.
 */
function obterPorTitulo(
  answers: Record<string, unknown>,
  rawAnswers: unknown[],
  titulos: readonly string[],
): string | undefined {
  const normalizados = titulos.map(normalizar)

  for (const chave of Object.keys(answers)) {
    if (normalizados.includes(normalizar(chave))) {
      const valor = valorDaResposta(answers[chave])
      if (valor) return valor
    }
  }

  for (const item of rawAnswers) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const titulo = texto(o.question) ?? texto(o.title) ?? texto(o.label)
    if (!titulo || !normalizados.includes(normalizar(titulo))) continue
    const valor = valorDaResposta(o.answer) ?? valorDaResposta(o.value) ?? valorDaResposta(o.text)
    if (valor) return valor
  }

  return undefined
}

/**
 * Variante de `obterPorTitulo` que casa pelo SUFIXO do título em vez do
 * título inteiro — pra perguntas cujo prefixo varia (ex.: nome do
 * respondente, ou um placeholder não resolvido pelo Respondi como "___,").
 * Usada hoje só pela pergunta "meta de alunos" (ver `SUFIXO_META_ALUNOS`),
 * depois que uma exportação CSV real revelou o header vindo como
 * `"___, qual é a sua meta de alunos na sua instituição de ensino?"` em vez
 * de `"Breno, qual é..."`.
 */
function obterPorSufixoDeTitulo(
  answers: Record<string, unknown>,
  rawAnswers: unknown[],
  sufixo: string,
): string | undefined {
  const alvo = normalizar(sufixo)

  for (const chave of Object.keys(answers)) {
    if (normalizar(chave).endsWith(alvo)) {
      const valor = valorDaResposta(answers[chave])
      if (valor) return valor
    }
  }

  for (const item of rawAnswers) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const titulo = texto(o.question) ?? texto(o.title) ?? texto(o.label)
    if (!titulo || !normalizar(titulo).endsWith(alvo)) continue
    const valor = valorDaResposta(o.answer) ?? valorDaResposta(o.value) ?? valorDaResposta(o.text)
    if (valor) return valor
  }

  return undefined
}

/** Título da pergunta → campo de `dados` (cadastro do cliente, nunca vai para `respostas_lead`). */
const MAPA_DADOS_RESPONDI = [
  { titulo: 'Qual seu nome e sobrenome?', campo: 'nome' as const },
  { titulo: 'Digite o número do seu WhatsApp para contato', campo: 'telefone' as const },
  { titulo: 'Digite o seu melhor E-mail', campo: 'email' as const },
  { titulo: 'Qual o nome da empresa?', campo: 'empresa' as const },
  { titulo: 'Qual o Instagram da sua Instituição de Ensino?', campo: 'instagram' as const },
]

/**
 * As 4 perguntas de qualificação de `instituicao-ensino-captacao`, cada uma
 * já cadastrada como sua PRÓPRIA linha em `public.perguntas` (ordem 1000,
 * 2000, 3000, 4000 — confirmado por leitura real do banco em 2026-10-13).
 * `pergunta_externa` enviado pra `ingerir_lead_formulario` é sempre o texto
 * EXATO já cadastrado (`btrim` compara sem normalizar maiúscula/minúscula),
 * nunca o título como o Respondi mandou.
 *
 * HISTÓRICO (bug corrigido em 2026-10-13): até esta correção, a pergunta 3 e
 * a pergunta 4 abaixo eram tratadas como UMA pergunta canônica só (a 4
 * entrava como "variante" da 3, e era descartada sempre que a 3 também
 * viesse preenchida). Uma exportação CSV real revelou que isso causava
 * perda de dado real: das 20 respostas do formulário, 18 responderam as
 * duas perguntas, com valores DIFERENTES em 17 — a resposta da pergunta 4
 * era perdida silenciosamente nessas 17. As duas são independentes agora;
 * nenhuma é variante da outra.
 */
const PERGUNTA_COLABORADORES = 'Quantos colaboradores você possui?'
const PERGUNTA_DESAFIO = 'Atualmente, qual é o maior desafio da sua Instituição?'
/** Pergunta 3. Texto exato já cadastrado em `perguntas.texto` (ordem 3000). */
const PERGUNTA_META_ALUNOS = 'Breno, qual é a sua meta de alunos na sua instituição de ensino?'
/**
 * O título que o Respondi manda pra pergunta 3 traz o nome do respondente
 * (ou, como uma exportação CSV real mostrou, às vezes um placeholder não
 * resolvido, "___,") no lugar de "Breno,". Localiza a resposta pelo SUFIXO
 * da pergunta quando o título exato não bate — nunca pelo título completo.
 */
const SUFIXO_META_ALUNOS = ', qual é a sua meta de alunos na sua instituição de ensino?'
/** Pergunta 4. Texto exato já cadastrado em `perguntas.texto` (ordem 4000) — independente da pergunta 3, nunca sua variante. */
const PERGUNTA_ALUNOS_ATUALMENTE = 'E quantos alunos você tem atualmente?'

const CHAVES_UTM_RESPONDI = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const

/**
 * Transforma o payload oficial do Respondi no formato interno. Pura (sem
 * rede/banco) — joga `Error` com mensagem descritiva mas sem PII em campo
 * faltante, nunca com valor de dado do lead.
 */
function construirPayloadDoRespondi(corpo: Record<string, unknown>): Payload {
  const form = corpo.form && typeof corpo.form === 'object' ? (corpo.form as Record<string, unknown>) : {}
  const respondent =
    corpo.respondent && typeof corpo.respondent === 'object' ? (corpo.respondent as Record<string, unknown>) : null

  if (!respondent) throw new Error('respondent ausente.')

  const respondentId = texto(respondent.respondent_id)
  if (!respondentId) throw new Error('respondent.respondent_id ausente.')

  const answers =
    respondent.answers && typeof respondent.answers === 'object' ? (respondent.answers as Record<string, unknown>) : {}
  const rawAnswers = Array.isArray(respondent.raw_answers) ? respondent.raw_answers : []

  if (Object.keys(answers).length === 0 && rawAnswers.length === 0) {
    throw new Error('respondent.answers e respondent.raw_answers ausentes.')
  }

  const dados: Record<string, string | undefined> = {}
  for (const { titulo, campo } of MAPA_DADOS_RESPONDI) {
    dados[campo] = obterPorTitulo(answers, rawAnswers, [titulo])
  }

  // O Respondi manda o telefone formatado (ex.: "+55 (91) 98338-0874"), mas
  // `clientes.telefone` só aceita dígito puro (constraint
  // `clientes_telefone_formato`, 10-13 dígitos) — sem esta normalização o
  // INSERT inteiro falha com 23514. Remove só caractere não numérico; nunca
  // adiciona nem remove o DDI 55 — o Respondi já manda com DDI, e isso já
  // bate com o formato que o WhatsApp usa (`telefoneDoJid` em
  // whatsapp-service/src/telefone.ts sempre inclui 55), então a dedup por
  // telefone/whatsapp em `ingerir_lead_formulario` continua funcionando sem
  // precisar de nenhuma variação extra.
  if (dados.telefone) {
    dados.telefone = dados.telefone.replace(/\D/g, '') || undefined
  }

  if (!dados.nome) throw new Error('Pergunta de nome não encontrada nas respostas.')
  if (!dados.telefone && !dados.email) throw new Error('Nem telefone nem e-mail encontrados nas respostas.')

  const respostas: Resposta[] = []

  const colaboradores = obterPorTitulo(answers, rawAnswers, [PERGUNTA_COLABORADORES])
  if (colaboradores) respostas.push({ pergunta_externa: PERGUNTA_COLABORADORES, resposta: colaboradores })

  const desafio = obterPorTitulo(answers, rawAnswers, [PERGUNTA_DESAFIO])
  if (desafio) respostas.push({ pergunta_externa: PERGUNTA_DESAFIO, resposta: desafio })

  const metaAlunos =
    obterPorTitulo(answers, rawAnswers, [PERGUNTA_META_ALUNOS]) ??
    obterPorSufixoDeTitulo(answers, rawAnswers, SUFIXO_META_ALUNOS)
  if (metaAlunos) respostas.push({ pergunta_externa: PERGUNTA_META_ALUNOS, resposta: metaAlunos })

  // Independente da pergunta 3 — nunca sua variante (ver histórico acima).
  const alunosAtualmente = obterPorTitulo(answers, rawAnswers, [PERGUNTA_ALUNOS_ATUALMENTE])
  if (alunosAtualmente) respostas.push({ pergunta_externa: PERGUNTA_ALUNOS_ATUALMENTE, resposta: alunosAtualmente })

  const utms =
    respondent.respondent_utms && typeof respondent.respondent_utms === 'object'
      ? (respondent.respondent_utms as Record<string, unknown>)
      : {}

  const atribuicao: Atribuicao = { respondent_id: respondentId }
  const score = texto(respondent.score)
  if (score) atribuicao.pontuacao = score
  const data = texto(respondent.date)
  if (data) atribuicao.data_formulario = data
  const formId = texto(form.form_id)
  if (formId) atribuicao.form_id = formId
  const formName = texto(form.form_name)
  if (formName) atribuicao.form_name = formName
  for (const chave of CHAVES_UTM_RESPONDI) {
    const valor = texto(utms[chave])
    if (valor) atribuicao[chave] = valor
  }

  return {
    external_id: respondentId,
    formulario_slug: 'instituicao-ensino-captacao',
    nicho_slug: 'instituicao-ensino',
    dados: {
      nome: dados.nome,
      telefone: dados.telefone,
      email: dados.email,
      empresa: dados.empresa,
      instagram: dados.instagram,
    },
    respostas,
    atribuicao,
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')

  let corpoBruto: unknown
  try {
    corpoBruto = await req.json()
  } catch {
    return erro(400, 'pedido_invalido', 'JSON inválido.')
  }

  if (!corpoBruto || typeof corpoBruto !== 'object') {
    return erro(400, 'pedido_invalido', 'Payload inválido.')
  }
  const corpo = corpoBruto as Record<string, unknown>

  // Detecta o formato pelo FORMATO do corpo, não por um campo de versão —
  // os dois formatos têm formas estruturalmente diferentes (form/respondent
  // vs. external_id/formulario_slug/nicho_slug/dados), então não há ambiguidade.
  const ehRespondi = corpo.form !== undefined || corpo.respondent !== undefined

  let payload: Payload | null = null

  if (ehRespondi) {
    const recebidoHeader = req.headers.get('X-Webhook-Secret') ?? ''
    const recebidoQuery = new URL(req.url).searchParams.get('token') ?? ''
    const autenticado = segredoBate(recebidoHeader, segredoRespondi) || segredoBate(recebidoQuery, segredoRespondi)
    if (!autenticado) {
      console.warn('ingestao-lead: segredo do webhook Respondi inválido ou ausente.')
      return erro(401, 'segredo_invalido', 'Segredo inválido ou ausente.')
    }

    try {
      payload = construirPayloadDoRespondi(corpo)
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'payload inválido'
      console.warn('ingestao-lead: payload do Respondi inválido —', mensagem)
      return erro(400, 'pedido_invalido', 'Payload inválido: verifique o formato enviado pelo Respondi.')
    }
  } else {
    const recebido = req.headers.get('X-Webhook-Secret') ?? ''
    if (!segredoBate(recebido, segredoLegado)) {
      console.warn('ingestao-lead: segredo inválido ou ausente (formato interno).')
      return erro(401, 'segredo_invalido', 'Segredo inválido ou ausente.')
    }

    payload = validarPayloadInterno(corpo)
    if (!payload) {
      return erro(400, 'pedido_invalido', 'Payload inválido: faltam campos obrigatórios.')
    }
  }

  try {
    const { data, error } = await admin.rpc('ingerir_lead_formulario', {
      p_external_id: payload.external_id,
      p_formulario_slug: payload.formulario_slug,
      p_nicho_slug: payload.nicho_slug,
      p_nome: payload.dados.nome,
      p_telefone: payload.dados.telefone ?? null,
      p_email: payload.dados.email ?? null,
      p_empresa: payload.dados.empresa ?? null,
      p_instagram: payload.dados.instagram ?? null,
      p_respostas: payload.respostas,
      p_atribuicao: payload.atribuicao ?? null,
    })

    if (error) {
      // Log interno completo (código + mensagem do Postgres); a resposta
      // pública nunca ecoa error.message — só um código/mensagem genéricos,
      // pra nunca expor nome de tabela/coluna/constraint.
      console.error('ingestao-lead:', payload.external_id, error.code, error.message)

      // 22023 (dados inválidos, ex.: falta telefone/email), P0002 (nicho/
      // formulário/etapa inicial não encontrada), 23514/23505 (regra de
      // negócio/conflito de unicidade) são falhas de VALIDAÇÃO do que foi
      // enviado — 400, nunca 500. Qualquer outro código é inesperado (erro
      // de banco/servidor) — 500.
      const validacao = new Set(['22023', 'P0002', '23514', '23505'])
      if (validacao.has(error.code)) {
        return erro(400, 'payload_invalido', 'Dados inválidos: verifique nicho, formulário e dados do lead.')
      }
      return erro(500, 'erro_interno', 'Erro inesperado ao processar o lead.')
    }

    const resultado = data?.[0]
    console.log('ingestao-lead: ok', payload.external_id, resultado?.criado ? 'criado' : 'atualizado')

    return json(200, {
      ok: true,
      cliente_id: resultado?.cliente_id,
      negociacao_id: resultado?.negociacao_id,
      criado: resultado?.criado ?? false,
    })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'erro desconhecido'
    console.error('ingestao-lead: erro inesperado', payload.external_id, mensagem)
    return erro(500, 'erro_interno', 'Erro inesperado ao processar o lead.')
  }
})
