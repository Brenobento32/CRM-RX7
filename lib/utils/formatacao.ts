import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'

export const FUSO_HORARIO = 'America/Sao_Paulo'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarMoeda(valor: number): string {
  return moeda.format(valor)
}

const NBSP = ' '
/** Da menor para a maior; abaixo de mil não há sufixo. */
const ESCALAS_COMPACTAS = [
  { base: 1e3, sufixo: 'mil' },
  { base: 1e6, sufixo: 'mi' },
  { base: 1e9, sufixo: 'bi' },
  { base: 1e12, sufixo: 'tri' },
] as const

/** Uma casa decimal, arredondando para cima no meio (1,05 → 1,1), sem ruído de ponto flutuante. */
function arredondarUmaCasa(n: number): number {
  return Math.round(Number((n * 10).toPrecision(12))) / 10
}

/** 1234.5 → "1.234,5"; 12 → "12" (sem zero à direita). */
function numeroPtBr(n: number): string {
  const [inteiro, decimal] = n.toFixed(1).split('.')
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decimal === '0' ? agrupado : `${agrupado},${decimal}`
}

/**
 * "R$ 1,2 mi" — para totais e indicadores, onde o espaço é curto.
 *
 * Montado à mão, sem `Intl` com `notation: 'compact'`: esse formato vem dos
 * dados de ICU/CLDR de cada ambiente, e o Node do servidor e o navegador
 * divergiam ("R$ 0,0" × "R$ 0"), quebrando a hidratação de componentes de
 * cliente. Aqui o texto é idêntico no SSR e no browser. Regras (as do pt-BR):
 * até uma casa decimal sem zero à direita, sufixos mil/mi/bi/tri, espaço
 * inseparável, sinal antes do "R$" e promoção de escala quando o
 * arredondamento chega a mil (999.950 → "R$ 1 mi").
 */
export function formatarMoedaCompacta(valor: number): string {
  if (!Number.isFinite(valor)) return formatarMoeda(valor)
  const abs = Math.abs(valor)

  // Sobe de escala enquanto o valor arredondado chegar a mil (na maior, "tri", fica).
  let n = arredondarUmaCasa(abs)
  let sufixo = ''
  for (const escala of ESCALAS_COMPACTAS) {
    if (n < 1000) break
    n = arredondarUmaCasa(abs / escala.base)
    sufixo = escala.sufixo
  }

  // "-R$ 0" não faz sentido: só mostra o sinal se sobrar algo depois de arredondar.
  const sinal = valor < 0 && n !== 0 ? '-' : ''
  return `${sinal}R$${NBSP}${numeroPtBr(n)}${sufixo ? `${NBSP}${sufixo}` : ''}`
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
