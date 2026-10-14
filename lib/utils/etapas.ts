import { Constants, type Database } from '@/lib/types/database'

type Enums = Database['public']['Enums']

export type CorEtapa = Enums['cor_etapa']
export type TipoEtapa = Enums['tipo_etapa']

/** O que as telas precisam de uma etapa para exibi-la. */
export type EtapaVisual = { nome: string; cor: CorEtapa }

/**
 * Uma coluna do Kanban. `etapaInicial` é a MESMA flag de
 * `etapas_funil.etapa_inicial` (onde leads automáticos entram) — nunca mais
 * resolvida pelo nome "Lead Novo" (ver 20261008130000_etapa_inicial_nichos_configuraveis.sql).
 * Usada para decidir qual coluna ordena por chegada real em vez de `posicao`.
 *
 * `ordem` e `chave` existem aqui (e não só em `Etapa`, a versão de
 * configuração) porque {@link sdrPodeMoverPara} precisa deles no Kanban —
 * mesmos campos, mesma fonte (`etapas_funil`).
 */
export type EtapaKanban = EtapaVisual & {
  id: string
  tipo: TipoEtapa
  etapaInicial: boolean
  ordem: number
  chave: string | null
}

export const CORES_ETAPA = Constants.public.Enums.cor_etapa

/**
 * Paleta fixa das etapas (o banco só aceita estes nomes). A cor aparece como
 * marcador ao lado do nome da etapa — nunca sozinha — e os tons 500 ficam
 * legíveis tanto no fundo claro quanto no escuro.
 */
export const PALETA_ETAPAS: Record<CorEtapa, { hex: string; rotulo: string }> = {
  azul: { hex: '#3b82f6', rotulo: 'Azul' },
  violeta: { hex: '#8b5cf6', rotulo: 'Violeta' },
  amarelo: { hex: '#eab308', rotulo: 'Amarelo' },
  laranja: { hex: '#f97316', rotulo: 'Laranja' },
  verde: { hex: '#22c55e', rotulo: 'Verde' },
  vermelho: { hex: '#ef4444', rotulo: 'Vermelho' },
  ciano: { hex: '#06b6d4', rotulo: 'Ciano' },
  rosa: { hex: '#ec4899', rotulo: 'Rosa' },
  turquesa: { hex: '#14b8a6', rotulo: 'Turquesa' },
  cinza: { hex: '#71717a', rotulo: 'Cinza' },
}

/**
 * Texto claro (branco) ou escuro sobre o fundo cheio de cada cor da paleta —
 * luminância relativa (WCAG) calculada uma vez para as 10 cores fixas: cada
 * uma usa o texto com mais contraste contra o próprio tom. Usado onde a cor
 * vira fundo do elemento inteiro (bloco de evento na agenda), não só marcador.
 */
export const TEXTO_SOBRE_COR: Record<CorEtapa, 'claro' | 'escuro'> = {
  azul: 'claro',
  violeta: 'claro',
  amarelo: 'escuro',
  laranja: 'escuro',
  verde: 'escuro',
  vermelho: 'claro',
  ciano: 'escuro',
  rosa: 'claro',
  turquesa: 'escuro',
  cinza: 'claro',
}

/** Sem cor definida (`cor_agenda` nulo): mesmo neutro zinc-500 do resto do app, texto claro. */
export const COR_AGENDA_PADRAO = '#71717a'

/** Cor de fundo do bloco/chip de um responsável na agenda — a dele, ou o neutro padrão. */
export function corDeFundoAgenda(cor: CorEtapa | null): string {
  return cor ? PALETA_ETAPAS[cor].hex : COR_AGENDA_PADRAO
}

/** Classe de texto com mais contraste contra `corDeFundoAgenda(cor)`. */
export function classeTextoAgenda(cor: CorEtapa | null): string {
  const contraste = cor ? TEXTO_SOBRE_COR[cor] : 'claro'
  return contraste === 'escuro' ? 'text-zinc-900' : 'text-white'
}

/**
 * Cor do nicho como TEXTO (não fundo) — os tons 500 da paleta já são
 * legíveis em claro e escuro (ver comentário de `PALETA_ETAPAS`), por isso
 * aqui não precisa de um `TEXTO_SOBRE_COR` como `corDeFundoAgenda`. Mesma
 * fonte de verdade de `nichos.cor` (nunca uma cor hardcoded por nicho);
 * "Outros"/sem nicho usa o cinza da paleta, nunca fica sem cor.
 */
export function corDeNicho(cor: CorEtapa | null): string {
  return PALETA_ETAPAS[cor ?? 'cinza'].hex
}

/**
 * Padrão de data do export do Respondi (`YYYY-MM-DD[ HH:MM:SS]`) — também
 * aceito pelo `Date` do Node sem ambiguidade de timezone na comparação
 * usada aqui (ordenação, nunca exibição).
 */
const PADRAO_DATA_ISO_OU_RESPONDI = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?/

/**
 * Data de chegada REAL de um lead, para ordenar a etapa inicial do funil
 * (nunca para exibir). `dataFormulario` (`negociacoes.atribuicao.data_formulario`,
 * do Respondi) manda quando existir e for uma data válida — é a única data
 * que sobrevive a uma importação histórica feita hoje. Sem ela (ex.: lead
 * de WhatsApp, sem formulário), cai em `criadoEm` (`negociacoes.created_at`,
 * sempre existente) — fallback documentado, nunca inventa uma data nova.
 */
export function calcularDataChegada(dataFormulario: string | null | undefined, criadoEm: string): string {
  if (dataFormulario && PADRAO_DATA_ISO_OU_RESPONDI.test(dataFormulario.trim())) {
    const ms = new Date(dataFormulario.trim()).getTime()
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  return criadoEm
}

export const ROTULO_TIPO_ETAPA: Record<TipoEtapa, string> = {
  aberta: 'Aberta',
  ganha: 'Ganha (fechamento)',
  perdida: 'Perdida',
}

/** Ganha e perdida só se alcançam pelo modal (fechamento / motivo). */
export function tipoExigeModal(tipo: TipoEtapa): tipo is 'ganha' | 'perdida' {
  return tipo === 'ganha' || tipo === 'perdida'
}

/**
 * A partir de quantos dias na mesma etapa aberta um card conta como parado.
 * Precisa bater com o `interval '7 days'` de `public.funil_metricas`.
 */
export const DIAS_PARADO = 7

/** `etapas_funil.chave` da etapa onde o SDR entrega o lead para o closer. */
export const CHAVE_HANDOFF_SDR = 'reuniao_realizada'

/**
 * Decide se um SDR pode mover uma negociação de `ordemOrigem` para
 * `ordemDestino`, dado o `ordemLimite` (a `ordem` da etapa de chave
 * {@link CHAVE_HANDOFF_SDR} NO MESMO FUNIL da negociação, ou `null` se esse
 * funil não tiver essa etapa técnica).
 *
 * Mesma função usada no servidor (`moverNegociacao`, última palavra — RLS e
 * trigger não sabem nada de "SDR vs. closer") e no Kanban (só UX: esconder o
 * que o SDR não pode fazer). Pura e determinística de propósito — nunca
 * depende do NOME da etapa, só da `ordem`/`chave` de `etapas_funil`, porque o
 * nome é editável pelo gerente.
 *
 * Regra: uma vez que a negociação alcança (ordem >= limite) a etapa de
 * handoff, o SDR perde controle total sobre ela — nem pra frente, nem pra
 * trás. Antes disso, o SDR pode avançar livremente, inclusive ENTRAR na
 * etapa de handoff (ordemDestino === ordemLimite é permitido), mas nunca
 * pular direto para além dela.
 *
 * `ordemLimite === null` (funil sem a etapa `reuniao_realizada`): a regra
 * simplesmente não existe nesse funil — nunca inventar um limite novo.
 */
export function sdrPodeMoverPara(
  ordemOrigem: number,
  ordemDestino: number,
  ordemLimite: number | null,
): boolean {
  if (ordemLimite === null) return true
  if (ordemOrigem >= ordemLimite) return false
  return ordemDestino <= ordemLimite
}
