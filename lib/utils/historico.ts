import type { CorEtapa } from '@/lib/utils/etapas'

/** Uma linha de `historico_etapas`, já com nome/cor das etapas e nome do usuário. */
export type LinhaHistoricoBruta = {
  id: number
  etapaNome: string
  etapaCor: CorEtapa
  usuarioNome: string | null
  /** ISO 8601 — `historico_etapas.created_at`. */
  criadoEm: string
}

export type EntradaHistorico = LinhaHistoricoBruta & {
  /** Igual a `criadoEm` — quando a negociação entrou nesta etapa. */
  entrada: string
  /** `criadoEm` da linha seguinte, ou `null` se esta é a etapa atual. */
  saida: string | null
  duracaoMs: number
}

/**
 * `entrada_na_etapa_atual - entrada_na_etapa_anterior` — a mesma lógica já
 * usada em `funil_metricas()` (CTE `estadias`, `lead(created_at) over
 * (partition by negociacao_id order by created_at, id)`), só que calculada
 * em TypeScript sobre o histórico de UMA negociação. `historico_etapas` é
 * append-only e nunca reescreve uma linha, então isso funciona igual para
 * reabertura, `Perdido -> Recuperação`, `Recuperação -> Fechado`, voltar
 * para uma etapa anterior e repetir a mesma etapa várias vezes — cada
 * ocorrência é só mais uma linha na lista, sem tratamento especial.
 *
 * A etapa mais recente (sem "próxima" linha) tem `saida = null` e a duração
 * é `agora - entrada`.
 */
export function montarHistorico(linhas: LinhaHistoricoBruta[], agora: number = Date.now()): EntradaHistorico[] {
  const ordenadas = [...linhas].sort(
    (a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id - b.id,
  )

  return ordenadas.map((linha, i) => {
    const proxima = ordenadas[i + 1]
    const saida = proxima ? proxima.criadoEm : null
    const fimMs = saida ? new Date(saida).getTime() : agora
    const duracaoMs = Math.max(0, fimMs - new Date(linha.criadoEm).getTime())

    return { ...linha, entrada: linha.criadoEm, saida, duracaoMs }
  })
}

/**
 * `123 000` ms → `"2d 5h20"` (dias e horas só aparecem quando > 0).
 * Nome distinto de `formatarDuracao` (lib/utils/formatacao.ts, que recebe
 * segundos e usa outro estilo — "2,1 dias") de propósito, pra não confundir
 * unidade nem formato entre os dois.
 */
export function formatarDuracaoHistorico(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000))
  const dias = Math.floor(totalMin / 1440)
  const horas = Math.floor((totalMin % 1440) / 60)
  const min = totalMin % 60

  if (dias > 0) return `${dias}d ${horas}h${String(min).padStart(2, '0')}`
  if (horas > 0) return `${horas}h${String(min).padStart(2, '0')}`
  return `${min}min`
}
