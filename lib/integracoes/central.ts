/**
 * Central de Integrações: o que cada cartão mostra, a partir do que o banco
 * devolve (`central_integracoes_empresa`). Regra de ouro: integração não
 * lançada nunca aparece como operacional, e a liberação real é sempre do
 * banco (plano + exceção do Super Admin) — aqui só se decide a apresentação.
 */

export const INTEGRACOES = ['formularios', 'google_sheets', 'whatsapp_oficial', 'meta_conversoes'] as const
export type ChaveIntegracao = (typeof INTEGRACOES)[number]
/**
 * Cartões da tela. O WhatsApp oficial aparece em DOIS cartões (número novo pela
 * Cloud API e app existente por coexistência), mas é UMA integração no banco:
 * mesma permissão, mesmo limite de números, mesma infraestrutura segura.
 */
export type CartaoCentral = ChaveIntegracao | 'whatsapp_app'

export type LinhaCentral = {
  integracao: ChaveIntegracao
  /** Cartão da tela (padrão: a própria integração). */
  cartao?: CartaoCentral
  lancada: boolean
  noPlano: boolean
  regra: 'liberar' | 'bloquear' | null
  permitida: boolean
  emUso: number
  comErro: number
  pendentes: number
  ultimaAtividade: string | null
  solicitadaEm: string | null
  planoNome: string | null
  /**
   * Fontes de captação (formulários, Respondi, webhook, Google Sheets): limite efetivo (exceção da empresa ou plano).
   * `null` com `...Definido` = sem limite (empresa interna). Números de WhatsApp NÃO entram aqui.
   */
  limiteFontes: number | null
  usoFontes: number
  limiteFontesDefinido: boolean
  /** Números de WhatsApp: API oficial e app existente contam juntos. */
  limiteNumeros: number | null
  limiteNumerosDefinido: boolean
  usoNumeros: number
}

export type EstadoCartao = 'nao_conectado' | 'conectado' | 'ativo' | 'erro' | 'limite_atingido' | 'limite_a_definir'
export type GrupoCartao = 'liberada' | 'upgrade' | 'em_breve'

export type InfoIntegracao = {
  nome: string
  resumo: string
  unidade: [singular: string, plural: string]
  beneficios: string[]
}

export const INFO: Record<CartaoCentral, InfoIntegracao> = {
  formularios: {
    nome: 'Formulários e webhooks',
    resumo: 'Formulário AVANTE, Respondi e webhook: cada envio vira lead no funil, com todas as respostas guardadas.',
    unidade: ['fonte ativa', 'fontes ativas'],
    beneficios: ['Formulário próprio com link para divulgar', 'Respondi e sistemas da empresa por webhook', 'Perguntas e respostas no lead'],
  },
  google_sheets: {
    nome: 'Google Sheets',
    resumo: 'Cole o link da planilha (de um Google Forms, por exemplo), autorize o Google e as linhas novas entram no funil.',
    unidade: ['planilha', 'planilhas'],
    beneficios: ['Linhas novas em segundos ou poucos minutos', 'Sem duplicar leads ao reordenar ou editar a planilha', 'Todas as colunas guardadas no lead'],
  },
  whatsapp_oficial: {
    nome: 'WhatsApp Business — API Oficial',
    resumo: 'Número novo pela Cloud API da Meta: quem escreve vira lead no funil e a equipe responde pelo AVANTE, com controle de custos.',
    unidade: ['número', 'números'],
    beneficios: ['Conexão oficial da Meta (Cloud API)', 'Conversas ligadas ao cliente e ao funil', 'Bloqueio preventivo de envios cobrados'],
  },
  whatsapp_app: {
    nome: 'WhatsApp Business — Conectar aplicativo existente',
    resumo: 'Coexistência oficial da Meta: o número continua no app WhatsApp Business do celular e as conversas também chegam ao AVANTE.',
    unidade: ['número', 'números'],
    beneficios: ['O app do celular continua funcionando', 'Histórico e contatos quando a Meta enviar e você autorizar', 'Mesmo limite de números do plano'],
  },
  meta_conversoes: {
    nome: 'Meta Ads — conversões do funil',
    resumo: 'Devolve à Meta o avanço dos leads de anúncios (qualificado, reunião, venda) para otimizar campanhas pela qualidade.',
    unidade: ['conexão', 'conexões'],
    beneficios: ['Campanhas otimizadas por leads que avançam no funil', 'Você escolhe quais etapas enviar', 'Painel de eventos aceitos e rejeitados'],
  },
}

export function grupoDoCartao(l: LinhaCentral): GrupoCartao {
  if (!l.lancada) return 'em_breve'
  return l.permitida ? 'liberada' : 'upgrade'
}

const ehWhatsapp = (i: ChaveIntegracao) => i === 'whatsapp_oficial'

/** Limite que vale para conexões NOVAS deste cartão: números (WhatsApp) ou fontes de captação (demais). */
export function limiteDoCartao(l: LinhaCentral): { definido: boolean; limite: number | null; uso: number } {
  return ehWhatsapp(l.integracao)
    ? { definido: l.limiteNumerosDefinido, limite: l.limiteNumeros, uso: l.usoNumeros }
    : { definido: l.limiteFontesDefinido, limite: l.limiteFontes, uso: l.usoFontes }
}

/** Ausência de limite cadastrado NÃO é ilimitado: novas conexões ficam bloqueadas até ser definido. */
export function limiteAtingido(l: LinhaCentral): boolean {
  const x = limiteDoCartao(l)
  return x.definido && x.limite !== null && x.uso >= x.limite
}

export function estadoDoCartao(l: LinhaCentral): EstadoCartao {
  if (l.comErro > 0) return 'erro'
  if (l.emUso === 0) return !limiteDoCartao(l).definido ? 'limite_a_definir' : limiteAtingido(l) ? 'limite_atingido' : 'nao_conectado'
  if (l.pendentes >= l.emUso || !l.ultimaAtividade) return 'conectado'
  return 'ativo'
}

export const ROTULO_ESTADO: Record<EstadoCartao, { texto: string; tom: 'verde' | 'azul' | 'ambar' | 'vermelho' | 'neutro' }> = {
  nao_conectado: { texto: 'Não conectado', tom: 'neutro' },
  conectado: { texto: 'Conectado', tom: 'azul' },
  ativo: { texto: 'Ativo', tom: 'verde' },
  erro: { texto: 'Com erro', tom: 'vermelho' },
  limite_atingido: { texto: 'Limite do plano atingido', tom: 'ambar' },
  limite_a_definir: { texto: 'Limite a definir', tom: 'ambar' },
}

/** Os dois cartões do WhatsApp a partir da linha única do banco, com o uso de cada modo de conexão. */
export function cartoesWhatsapp(
  l: LinhaCentral,
  numeros: { modo: 'cloud_api' | 'coexistencia'; situacao: string; comErro: boolean }[],
): [LinhaCentral, LinhaCentral] {
  const ativos = numeros.filter((n) => n.situacao !== 'desconectado' && n.situacao !== 'revogada')
  const deModo = (m: 'cloud_api' | 'coexistencia') => ativos.filter((n) => n.modo === m)
  const linha = (cartao: CartaoCentral, lista: typeof ativos): LinhaCentral => ({
    ...l,
    cartao,
    emUso: lista.length,
    comErro: lista.filter((n) => n.comErro).length,
    pendentes: lista.filter((n) => n.situacao === 'pendente_registro').length,
    ultimaAtividade: lista.length ? l.ultimaAtividade : null,
  })
  return [linha('whatsapp_oficial', deModo('cloud_api')), linha('whatsapp_app', deModo('coexistencia'))]
}

export const infoDoCartao = (l: LinhaCentral) => INFO[l.cartao ?? l.integracao]

export function textoDeUso(l: LinhaCentral): string {
  const [um, varios] = infoDoCartao(l).unidade
  return `${l.emUso} ${l.emUso === 1 ? um : varios}`
}

function parteDoLimite(uso: number, limite: number | null, definido: boolean, nome: string): string {
  if (!definido) return `${uso} ${nome} em uso (limite a definir pela Rio X7: novas conexões bloqueadas)`
  if (limite === null) return `${uso} ${nome} em uso (sem limite de plano)`
  return `${uso} de ${limite} ${nome}`
}

export function textoDoLimite(
  l: Pick<LinhaCentral, 'planoNome' | 'limiteFontes' | 'usoFontes' | 'limiteFontesDefinido' | 'limiteNumeros' | 'limiteNumerosDefinido' | 'usoNumeros'>,
): string {
  const plano = l.planoNome ? `Plano ${l.planoNome}` : 'Sem plano vinculado'
  return `${plano}: ${parteDoLimite(l.usoFontes, l.limiteFontes, l.limiteFontesDefinido, 'fonte(s) de captação')}; ${parteDoLimite(l.usoNumeros, l.limiteNumeros, l.limiteNumerosDefinido, 'número(s) de WhatsApp')}.`
}

/** Linha do banco (snake_case) → tipo da tela; ignora integração desconhecida. */
export function lerLinhasCentral(dados: unknown): LinhaCentral[] {
  if (!Array.isArray(dados)) return []
  return dados.flatMap((d) => {
    const r = d as Record<string, unknown>
    const chave = r.integracao as ChaveIntegracao
    if (!INTEGRACOES.includes(chave)) return []
    const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
    return [
      {
        integracao: chave,
        lancada: r.lancada === true,
        noPlano: r.no_plano === true,
        regra: r.regra === 'liberar' || r.regra === 'bloquear' ? r.regra : null,
        permitida: r.permitida === true,
        emUso: n(r.em_uso),
        comErro: n(r.com_erro),
        pendentes: n(r.pendentes),
        ultimaAtividade: typeof r.ultima_atividade === 'string' ? r.ultima_atividade : null,
        solicitadaEm: typeof r.solicitada_em === 'string' ? r.solicitada_em : null,
        planoNome: typeof r.plano_nome === 'string' ? r.plano_nome : null,
        limiteFontes: r.limite_fontes === null || r.limite_fontes === undefined ? null : n(r.limite_fontes),
        usoFontes: n(r.uso_fontes),
        limiteFontesDefinido: r.limite_fontes_definido === true,
        limiteNumeros: r.limite_numeros === null || r.limite_numeros === undefined ? null : n(r.limite_numeros),
        limiteNumerosDefinido: r.limite_numeros_definido === true,
        usoNumeros: n(r.uso_numeros),
      },
    ]
  })
}
