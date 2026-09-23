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

export const ROTULO_TIPO_ETAPA: Record<TipoEtapa, string> = {
  aberta: 'Aberta',
  ganha: 'Ganha (fechamento)',
  perdida: 'Perdida',
}

/** Ganha e perdida só se alcançam pelo modal (fechamento / motivo). */
export function tipoExigeModal(tipo: TipoEtapa): tipo is 'ganha' | 'perdida' {
  return tipo === 'ganha' || tipo === 'perdida'
}
