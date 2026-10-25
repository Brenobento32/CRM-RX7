import { z } from 'zod'

import { Constants, type Database } from '@/lib/types/database'
import { instanteSaoPaulo } from '@/lib/utils/formatacao'
import {
  diaDaSemanaIso,
  diaDoMes,
  limiteDoTermino,
  MAX_OCORRENCIAS,
  type Frequencia,
} from '@/lib/utils/recorrencia'

type Enums = Database['public']['Enums']

export type TipoEvento = Enums['tipo_evento']
export type StatusEvento = Enums['status_evento']

export const TIPOS_EVENTO = Constants.public.Enums.tipo_evento
export const STATUS_EVENTO = Constants.public.Enums.status_evento

export const ROTULO_TIPO_EVENTO: Record<TipoEvento, string> = {
  reuniao: 'Reunião comercial',
  ligacao: 'Ligação',
  followup: 'Follow-up',
  apresentacao: 'Apresentação',
  outro: 'Outro',
}

export const ROTULO_STATUS_EVENTO: Record<StatusEvento, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  nao_compareceu: 'Não compareceu',
  cancelado: 'Cancelado',
}

/**
 * Tipos oferecidos no formulário. `apresentacao` ficou só para o histórico:
 * aparece apenas ao editar um evento que já é desse tipo.
 */
export const TIPOS_FORMULARIO = ['reuniao', 'ligacao', 'followup', 'outro'] as const satisfies readonly TipoEvento[]

/** Compromisso ainda por acontecer: aparece em "próximos" e "aguardando status". */
export const STATUS_EM_ABERTO = ['agendado', 'confirmado'] as const satisfies readonly StatusEvento[]

export function statusEmAberto(status: StatusEvento): boolean {
  return (STATUS_EM_ABERTO as readonly StatusEvento[]).includes(status)
}

export const statusEventoSchema = z.enum(STATUS_EVENTO)

// ---------------------------------------------------------------------------
// Formulário de evento (criar e editar).
// ---------------------------------------------------------------------------

export const DURACOES = ['15', '30', '45', '60', '90', '120', 'personalizado'] as const
export type Duracao = (typeof DURACOES)[number]

export const ROTULO_DURACAO: Record<Duracao, string> = {
  '15': '15 min',
  '30': '30 min',
  '45': '45 min',
  '60': '1h',
  '90': '1h30',
  '120': '2h',
  personalizado: 'Personalizada',
}

export const RECORRENCIAS = ['nenhuma', 'diaria', 'semanal', 'mensal', 'personalizada'] as const
export type Recorrencia = (typeof RECORRENCIAS)[number]

export const ROTULO_RECORRENCIA: Record<Recorrencia, string> = {
  nenhuma: 'Não repetir',
  diaria: 'Diária',
  semanal: 'Semanal',
  mensal: 'Mensal',
  personalizada: 'Personalizada',
}

export const UNIDADES = ['dias', 'semanas', 'meses'] as const
export type Unidade = (typeof UNIDADES)[number]

const FREQUENCIA_DA_UNIDADE: Record<Unidade, Frequencia> = {
  dias: 'diaria',
  semanas: 'semanal',
  meses: 'mensal',
}

export const ESCOPOS = ['este', 'seguintes', 'todos'] as const
export type Escopo = (typeof ESCOPOS)[number]

export const ROTULO_ESCOPO: Record<Escopo, string> = {
  este: 'Somente este',
  seguintes: 'Este e os seguintes',
  todos: 'Todos em aberto',
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

function minutos(hora: string) {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

const uuidOpcional = (mensagem: string) =>
  z
    .string()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.uuid(mensagem).nullable())

const inteiro = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : NaN)

/**
 * Entrada crua do formulário (tudo string, como vem do FormData). A regra de
 * recorrência só é conferida quando há recorrência; o escopo só existe na
 * edição de evento de série.
 */
const entradaSchema = z.object({
  /** Opcional: a reunião da agenda nativa não exige cliente (reuniões antigas mantêm o delas). */
  cliente_id: uuidOpcional('Cliente inválido.').default(null),
  negociacao_id: uuidOpcional('Negociação inválida.'),
  usuario_id: uuidOpcional('Responsável inválido.'),
  tipo: z.enum(TIPOS_EVENTO, 'Selecione o tipo.').default('reuniao'),
  /** Tipo do evento antes da edição: libera `apresentacao` no histórico. */
  tipo_original: z.string().default(''),
  titulo: z.string().trim().min(1, 'Informe o título.').max(200, 'Máximo de 200 caracteres.'),
  descricao: z
    .string()
    .trim()
    .max(5000, 'Máximo de 5000 caracteres.')
    .transform((v) => (v === '' ? null : v)),
  status: z.enum(STATUS_EM_ABERTO, 'Escolha agendado ou confirmado.').default('agendado'),
  data: z.iso.date('Informe a data.'),
  hora_inicio: z.string().regex(HORA, 'Informe a hora de início.'),
  duracao: z.enum(DURACOES, 'Escolha a duração.'),
  hora_fim: z.string().default(''),
  recorrencia: z.enum(RECORRENCIAS, 'Escolha a repetição.').default('nenhuma'),
  intervalo: z.string().default('1'),
  unidade: z.string().default('semanas'),
  dias_semana: z.array(z.string()).default([]),
  dia_mes: z.string().default(''),
  termino: z.string().default('data'),
  termina_em: z.string().default(''),
  ocorrencias: z.string().default(''),
  escopo: z.enum(ESCOPOS, 'Escolha a quais eventos aplicar.').default('este'),
})

export type SerieInput = {
  frequencia: Frequencia
  intervalo: number
  dias_semana: number[] | null
  dia_mes: number | null
  termina_em: string | null
  ocorrencias: number | null
}

export const eventoFormSchema = entradaSchema
  .superRefine((e, ctx) => {
    const falha = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

    if (e.tipo === 'apresentacao' && e.tipo_original !== 'apresentacao') {
      falha('tipo', 'Selecione o tipo.')
    }

    // Duração: nunca atravessa a meia-noite (o evento é de um dia só).
    if (e.duracao === 'personalizado') {
      if (!HORA.test(e.hora_fim)) falha('hora_fim', 'Informe a hora de término.')
      else if (minutos(e.hora_fim) <= minutos(e.hora_inicio)) {
        falha('hora_fim', 'O término precisa ser depois do início, no mesmo dia.')
      }
    } else if (minutos(e.hora_inicio) + Number(e.duracao) > 24 * 60) {
      falha('duracao', 'Com essa duração o compromisso passaria da meia-noite.')
    }

    if (e.recorrencia === 'nenhuma') return

    if (e.recorrencia === 'personalizada') {
      const intervalo = inteiro(e.intervalo)
      if (!(intervalo >= 1 && intervalo <= 99)) falha('intervalo', 'Use um intervalo de 1 a 99.')
      if (!(UNIDADES as readonly string[]).includes(e.unidade)) falha('unidade', 'Escolha dias, semanas ou meses.')
      if (e.unidade === 'semanas') {
        const dias = e.dias_semana.map(Number)
        if (dias.length === 0 || dias.some((d) => !(d >= 1 && d <= 7))) {
          falha('dias_semana', 'Escolha pelo menos um dia da semana.')
        }
      }
      if (e.unidade === 'meses') {
        const dia = inteiro(e.dia_mes)
        if (!(dia >= 1 && dia <= 31)) falha('dia_mes', 'Use um dia de 1 a 31.')
      }
    }

    if (e.termino === 'data') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.termina_em)) falha('termina_em', 'Informe quando a repetição termina.')
      else if (e.termina_em < e.data) falha('termina_em', 'O término precisa ser depois da primeira data.')
      else if (e.termina_em > limiteDoTermino(e.data)) {
        falha('termina_em', 'A repetição pode durar no máximo 12 meses.')
      }
    } else if (e.termino === 'ocorrencias') {
      const n = inteiro(e.ocorrencias)
      if (!(n >= 1 && n <= MAX_OCORRENCIAS)) falha('ocorrencias', `Use de 1 a ${MAX_OCORRENCIAS} ocorrências.`)
    } else {
      falha('termino', 'Escolha como a repetição termina.')
    }
  })
  .transform((e) => {
    const duracaoMinutos =
      e.duracao === 'personalizado' ? minutos(e.hora_fim) - minutos(e.hora_inicio) : Number(e.duracao)
    const inicio = instanteSaoPaulo(e.data, e.hora_inicio)

    let serie: SerieInput | null = null
    if (e.recorrencia !== 'nenhuma') {
      const termino = {
        termina_em: e.termino === 'data' ? e.termina_em : null,
        ocorrencias: e.termino === 'ocorrencias' ? Number(e.ocorrencias) : null,
      }
      const frequencia: Frequencia =
        e.recorrencia === 'personalizada' ? FREQUENCIA_DA_UNIDADE[e.unidade as Unidade] : e.recorrencia
      serie = {
        frequencia,
        intervalo: e.recorrencia === 'personalizada' ? Number(e.intervalo) : 1,
        // Atalhos usam o dia da própria data escolhida.
        dias_semana:
          frequencia !== 'semanal'
            ? null
            : e.recorrencia === 'personalizada'
              ? [...new Set(e.dias_semana.map(Number))].sort((a, b) => a - b)
              : [diaDaSemanaIso(e.data)],
        dia_mes:
          frequencia !== 'mensal' ? null : e.recorrencia === 'personalizada' ? Number(e.dia_mes) : diaDoMes(e.data),
        ...termino,
      }
    }

    return {
      evento: {
        cliente_id: e.cliente_id,
        negociacao_id: e.negociacao_id,
        usuario_id: e.usuario_id,
        tipo: e.tipo,
        titulo: e.titulo,
        descricao: e.descricao,
        status: e.status,
        data: e.data,
        hora_inicio: e.hora_inicio,
        duracao_minutos: duracaoMinutos,
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + duracaoMinutos * 60_000).toISOString(),
      },
      serie,
      escopo: e.escopo,
    }
  })

export type EventoForm = z.output<typeof eventoFormSchema>
export type EventoInput = EventoForm['evento']

/** Campos com mensagem de erro própria no formulário. */
export const CAMPOS_EVENTO = [
  'cliente_id',
  'negociacao_id',
  'usuario_id',
  'tipo',
  'tipo_original',
  'titulo',
  'descricao',
  'status',
  'data',
  'hora_inicio',
  'duracao',
  'hora_fim',
  'recorrencia',
  'intervalo',
  'unidade',
  'dia_mes',
  'termino',
  'termina_em',
  'ocorrencias',
  'escopo',
] as const

export type CampoEvento = (typeof CAMPOS_EVENTO)[number] | 'dias_semana'

/** Valores crus do formulário (o que volta a ele quando a gravação falha). */
export type ValoresEvento = Partial<Record<(typeof CAMPOS_EVENTO)[number], string>> & {
  dias_semana?: string[]
}
