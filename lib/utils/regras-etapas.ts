/**
 * Exigências por funil e etapa (migration 20261109090200). O Super Admin define,
 * por etapa aberta (exceto a inicial), o uso de cada campo comercial da
 * negociação e um checklist de confirmações para ENTRAR na etapa. O banco é
 * quem trava (gatilho na troca de etapa, erro RX101); aqui ficam as mesmas
 * regras para o formulário mostrar, esconder e avisar antes de enviar.
 */

export const CAMPOS_ETAPA = [
  'valor_estimado',
  'temperatura',
  'data_primeira_reuniao',
  'data_proposta',
  'valor_proposta',
  'forma_pagamento',
  'objecao_principal',
  'servicos',
] as const

export type CampoEtapa = (typeof CAMPOS_ETAPA)[number]

export const USOS_CAMPO_ETAPA = ['oculto', 'opcional', 'obrigatorio'] as const
export type UsoCampoEtapa = (typeof USOS_CAMPO_ETAPA)[number]

export const ROTULO_CAMPO_ETAPA: Record<CampoEtapa, string> = {
  valor_estimado: 'Valor estimado',
  temperatura: 'Temperatura',
  data_primeira_reuniao: 'Primeira reunião',
  data_proposta: 'Data da proposta',
  valor_proposta: 'Valor da proposta',
  forma_pagamento: 'Forma de pagamento',
  objecao_principal: 'Objeção principal',
  servicos: 'Serviços',
}

export const ROTULO_USO_CAMPO_ETAPA: Record<UsoCampoEtapa, string> = {
  oculto: 'Não usar',
  opcional: 'Opcional',
  obrigatorio: 'Obrigatório para entrar na etapa',
}

/** Nome do campo no formulário da negociação (serviços vão como lista de ids). */
export const CAMPO_FORMULARIO: Record<CampoEtapa, string> = {
  valor_estimado: 'valor_estimado',
  temperatura: 'temperatura',
  data_primeira_reuniao: 'data_primeira_reuniao',
  data_proposta: 'data_proposta',
  valor_proposta: 'valor_proposta',
  forma_pagamento: 'forma_pagamento',
  objecao_principal: 'objecao_principal',
  servicos: 'servico_ids',
}

export type ItemChecklist = { id: string; texto: string }

export type RegraEtapa = {
  campos: Partial<Record<CampoEtapa, UsoCampoEtapa>>
  checklist: ItemChecklist[]
}

/** etapaId → regra. Etapa ausente = sem exigências (o padrão). */
export type RegrasEtapas = Record<string, RegraEtapa>

/** O que falta para entrar na etapa (detalhe do erro RX101 do banco). */
export type RequisitosEtapa = {
  etapaId: string
  etapaNome: string
  campos: CampoEtapa[]
  checklist: ItemChecklist[]
}

function ehCampo(v: unknown): v is CampoEtapa {
  return typeof v === 'string' && (CAMPOS_ETAPA as readonly string[]).includes(v)
}

function ehUso(v: unknown): v is UsoCampoEtapa {
  return typeof v === 'string' && (USOS_CAMPO_ETAPA as readonly string[]).includes(v)
}

function itens(v: unknown): ItemChecklist[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((i) =>
    i && typeof i === 'object' && typeof (i as ItemChecklist).id === 'string' && typeof (i as ItemChecklist).texto === 'string'
      ? [{ id: (i as ItemChecklist).id, texto: (i as ItemChecklist).texto }]
      : [],
  )
}

/** JSON do banco → tipo seguro. Valores desconhecidos são ignorados (= opcional). */
export function normalizarRegraEtapa(campos: unknown, checklist: unknown): RegraEtapa {
  const c: RegraEtapa['campos'] = {}
  if (campos && typeof campos === 'object' && !Array.isArray(campos)) {
    for (const [k, v] of Object.entries(campos)) if (ehCampo(k) && ehUso(v) && v !== 'opcional') c[k] = v
  }
  return { campos: c, checklist: itens(checklist) }
}

export function usoDoCampo(regra: RegraEtapa | undefined, campo: CampoEtapa): UsoCampoEtapa {
  return regra?.campos[campo] ?? 'opcional'
}

/**
 * Campos que o formulário mostra. Ao mover para uma etapa, vale a regra do
 * DESTINO (é lá que a negociação vai ficar); editando, a da etapa atual. Um
 * campo obrigatório nunca fica escondido.
 */
export function camposVisiveis(regraAtual: RegraEtapa | undefined, regraDestino?: RegraEtapa): Set<CampoEtapa> {
  const regra = regraDestino ?? regraAtual
  return new Set(CAMPOS_ETAPA.filter((c) => usoDoCampo(regra, c) !== 'oculto'))
}

/**
 * Mostrar o valor deste campo onde a negociação aparece (card, painel, ficha,
 * listas operacionais)? "Não usar" na etapa atual esconde; o valor continua
 * gravado. Sem etapa conhecida ou sem regra: mostra (comportamento de sempre).
 */
export function mostraCampo(regras: RegrasEtapas | undefined, etapaId: string | null | undefined, campo: CampoEtapa): boolean {
  return !etapaId || usoDoCampo(regras?.[etapaId], campo) !== 'oculto'
}

export function camposObrigatorios(regra: RegraEtapa | undefined): CampoEtapa[] {
  return CAMPOS_ETAPA.filter((c) => usoDoCampo(regra, c) === 'obrigatorio')
}

type ValoresNegociacao = {
  valor_estimado: string | number | null
  temperatura: string | null
  data_primeira_reuniao: string | null
  data_proposta: string | null
  valor_proposta: string | number | null
  forma_pagamento: string | null
  objecao_principal: string | null
  servico_ids: string[]
}

function vazio(campo: CampoEtapa, v: ValoresNegociacao): boolean {
  if (campo === 'servicos') return v.servico_ids.length === 0
  const valor = v[campo]
  return valor === null || (typeof valor === 'string' && valor.trim() === '')
}

/** Obrigatórios do destino que ficaram vazios (mesma checagem do banco). */
export function camposFaltando(regra: RegraEtapa | undefined, valores: ValoresNegociacao): CampoEtapa[] {
  return camposObrigatorios(regra).filter((c) => vazio(c, valores))
}

/**
 * Campos que o formulário não mostrou ficam com o valor gravado — um campo
 * "Não usar" nunca é apagado por um salvamento.
 */
export function preservarOcultos<T extends ValoresNegociacao>(valores: T, atuais: ValoresNegociacao, visiveis: Set<CampoEtapa>): T {
  const r: Record<string, unknown> = { ...valores }
  for (const c of CAMPOS_ETAPA) {
    if (visiveis.has(c)) continue
    r[CAMPO_FORMULARIO[c]] = c === 'servicos' ? atuais.servico_ids : atuais[c]
  }
  return r as T
}

/** Detalhe do erro RX101 (JSON em `error.details`) → requisitos. `null` se não der para ler. */
export function lerRequisitos(details: string | null | undefined): RequisitosEtapa | null {
  if (!details) return null
  try {
    const d = JSON.parse(details) as Record<string, unknown>
    if (typeof d.etapa_id !== 'string') return null
    return {
      etapaId: d.etapa_id,
      etapaNome: typeof d.etapa === 'string' ? d.etapa : '',
      campos: Array.isArray(d.campos) ? d.campos.filter(ehCampo) : [],
      checklist: itens(d.checklist),
    }
  } catch {
    return null
  }
}

/** Mensagem curta do que falta (perto do botão e no topo do quadro). */
export function descreverRequisitos(r: Pick<RequisitosEtapa, 'etapaNome' | 'campos' | 'checklist'>): string {
  const partes = [
    ...r.campos.map((c) => ROTULO_CAMPO_ETAPA[c]),
    ...r.checklist.map((i) => `confirmar "${i.texto}"`),
  ]
  return `Para mover para "${r.etapaNome}", falta: ${partes.join(', ')}.`
}

/** Mesma validação do banco (admin_definir_regras_etapa), para o formulário do Super Admin. */
export function problemaNoChecklist(linhas: string[]): string | null {
  const textos = linhas.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (textos.length > 10) return 'No máximo 10 itens de checklist por etapa.'
  if (textos.some((t) => t.length < 3 || t.length > 200)) return 'Cada item do checklist precisa ter de 3 a 200 caracteres.'
  const vistos = new Set<string>()
  for (const t of textos) {
    const k = t.toLowerCase()
    if (vistos.has(k)) return `Item repetido no checklist: ${t}.`
    vistos.add(k)
  }
  return null
}
