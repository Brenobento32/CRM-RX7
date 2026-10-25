import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'

import { diaEmSaoPaulo, FUSO_HORARIO, hojeSaoPaulo, instanteSaoPaulo, somarDias } from '@/lib/utils/formatacao'
import { diaDaSemanaIso, somarMeses } from '@/lib/utils/recorrencia'

/**
 * Visões e janelas da Agenda 2.0 N3 — só cálculo de datas e leiaute, sem
 * acesso a dados. A semana começa na segunda-feira em todo o módulo, para
 * bater com `diaDaSemanaIso`/`expandirRecorrencia` (a mesma "semana" da
 * recorrência é a mostrada na grade).
 */

export const VISOES = ['dia', 'semana', 'mes', 'lista'] as const
export type Visao = (typeof VISOES)[number]

export const VISAO_PADRAO: Visao = 'semana'

export const ROTULO_VISAO: Record<Visao, string> = {
  dia: 'Dia',
  semana: 'Semana',
  mes: 'Mês',
  lista: 'Lista',
}

export function visaoValida(v: unknown): v is Visao {
  return typeof v === 'string' && (VISOES as readonly string[]).includes(v)
}

const REGEX_USER_AGENT_MOBILE = /iPhone|iPod|Windows Phone|Android.*Mobile/i

/**
 * Visão inicial quando a URL não pede uma explicitamente: Semana no desktop,
 * Dia no celular — decidido no servidor pelo User-Agent, sem JS e sem
 * flash de conteúdo trocando de visão após a hidratação. É uma heurística:
 * tablets ambíguos (ex.: iPad, que se reporta como Mac no Safari moderno)
 * caem no padrão desktop.
 */
export function visaoPadraoInicial(userAgent: string): Visao {
  return REGEX_USER_AGENT_MOBILE.test(userAgent) ? 'dia' : VISAO_PADRAO
}

/** Quantos dias a visão Lista mostra a partir da data de referência. */
export const DIAS_LISTA = 30

function meioDiaUtc(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`)
}

/** Segunda-feira (AAAA-MM-DD) da semana que contém `dia`. */
export function segundaDaSemana(dia: string): string {
  return somarDias(dia, -(diaDaSemanaIso(dia) - 1))
}

function diasEntre(inicio: string, quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => somarDias(inicio, i))
}

export type Janela = {
  /** Primeiro dia da janela — usado para buscar no banco (AAAA-MM-DD). */
  inicio: string
  /** Último dia da janela, inclusive (AAAA-MM-DD). */
  fim: string
  /** Um dia por coluna da grade. Vazio na Lista, que agrupa pelos próprios eventos. */
  dias: string[]
}

/** Janela de dias de cada visão, a partir da data de referência da URL. */
export function janelaDaVisao(visao: Visao, dia: string): Janela {
  switch (visao) {
    case 'dia':
      return { inicio: dia, fim: dia, dias: [dia] }
    case 'semana': {
      const inicio = segundaDaSemana(dia)
      return { inicio, fim: somarDias(inicio, 6), dias: diasEntre(inicio, 7) }
    }
    case 'mes': {
      // Grade de 6 semanas (42 dias) cobrindo o mês, com dias de padding dos
      // meses vizinhos para fechar as semanas — cada semana também começa na segunda.
      const primeiro = `${dia.slice(0, 7)}-01`
      const inicio = segundaDaSemana(primeiro)
      return { inicio, fim: somarDias(inicio, 41), dias: diasEntre(inicio, 42) }
    }
    case 'lista':
      return { inicio: dia, fim: somarDias(dia, DIAS_LISTA - 1), dias: [] }
  }
}

/** Data de referência anterior/próxima ao navegar numa visão. */
export function navegar(visao: Visao, dia: string, direcao: -1 | 1): string {
  switch (visao) {
    case 'dia':
      return somarDias(dia, direcao)
    case 'semana':
      return somarDias(dia, 7 * direcao)
    case 'mes':
      return somarMeses(dia, direcao)
    case 'lista':
      return somarDias(dia, DIAS_LISTA * direcao)
  }
}

/** Título do período mostrado na barra de navegação. */
export function tituloPeriodo(visao: Visao, dia: string, janela: Janela): string {
  const f = (d: string, fmt: string) => formatInTimeZone(meioDiaUtc(d), 'UTC', fmt, { locale: ptBR })

  switch (visao) {
    case 'dia':
      return f(dia, "EEEE, d 'de' MMMM 'de' yyyy")
    case 'mes':
      return f(`${dia.slice(0, 7)}-01`, "MMMM 'de' yyyy")
    case 'lista':
      return `A partir de ${f(dia, "d 'de' MMMM")}`
    case 'semana': {
      const mesmoMes = janela.inicio.slice(0, 7) === janela.fim.slice(0, 7)
      const mesmoAno = janela.inicio.slice(0, 4) === janela.fim.slice(0, 4)
      const inicio = f(janela.inicio, mesmoMes ? 'd' : "d 'de' MMM")
      const fim = f(janela.fim, mesmoAno ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy")
      return `${inicio} – ${fim}`
    }
  }
}

/** Parâmetros que a URL da Agenda preserva entre visões, navegação e filtro. */
export type ParametrosAgenda = {
  visao: Visao
  dia: string
  usuario?: string
  evento?: string
  /** Abre o modal "Nova reunião" (com `hora` vinda do horário clicado). */
  nova?: boolean
  hora?: string
  /** Abre o modal de edição da reunião. */
  editar?: string
}

/** Assinatura do closure que as páginas passam para os componentes de calendário montarem links. */
export type LinkAgenda = (params: Partial<ParametrosAgenda>) => string

/**
 * Monta `/agenda?...` só com o que diverge do padrão (visão padrão e hoje
 * ficam implícitos), para o link de "hoje" continuar limpo — mesma ideia do
 * `hrefDia` que a página já usava antes da N3.
 */
export function hrefAgenda(params: ParametrosAgenda, padrao: { visao: Visao; hoje: string }): string {
  const qs = new URLSearchParams()
  if (params.visao !== padrao.visao) qs.set('visao', params.visao)
  if (params.dia !== padrao.hoje) qs.set('dia', params.dia)
  if (params.usuario) qs.set('usuario', params.usuario)
  if (params.evento) qs.set('evento', params.evento)
  if (params.nova) qs.set('nova', '1')
  if (params.nova && params.hora) qs.set('hora', params.hora)
  if (params.editar) qs.set('editar', params.editar)
  const s = qs.toString()
  return s ? `/agenda?${s}` : '/agenda'
}

/** Minutos desde a meia-noite de `diaReferencia` (fuso de São Paulo) até `iso`. */
export function minutosNoDia(iso: string, diaReferencia: string): number {
  const inicioDoDia = instanteSaoPaulo(diaReferencia)
  return Math.round((new Date(iso).getTime() - inicioDoDia.getTime()) / 60_000)
}

/** Minutos desde a meia-noite de hoje (São Paulo) até agora — para a linha do horário atual. */
export function minutosAgora(): number {
  const hhmm = formatInTimeZone(new Date(), FUSO_HORARIO, 'HH:mm')
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export type IntervaloComId = { id: string; inicio: string; fim: string }
export type LeiauteEvento = { id: string; coluna: number; colunas: number }

/**
 * Posição em colunas de eventos que se sobrepõem no tempo — mesma ideia usada
 * por agendas como Google Calendar/Outlook: agrupa em clusters de eventos
 * mutuamente conectados por horário e empacota cada cluster nas colunas
 * necessárias (primeira coluna livre; nunca reduz o nº de colunas do cluster).
 */
export function organizarSobrepostos(eventos: IntervaloComId[]): LeiauteEvento[] {
  const nos = [...eventos]
    .map((e) => ({ ...e, inicioMs: Date.parse(e.inicio), fimMs: Date.parse(e.fim) }))
    .sort((a, b) => a.inicioMs - b.inicioMs || b.fimMs - a.fimMs)

  const clusters: (typeof nos)[] = []
  let atual: typeof nos = []
  let fimClusterMs = -Infinity

  for (const n of nos) {
    if (atual.length > 0 && n.inicioMs >= fimClusterMs) {
      clusters.push(atual)
      atual = []
      fimClusterMs = -Infinity
    }
    atual.push(n)
    fimClusterMs = Math.max(fimClusterMs, n.fimMs)
  }
  if (atual.length > 0) clusters.push(atual)

  const leiaute: LeiauteEvento[] = []
  for (const cluster of clusters) {
    const fimPorColuna: number[] = []
    const colunaPorId = new Map<string, number>()

    for (const n of cluster) {
      let coluna = fimPorColuna.findIndex((fim) => fim <= n.inicioMs)
      if (coluna === -1) {
        coluna = fimPorColuna.length
        fimPorColuna.push(n.fimMs)
      } else {
        fimPorColuna[coluna] = n.fimMs
      }
      colunaPorId.set(n.id, coluna)
    }

    const colunas = fimPorColuna.length
    for (const n of cluster) leiaute.push({ id: n.id, coluna: colunaPorId.get(n.id)!, colunas })
  }

  return leiaute
}

/** Agrupa eventos pelo dia (AAAA-MM-DD, São Paulo) em que começam. */
export function agruparPorDia<T extends { inicio: string }>(eventos: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const e of eventos) {
    const dia = diaEmSaoPaulo(e.inicio)
    const lista = mapa.get(dia)
    if (lista) lista.push(e)
    else mapa.set(dia, [e])
  }
  return mapa
}

/** Atalho usado pelas páginas: hoje de São Paulo, para comparar com `dia`. */
export function ehHoje(dia: string): boolean {
  return dia === hojeSaoPaulo()
}

/**
 * Novo horário de início (minutos desde a meia-noite) ao soltar um evento
 * arrastado verticalmente: o deslocamento em pixels vira minutos, encaixa em
 * intervalos de 15 e fica dentro do mesmo dia — a duração nunca muda aqui,
 * quem chama preserva `duracaoMinutos` e só desloca o início.
 */
export function novoInicioAoArrastar(
  minutoOriginal: number,
  duracaoMinutos: number,
  deltaYPx: number,
  alturaHoraPx: number,
): number {
  const deltaMin = (deltaYPx / alturaHoraPx) * 60
  const encaixado = Math.round((minutoOriginal + deltaMin) / 15) * 15
  const maximo = Math.max(1440 - duracaoMinutos, 0)
  return Math.min(Math.max(encaixado, 0), maximo)
}

/** Minutos desde a meia-noite (0–1439) formatados como "HH:mm". */
export function minutosParaHora(minutos: number): string {
  const m = Math.min(Math.max(Math.round(minutos), 0), 1439)
  const h = Math.floor(m / 60)
  const r = m % 60
  return `${String(h).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
