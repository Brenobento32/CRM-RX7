import { percentualMeta, type RealizadoGeral } from '@/lib/dal/metas'
import type { RealizadoFunil } from '@/lib/dal/funil-metricas'
import { ticketMedio, type MetaPeriodo } from '@/lib/utils/financeiro-periodo'
import { formatarData, formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/**
 * TCV/MRR do período — meta (proporcionada às metas mensais, ver
 * `lib/utils/financeiro-periodo.ts#metaProporcionalPeriodo`) contra o
 * realizado de TODOS os funis (`realizadoGeral`, RPC `realizado_periodo`) —
 * nunca o realizado de só o funil selecionado. Esse era um bug real: antes
 * desta correção, o percentual comparava a meta geral/individual (nunca
 * por funil) com o vendido de só o funil selecionado na tela — trocar o
 * funil mudava o "Atingido: X%" sem nenhuma venda ter mudado.
 *
 * O vendido e o ticket médio DESTE funil (`realizadoFunil`) continuam
 * mostrados — são métricas legítimas do funil selecionado (pipeline,
 * conversão, ticket médio) — mas como uma linha SECUNDÁRIA, separada,
 * nunca mais usada para o percentual/círculo de progresso da meta.
 */
export function FinanceiroFunil({
  metaPeriodo,
  realizadoGeral,
  realizadoFunil,
  periodo,
}: {
  metaPeriodo: MetaPeriodo
  realizadoGeral: RealizadoGeral
  realizadoFunil: RealizadoFunil
  periodo: { inicio: string; fim: string }
}) {
  const linhas = [
    {
      chave: 'tcv' as const,
      titulo: 'TCV',
      valorMeta: metaPeriodo.tcv,
      realizadoGeral: realizadoGeral.tcv,
      realizadoFunil: realizadoFunil.tcv,
      qtdFunil: realizadoFunil.tcvQtd,
    },
    {
      chave: 'mrr' as const,
      titulo: 'MRR',
      valorMeta: metaPeriodo.mrr,
      realizadoGeral: realizadoGeral.mrr,
      realizadoFunil: realizadoFunil.mrr,
      qtdFunil: realizadoFunil.mrrQtd,
    },
  ]

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Financeiro do período</h2>
        <p className="text-xs text-zinc-500">
          Meta e realizado ({formatarData(periodo.inicio)} a {formatarData(periodo.fim)}): sempre de TODOS
          os funis — nunca reduzidos ao funil selecionado abaixo. O vendido e o ticket médio deste funil
          aparecem à parte, só como referência deste funil.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {linhas.map((l) => (
          <CardFinanceiro
            key={l.chave}
            titulo={l.titulo}
            valorMeta={l.valorMeta}
            realizadoGeral={l.realizadoGeral}
            percentual={percentualMeta(l.realizadoGeral, l.valorMeta)}
            realizadoFunil={l.realizadoFunil}
            ticketMedioFunil={ticketMedio(l.realizadoFunil, l.qtdFunil)}
          />
        ))}
      </div>
    </section>
  )
}

function CardFinanceiro({
  titulo,
  valorMeta,
  realizadoGeral,
  percentual,
  realizadoFunil,
  ticketMedioFunil,
}: {
  titulo: string
  valorMeta: number | null
  realizadoGeral: number
  percentual: number | null
  realizadoFunil: number
  ticketMedioFunil: number | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <CirculoProgresso percentual={percentual} />
      <div className="min-w-40 flex-1 space-y-1.5">
        <p className="font-semibold">{titulo}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500">Meta (todos os funis)</dt>
          <dd className="text-right tabular-nums">
            {valorMeta === null ? <span className="text-zinc-400">Não definida</span> : formatarMoeda(valorMeta)}
          </dd>
          <dt className="text-zinc-500">Realizado (todos os funis)</dt>
          <dd className="text-right font-medium tabular-nums">{formatarMoeda(realizadoGeral)}</dd>
        </dl>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-zinc-100 pt-1.5 text-xs dark:border-zinc-800">
          <dt className="text-zinc-400">Vendido neste funil</dt>
          <dd className="text-right tabular-nums text-zinc-500">{formatarMoeda(realizadoFunil)}</dd>
          <dt className="text-zinc-400">Ticket médio deste funil</dt>
          <dd className="text-right tabular-nums text-zinc-500">
            {ticketMedioFunil === null ? '—' : formatarMoeda(ticketMedioFunil)}
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
