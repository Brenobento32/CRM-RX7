import { percentualMeta } from '@/lib/dal/metas'
import type { RealizadoFunil } from '@/lib/dal/funil-metricas'
import { ticketMedio, type MetaPeriodo } from '@/lib/utils/financeiro-periodo'
import { formatarData, formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/**
 * TCV/MRR do período — meta (proporcionada às metas mensais, ver
 * `lib/utils/financeiro-periodo.ts#metaProporcionalPeriodo`), realizado
 * (vendas reais do funil+período, `obterRealizadoFunil`) e ticket médio.
 * Nenhum número é calculado aqui além do próprio percentual/ticket médio —
 * ambos funções puras já prontas, só aplicadas ao que a página já buscou.
 *
 * "Meta geral do período" × "Realizado neste funil": a meta nunca é por
 * funil (não existe essa coluna no schema, e não é desta etapa criá-la) —
 * só o realizado é filtrado pelo funil selecionado. Os rótulos deixam isso
 * explícito, nunca sugerindo que a meta "pertence" ao funil.
 */
export function FinanceiroFunil({
  metaPeriodo,
  realizado,
  periodo,
}: {
  metaPeriodo: MetaPeriodo
  realizado: RealizadoFunil
  periodo: { inicio: string; fim: string }
}) {
  const linhas = [
    { chave: 'tcv', titulo: 'TCV', valorMeta: metaPeriodo.tcv, realizado: realizado.tcv, qtd: realizado.tcvQtd },
    { chave: 'mrr', titulo: 'MRR', valorMeta: metaPeriodo.mrr, realizado: realizado.mrr, qtd: realizado.mrrQtd },
  ] as const

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Financeiro do período</h2>
        <p className="text-xs text-zinc-500">
          Meta geral do período ({formatarData(periodo.inicio)} a {formatarData(periodo.fim)}): parcela das
          metas mensais correspondente aos dias selecionados — nunca por funil. Realizado neste funil:
          vendas reais do mesmo período, só deste funil.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {linhas.map((l) => (
          <CardFinanceiro
            key={l.chave}
            titulo={l.titulo}
            valorMeta={l.valorMeta}
            realizado={l.realizado}
            ticketMedio={ticketMedio(l.realizado, l.qtd)}
            percentual={percentualMeta(l.realizado, l.valorMeta)}
          />
        ))}
      </div>
    </section>
  )
}

function CardFinanceiro({
  titulo,
  valorMeta,
  realizado,
  ticketMedio: ticket,
  percentual,
}: {
  titulo: string
  valorMeta: number | null
  realizado: number
  ticketMedio: number | null
  percentual: number | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <CirculoProgresso percentual={percentual} />
      <div className="min-w-40 flex-1 space-y-1.5">
        <p className="font-semibold">{titulo}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500">Meta geral do período</dt>
          <dd className="text-right tabular-nums">
            {valorMeta === null ? <span className="text-zinc-400">Não definida</span> : formatarMoeda(valorMeta)}
          </dd>
          <dt className="text-zinc-500">Realizado neste funil</dt>
          <dd className="text-right font-medium tabular-nums">{formatarMoeda(realizado)}</dd>
          <dt className="text-zinc-500">Ticket médio</dt>
          <dd className="text-right tabular-nums">
            {ticket === null ? <span className="text-zinc-400">—</span> : formatarMoeda(ticket)}
          </dd>
        </dl>
      </div>
    </div>
  )
}

/** Progresso circular, SVG puro — sem biblioteca nova. `null` = "—" (sem meta, nunca 0% enganoso). */
function CirculoProgresso({ percentual, tamanho = 76 }: { percentual: number | null; tamanho?: number }) {
  const raio = (tamanho - 10) / 2
  const circunferencia = 2 * Math.PI * raio
  const fracao = percentual === null ? 0 : Math.min(Math.max(percentual, 0), 1)
  const offset = circunferencia * (1 - fracao)
  const atingida = percentual !== null && percentual >= 1
  const centro = tamanho / 2

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox={`0 0 ${tamanho} ${tamanho}`}
      role="img"
      aria-label={percentual === null ? 'Atingido: não aplicável' : `Atingido: ${formatarPercentual(percentual)}`}
      className="shrink-0"
    >
      <circle cx={centro} cy={centro} r={raio} fill="none" strokeWidth={8} className="stroke-zinc-100 dark:stroke-zinc-800" />
      {percentual !== null && (
        <circle
          cx={centro}
          cy={centro}
          r={raio}
          fill="none"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${centro} ${centro})`}
          className={atingida ? 'stroke-emerald-600 dark:stroke-emerald-500' : 'stroke-zinc-900 dark:stroke-zinc-100'}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-zinc-900 text-sm font-semibold dark:fill-zinc-100"
      >
        {percentual === null ? '—' : formatarPercentual(percentual)}
      </text>
    </svg>
  )
}
