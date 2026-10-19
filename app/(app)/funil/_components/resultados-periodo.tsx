import type { ResumoFunil } from '@/lib/utils/funil-metricas'
import { alturaBarraResultado } from '@/lib/utils/painel-metricas'

const ALTURA_MAXIMA = 120

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
export function ResultadosPeriodo({ resumo, funilNome }: { resumo: ResumoFunil; funilNome: string }) {
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
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Resultados do período</h2>
        <p className="text-xs text-zinc-500">
          Funil selecionado — <span className="font-medium text-zinc-700 dark:text-zinc-300">{funilNome}</span>, período de
          análise.
        </p>
      </div>

      <div className="flex flex-1 items-end justify-center gap-10 pt-2">
        {barras.map((b) => (
          <div key={b.chave} className="flex flex-col items-center gap-1.5" title={`${b.rotulo}: ${b.detalhe}`}>
            <span className="text-xl font-semibold tabular-nums">{b.valor}</span>
            <div
              role="img"
              aria-label={`${b.rotulo}: ${b.valor}. ${b.detalhe}`}
              className={`w-16 rounded-t-md transition-[height] ${b.cor}`}
              style={{ height: alturaBarraResultado(b.valor, maior, ALTURA_MAXIMA) }}
            />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{b.rotulo}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-4 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
        {barras.map((b) => (
          <span key={b.chave} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${b.cor}`} />
            {b.detalhe}
          </span>
        ))}
      </div>
    </section>
  )
}
