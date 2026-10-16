import { percentualMeta, type RealizadoGeral } from '@/lib/dal/metas'
import type { RealizadoFunil } from '@/lib/dal/funil-metricas'
import { ticketMedio, type MetaPeriodo } from '@/lib/utils/financeiro-periodo'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/**
 * Duas seções visualmente separadas, de propósito — não é só estética: são
 * dois conjuntos de pessoas diferentes, nunca a mesma coisa em escalas
 * diferentes.
 *
 * SEÇÃO 1 ("Meta do período — todos os funis"): meta (proporcionada às
 * metas mensais, `metaProporcionalPeriodo`) contra o realizado da MESMA
 * pessoa (`realizadoGeral`, RPC `realizado_periodo` — GERENTE: todo mundo;
 * closer/SDR: só `responsavel_id` = a própria pessoa), em TODOS os funis.
 * Nunca muda com o funil selecionado abaixo.
 *
 * SEÇÃO 2 ("Contexto do funil selecionado"): vendido/ticket médio só
 * DESTE funil, mas da MESMA pessoa (`realizadoFunil`, agora recebendo o
 * mesmo `usuarioId` da Seção 1) — achado desta rodada: antes, `obterRealizadoFunil`
 * não filtrava por responsável, então um SDR/CLOSER com `pode_ver` em
 * várias etapas via um colega via o fechamento de QUALQUER UM visível no
 * funil, enquanto a Seção 1 mostrava só a própria pessoa — os dois números
 * pareciam contradição ("vendi X no funil mas minha meta mostra 0") por
 * somarem conjuntos de pessoas diferentes, nunca por período ou TCV/MRR
 * errados. Agora a ÚNICA diferença entre as duas seções é o filtro de
 * `funil_id` — nunca "de quem são as vendas".
 */
export function FinanceiroFunil({
  metaPeriodo,
  realizadoGeral,
  realizadoFunil,
  funilNome,
}: {
  metaPeriodo: MetaPeriodo
  realizadoGeral: RealizadoGeral
  realizadoFunil: RealizadoFunil
  funilNome: string
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
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Meta do período</h2>
          <p className="text-xs text-zinc-500">
            Todos os funis. Estes três números nunca mudam com o funil selecionado abaixo.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {linhas.map((l) => (
            <CardMetaGeral
              key={l.chave}
              titulo={l.titulo}
              valorMeta={l.valorMeta}
              realizado={l.realizadoGeral}
              percentual={percentualMeta(l.realizadoGeral, l.valorMeta)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Contexto do funil selecionado
          </h2>
          <p className="text-xs text-zinc-500">
            Funil: <span className="font-medium text-zinc-700 dark:text-zinc-300">{funilNome}</span>.
            Esses valores são somente deste funil e não entram no cálculo da meta acima.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {linhas.map((l) => (
            <CardContextoFunil
              key={l.chave}
              titulo={l.titulo}
              realizadoFunil={l.realizadoFunil}
              ticketMedioFunil={ticketMedio(l.realizadoFunil, l.qtdFunil)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function CardMetaGeral({
  titulo,
  valorMeta,
  realizado,
  percentual,
}: {
  titulo: string
  valorMeta: number | null
  realizado: number
  percentual: number | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <CirculoProgresso percentual={percentual} />
      <div className="min-w-40 flex-1 space-y-1.5">
        <p className="font-semibold">{titulo}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500">Meta</dt>
          <dd className="text-right tabular-nums">
            {valorMeta === null ? <span className="text-zinc-400">Não definida</span> : formatarMoeda(valorMeta)}
          </dd>
          <dt className="text-zinc-500">Realizado</dt>
          <dd className="text-right font-medium tabular-nums">{formatarMoeda(realizado)}</dd>
          <dt className="text-zinc-500">Atingido</dt>
          <dd className="text-right tabular-nums">
            {percentual === null ? <span className="text-zinc-400">—</span> : formatarPercentual(percentual)}
          </dd>
        </dl>
      </div>
    </div>
  )
}

function CardContextoFunil({
  titulo,
  realizadoFunil,
  ticketMedioFunil,
}: {
  titulo: string
  realizadoFunil: number
  ticketMedioFunil: number | null
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="font-semibold">{titulo}</p>
      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">Vendido neste funil</dt>
        <dd className="text-right tabular-nums">{formatarMoeda(realizadoFunil)}</dd>
        <dt className="text-zinc-500">Ticket médio deste funil</dt>
        <dd className="text-right tabular-nums">
          {ticketMedioFunil === null ? <span className="text-zinc-400">—</span> : formatarMoeda(ticketMedioFunil)}
        </dd>
      </dl>
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
