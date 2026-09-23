import type { Database } from '@/lib/types/database'

export type EtapaFunil = Database['public']['Enums']['etapa_funil']

export const ROTULO_ETAPA: Record<EtapaFunil, string> = {
  reuniao_agendada: 'Reunião agendada',
  reuniao_realizada: 'Reunião realizada',
  proposta_enviada: 'Proposta enviada',
  negociacao: 'Negociação',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

/**
 * Classes das cores de etapa definidas em `app/globals.css`. Escritas por
 * extenso para que o Tailwind as encontre ao gerar o CSS.
 */
export const COR_ETAPA: Record<EtapaFunil, string> = {
  reuniao_agendada: 'bg-stage-reuniao-agendada',
  reuniao_realizada: 'bg-stage-reuniao-realizada',
  proposta_enviada: 'bg-stage-proposta-enviada',
  negociacao: 'bg-stage-negociacao',
  fechado: 'bg-stage-fechado',
  perdido: 'bg-stage-perdido',
}
