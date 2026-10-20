import type { ResumoFunil } from '@/lib/utils/funil-metricas'
import { alturaBarraResultado } from '@/lib/utils/painel-metricas'

import { IconeBarras } from './icones-metricas'

const ALTURA_MAXIMA = 240
/** Linhas de grade horizontais discretas, em frações da altura máxima — só decoração, nenhum dado. */
const LINHAS_GRADE = [0.25, 0.5, 0.75]

/**
 * Painel "Resultados do período" — Novos (coorte: negociações criadas no
 * período) vs. Ganhos (fechamentos válidos, `anulado_em is null`, no
 * período), do funil selecionado. Os dois números já vêm prontos de
 * `MetricasFunil.resumo` (`totalEntraram`/`ganhos`, mesmos usados pela
 * tabela detalhada) — este componente só decide a ALTURA visual da barra
 * (`alturaBarraResultado`, pura), nunca recalcula nenhuma contagem.
 *
 * CSS puro (nenhuma biblioteca de gráfico): duas barras verticais, número
 * sobre cada uma, legenda abaixo, estado zero legível (barra na altura
 * mínima, número "0" visível).
 */
export function ResultadosPeriodo({
  resumo,
  funilNome,
  periodoLabel,
}: {
  resumo: ResumoFunil
  funilNome: string
  /** Período de análise já formatado (ex.: "01/10/2026 → 20/10/2026") — só exibição, nunca recalculado aqui. */
  periodoLabel: string
}) {
  const maior = Math.max(resumo.totalEntraram, resumo.ganhos)
  const barras = [
    {
      chave: 'novos',
      rotulo: 'Novos',
      valor: resumo.totalEntraram,
      cor: 'bg-sky-500 dark:bg-sky-400',
      detalhe: 'Negociações criadas no período (coorte)',
    },
    {
      chave: 'ganhos',
      rotulo: 'Ganhos',
      valor: resumo.ganhos,
      cor: 'bg-emerald-500 dark:bg-emerald-400',
      detalhe: 'Fechamentos válidos (não anulados) no período',
    },
  ] as const

  return (
    <section
      aria-label="Resultados do período"
      className="flex min-h-[460px] flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-zinc-800 dark:text-zinc-200">
            <IconeBarras className="size-4 text-zinc-400" />
            Resultados do período
          </h2>
          <p className="text-xs text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{funilNome}</span> — {periodoLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
          {barras.map((b) => (
            <span key={b.chave} className="flex items-center gap-1.5" title={b.detalhe}>
              <span aria-hidden className={`size-2 rounded-full ${b.cor}`} />
              {b.rotulo}
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex flex-1 items-end justify-center gap-16">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: ALTURA_MAXIMA }}>
          {LINHAS_GRADE.map((f) => (
            <div
              key={f}
              className="absolute inset-x-0 border-t border-dashed border-zinc-200 dark:border-zinc-800"
              style={{ bottom: ALTURA_MAXIMA * f }}
            />
          ))}
        </div>
        {barras.map((b) => (
          <div key={b.chave} className="relative z-10 flex flex-col items-center gap-2" title={`${b.rotulo}: ${b.detalhe}`}>
            <span className="text-2xl font-bold tabular-nums">{b.valor}</span>
            <div
              role="img"
              aria-label={`${b.rotulo}: ${b.valor}. ${b.detalhe}`}
              className={`w-24 rounded-t-md transition-[height] ${b.cor}`}
              style={{ height: alturaBarraResultado(b.valor, maior, ALTURA_MAXIMA) }}
            />
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{b.rotulo}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
