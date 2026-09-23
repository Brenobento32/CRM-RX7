import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { instanteSaoPaulo } from '@/lib/utils/formatacao'

type Enums = Database['public']['Enums']

export type TipoEvento = Enums['tipo_evento']
export type StatusEvento = Enums['status_evento']

export const TIPOS_EVENTO = Constants.public.Enums.tipo_evento
export const STATUS_EVENTO = Constants.public.Enums.status_evento

export const ROTULO_TIPO_EVENTO: Record<TipoEvento, string> = {
  reuniao: 'Reunião',
  ligacao: 'Ligação',
  followup: 'Follow-up',
  apresentacao: 'Apresentação',
}

export const ROTULO_STATUS_EVENTO: Record<StatusEvento, string> = {
  agendado: 'Agendado',
  realizado: 'Realizado',
  nao_compareceu: 'Não compareceu',
  cancelado: 'Cancelado',
}

const hora = (mensagem: string) =>
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, mensagem)

const uuidOpcional = (mensagem: string) =>
  z
    .string()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.uuid(mensagem).nullable())

/**
 * Evento da agenda. Data e horas chegam como no formulário (horário de São
 * Paulo) e saem como `inicio` / `fim` em ISO UTC para o timestamptz.
 *
 * O status não entra aqui: muda só por `alterar_status_evento`, que também
 * registra a atividade na timeline do cliente.
 */
export const eventoSchema = z
  .object({
    cliente_id: z.uuid('Selecione o cliente.'),
    negociacao_id: uuidOpcional('Negociação inválida.'),
    usuario_id: uuidOpcional('Responsável inválido.'),
    tipo: z.enum(TIPOS_EVENTO, 'Selecione o tipo.'),
    titulo: z
      .string()
      .trim()
      .min(1, 'Informe o título.')
      .max(200, 'Máximo de 200 caracteres.'),
    descricao: z
      .string()
      .trim()
      .max(5000, 'Máximo de 5000 caracteres.')
      .transform((v) => (v === '' ? null : v)),
    data: z.iso.date('Informe a data.'),
    hora_inicio: hora('Informe a hora de início.'),
    hora_fim: hora('Informe a hora de término.'),
  })
  .superRefine((e, ctx) => {
    // "HH:mm" compara como texto. Eventos que viram a madrugada não entram.
    if (e.hora_fim <= e.hora_inicio) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_fim'],
        message: 'O término precisa ser depois do início.',
      })
    }
  })
  .transform(({ data, hora_inicio, hora_fim, ...evento }) => ({
    ...evento,
    inicio: instanteSaoPaulo(data, hora_inicio).toISOString(),
    fim: instanteSaoPaulo(data, hora_fim).toISOString(),
  }))

export type EventoInput = z.output<typeof eventoSchema>

export const CAMPOS_EVENTO = [
  'cliente_id',
  'negociacao_id',
  'usuario_id',
  'tipo',
  'titulo',
  'descricao',
  'data',
  'hora_inicio',
  'hora_fim',
] as const

export type CampoEvento = (typeof CAMPOS_EVENTO)[number]

export const statusEventoSchema = z.enum(STATUS_EVENTO)
