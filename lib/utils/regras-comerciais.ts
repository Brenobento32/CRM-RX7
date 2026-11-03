/**
 * Regras comerciais de cada empresa (migration 20261109090100): menu Metas,
 * tipos de venda/meta liberados e o que o fechamento pede. O Super Admin
 * configura; o CRM da empresa só lê. Os padrões espelham
 * `public.regras_comerciais_padrao()` no banco, que confere tudo de novo.
 */
export const TIPOS_VENDA_REGRAS = ['tcv', 'mrr', 'venda'] as const
export type TipoVendaRegra = (typeof TIPOS_VENDA_REGRAS)[number]

export const CAMPOS_FECHAMENTO = [
  'contrato_enviado',
  'contrato_assinado',
  'link_contrato',
  'status_pagamento',
  'status_onboarding',
  'servicos',
  'observacoes',
] as const
export type CampoFechamento = (typeof CAMPOS_FECHAMENTO)[number]

export const REGRAS_CAMPO = ['oculto', 'opcional', 'obrigatorio', 'confirmar'] as const
export type RegraCampo = (typeof REGRAS_CAMPO)[number]

/** Só contrato enviado/assinado aceitam "confirmar" (precisa ser Sim). */
export const CAMPOS_COM_CONFIRMACAO: readonly CampoFechamento[] = ['contrato_enviado', 'contrato_assinado']

export type PerfilComercial = 'generico' | 'agencia'

export type RegrasComerciais = {
  perfil: PerfilComercial
  metasAtivo: boolean
  tiposVenda: TipoVendaRegra[]
  campos: Record<CampoFechamento, RegraCampo>
  /** false = empresa sem regras gravadas (usa o padrão genérico). */
  configurado: boolean
}

export const ROTULO_PERFIL: Record<PerfilComercial, string> = {
  generico: 'Genérico (venda comum)',
  agencia: 'Agência (contratos, TCV/MRR)',
}

export const ROTULO_CAMPO_FECHAMENTO: Record<CampoFechamento, string> = {
  contrato_enviado: 'Contrato enviado',
  contrato_assinado: 'Contrato assinado',
  link_contrato: 'Link do contrato',
  status_pagamento: 'Status do pagamento',
  status_onboarding: 'Status do onboarding',
  servicos: 'Serviços contratados',
  observacoes: 'Observações',
}

export const ROTULO_REGRA_CAMPO: Record<RegraCampo, string> = {
  oculto: 'Não usar',
  opcional: 'Opcional',
  obrigatorio: 'Obrigatório',
  confirmar: 'Obrigatório e "Sim"',
}

export const PADRAO_POR_PERFIL: Record<PerfilComercial, { tiposVenda: TipoVendaRegra[]; campos: Record<CampoFechamento, RegraCampo> }> = {
  generico: {
    tiposVenda: ['venda'],
    campos: {
      contrato_enviado: 'oculto',
      contrato_assinado: 'oculto',
      link_contrato: 'oculto',
      status_pagamento: 'opcional',
      status_onboarding: 'oculto',
      servicos: 'opcional',
      observacoes: 'opcional',
    },
  },
  agencia: {
    tiposVenda: ['tcv', 'mrr'],
    campos: {
      contrato_enviado: 'obrigatorio',
      contrato_assinado: 'obrigatorio',
      link_contrato: 'opcional',
      status_pagamento: 'obrigatorio',
      status_onboarding: 'obrigatorio',
      servicos: 'opcional',
      observacoes: 'opcional',
    },
  },
}

/**
 * Sem a migration no banco (site publicado antes dela), o CRM continua com o
 * comportamento de antes: agência, TCV/MRR e Metas ligado.
 */
export const REGRAS_ANTERIORES: RegrasComerciais = {
  perfil: 'agencia',
  metasAtivo: true,
  tiposVenda: [...PADRAO_POR_PERFIL.agencia.tiposVenda],
  campos: { ...PADRAO_POR_PERFIL.agencia.campos },
  configurado: true,
}

const ehTipo = (v: unknown): v is TipoVendaRegra => (TIPOS_VENDA_REGRAS as readonly unknown[]).includes(v)
const ehRegra = (v: unknown): v is RegraCampo => (REGRAS_CAMPO as readonly unknown[]).includes(v)

/** JSON de `minhas_regras_comerciais()` / `admin_regras_comerciais()` → tipo seguro (nunca confia no formato). */
export function normalizarRegras(bruto: unknown): RegrasComerciais {
  if (!bruto || typeof bruto !== 'object') return REGRAS_ANTERIORES
  const r = bruto as Record<string, unknown>
  const perfil: PerfilComercial = r.perfil === 'generico' ? 'generico' : 'agencia'
  const padrao = PADRAO_POR_PERFIL[perfil]
  const tipos = Array.isArray(r.tipos_venda) ? TIPOS_VENDA_REGRAS.filter((t) => (r.tipos_venda as unknown[]).includes(t)) : []
  const camposBrutos = r.campos && typeof r.campos === 'object' ? (r.campos as Record<string, unknown>) : {}
  const campos = Object.fromEntries(
    CAMPOS_FECHAMENTO.map((c) => [c, ehRegra(camposBrutos[c]) ? camposBrutos[c] : padrao.campos[c]]),
  ) as Record<CampoFechamento, RegraCampo>
  return {
    perfil,
    metasAtivo: r.metas_ativo !== false,
    tiposVenda: tipos.length > 0 ? tipos : [...padrao.tiposVenda],
    campos,
    configurado: r.configurado !== false,
  }
}

/** Campos que diferem do padrão do perfil (o banco guarda só a diferença). */
export function camposDiferentesDoPadrao(perfil: PerfilComercial, campos: Record<CampoFechamento, RegraCampo>): Partial<Record<CampoFechamento, RegraCampo>> {
  return Object.fromEntries(CAMPOS_FECHAMENTO.filter((c) => campos[c] !== PADRAO_POR_PERFIL[perfil].campos[c]).map((c) => [c, campos[c]]))
}

/** Mesma checagem do banco (constraint fechamentos_assinatura_exige_envio). */
export function problemaNasRegras(campos: Record<CampoFechamento, RegraCampo>, tipos: readonly string[]): string | null {
  if (!tipos.some(ehTipo)) return 'Escolha ao menos um tipo de venda/meta (TCV, MRR ou Venda comum).'
  if (campos.contrato_assinado !== 'oculto' && campos.contrato_enviado === 'oculto') {
    return 'Para pedir "contrato assinado", o fechamento também precisa mostrar "contrato enviado".'
  }
  const confirmarInvalido = CAMPOS_FECHAMENTO.find((c) => campos[c] === 'confirmar' && !CAMPOS_COM_CONFIRMACAO.includes(c))
  if (confirmarInvalido) return `"Obrigatório e Sim" só vale para contrato enviado e contrato assinado.`
  return null
}

/**
 * Tipos exibidos em Metas: os liberados para a empresa e, para não esconder
 * histórico, qualquer outro que já tenha meta ou venda no período mostrado.
 */
export function tiposVisiveis(liberados: readonly TipoVendaRegra[], comDados: readonly TipoVendaRegra[] = []): TipoVendaRegra[] {
  return TIPOS_VENDA_REGRAS.filter((t) => liberados.includes(t) || comDados.includes(t))
}
