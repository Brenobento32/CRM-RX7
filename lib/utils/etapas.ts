import { Constants, type Database } from '@/lib/types/database'

type Enums = Database['public']['Enums']

export type CorEtapa = Enums['cor_etapa']
export type TipoEtapa = Enums['tipo_etapa']

/** O que as telas precisam de uma etapa para exibi-la. */
export type EtapaVisual = { nome: string; cor: CorEtapa }

/** Uma coluna do Kanban. */
export type EtapaKanban = EtapaVisual & { id: string; tipo: TipoEtapa }

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
