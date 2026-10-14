import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'

export const FUSO_HORARIO = 'America/Sao_Paulo'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatarMoeda(valor: number): string {
  return moeda.format(valor)
}

/** "R$ 1,2 mi" — para totais de coluna, onde o espaço é curto. */
export function formatarMoedaCompacta(valor: number): string {
  return moedaCompacta.format(valor)
}

/**
 * Datas sempre no fuso de São Paulo, no servidor e no browser. Formatar no
 * fuso local geraria texto diferente entre SSR e hidratação.
 */
export function formatarDataHora(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, "dd/MM 'às' HH:mm", { locale: ptBR })
}

export function formatarData(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, 'dd/MM/yyyy', { locale: ptBR })
}

export function formatarDataHoraCompleta(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

/**
 * "hoje, 10:30" quando `iso` cai no dia de hoje em São Paulo; senão
 * `formatarDataHora` ("dd/MM às HH:mm") — usado no card do Kanban (última
 * atividade), onde "hoje" é mais rápido de ler do que a data completa.
 */
export function formatarDataRelativaHora(iso: string): string {
  return diaEmSaoPaulo(iso) === hojeSaoPaulo() ? `hoje, ${formatarHora(iso)}` : formatarDataHora(iso)
}

/** Hoje em São Paulo, no formato de `<input type="date">` (AAAA-MM-DD). */
export function hojeSaoPaulo(): string {
  return formatInTimeZone(new Date(), FUSO_HORARIO, 'yyyy-MM-dd')
}

/** Amanhã em São Paulo, mesmo formato de {@link hojeSaoPaulo}. */
export function amanhaSaoPaulo(): string {
  return formatInTimeZone(addDays(new Date(), 1), FUSO_HORARIO, 'yyyy-MM-dd')
}

/** Agora em São Paulo, no formato de `<input type="datetime-local">`. */
export function agoraSaoPauloLocal(): string {
  return formatInTimeZone(new Date(), FUSO_HORARIO, "yyyy-MM-dd'T'HH:mm")
}

/**
 * Formata uma coluna `date` (AAAA-MM-DD). Não passa por `Date`: "2026-09-23"
 * seria lido como meia-noite UTC e viraria dia 22 em São Paulo.
 */
export function formatarDia(dia: string, comAno = true): string {
  const [ano, mes, d] = dia.split('-')
  return comAno ? `${d}/${mes}/${ano}` : `${d}/${mes}`
}

/** Hora "HH:mm" em São Paulo. */
export function formatarHora(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, 'HH:mm')
}

/**
 * Dias como AAAA-MM-DD. O meio-dia UTC garante o mesmo dia em qualquer fuso
 * do servidor, então somar e formatar não escorrega para o dia vizinho.
 */
function meioDiaUtc(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`)
}

export function diaValido(dia: unknown): dia is string {
  return (
    typeof dia === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(dia) &&
    meioDiaUtc(dia).toISOString().startsWith(dia)
  )
}

export function somarDias(dia: string, dias: number): string {
  return addDays(meioDiaUtc(dia), dias).toISOString().slice(0, 10)
}

/** "terça-feira, 23 de setembro" */
export function formatarDiaExtenso(dia: string): string {
  return formatInTimeZone(meioDiaUtc(dia), 'UTC', "EEEE, d 'de' MMMM", { locale: ptBR })
}

/** Dia (AAAA-MM-DD) do instante `iso`, em São Paulo. */
export function diaEmSaoPaulo(iso: string): string {
  return formatInTimeZone(iso, FUSO_HORARIO, 'yyyy-MM-dd')
}

/** Instante UTC de "dia às hora" no horário de São Paulo. */
export function instanteSaoPaulo(dia: string, hora = '00:00'): Date {
  return fromZonedTime(`${dia}T${hora}:00`, FUSO_HORARIO)
}

const percentual = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

/** 0.4231 → "42,3%" */
export function formatarPercentual(fracao: number): string {
  return percentual.format(fracao)
}

/** Primeiro dia do mês (AAAA-MM-01) → "set/26". */
export function formatarMes(mes: string): string {
  return formatInTimeZone(meioDiaUtc(mes), 'UTC', 'MMM/yy', { locale: ptBR })
}

/** Tamanho de arquivo em bytes → "512 B", "320 KB", "1,4 MB". */
export function formatarTamanhoArquivo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`
  const mb = kb / 1024
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/**
 * Milissegundos desde a entrada na etapa atual → "Parado há 10 min" / "Parado
 * há 1h" / "Parado há 2 dias" — card do Kanban. Unidade (ms) e arredondamento
 * (sempre para baixo, mínimo "1 min") são propositalmente diferentes de
 * `formatarDuracao` (segundos, "3,2 dias") e `formatarDuracaoHistorico`
 * (lib/utils/historico.ts, "2d 5h20") — cada um serve um lugar diferente do
 * CRM, não reaproveitar entre eles.
 */
export function formatarTempoParado(ms: number): string {
  const minutos = Math.floor(Math.max(0, ms) / 60_000)
  if (minutos < 60) return `Parado há ${Math.max(minutos, 1)} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `Parado há ${horas}h`

  const dias = Math.floor(horas / 24)
  return `Parado há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
}

/** Duração em segundos → "menos de 1 h", "5 h", "3,2 dias". */
export function formatarDuracao(segundos: number): string {
  const horas = segundos / 3600
  if (horas < 1) return 'menos de 1 h'
  if (horas < 24) return `${Math.round(horas)} h`
  const dias = horas / 24
  return `${dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${dias < 1.05 ? 'dia' : 'dias'}`
}
