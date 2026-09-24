import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/**
 * Barra de progresso da meta. Enche até 100%; acima disso o número mostra o
 * valor real (ex.: 132%) e a barra fica verde.
 */
export function BarraProgresso({ percentual, rotulo }: { percentual: number | null; rotulo: string }) {
  if (percentual === null) {
    return <div aria-hidden className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800" />
  }

  const atingida = percentual >= 1
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(percentual, 1) * 100)}
      aria-valuetext={formatarPercentual(percentual)}
      className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
    >
      <div
        className={`h-full rounded-full ${atingida ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-zinc-900 dark:bg-zinc-100'}`}
        style={{ width: `${Math.min(percentual, 1) * 100}%` }}
      />
    </div>
  )
}

export function TextoPercentual({ percentual }: { percentual: number | null }) {
  if (percentual === null) return <span className="text-zinc-400">—</span>
  return (
    <span className={percentual >= 1 ? 'font-medium text-emerald-700 dark:text-emerald-400' : undefined}>
      {formatarPercentual(percentual)}
    </span>
  )
}

type CardProps = {
  titulo: string
  valorMeta: number | null
  realizado: number
  percentual: number | null
  semMeta: string
  /** Ações do gerente (definir, editar, remover). */
  acoes?: React.ReactNode
}

/** Objetivo, realizado e percentual de uma meta, em destaque. */
export function CardMeta({ titulo, valorMeta, realizado, percentual, semMeta, acoes }: CardProps) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-semibold">{titulo}</h2>
        {acoes}
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">Objetivo</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {valorMeta === null ? <span className="text-base font-normal text-zinc-500">{semMeta}</span> : formatarMoeda(valorMeta)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">Realizado</dt>
          <dd className="mt-1 text-2xl font-semibold">{formatarMoeda(realizado)}</dd>
        </div>
        <div>
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">Atingido</dt>
          <dd className="mt-1 text-2xl font-semibold">
            <TextoPercentual percentual={percentual} />
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <BarraProgresso percentual={percentual} rotulo={`Progresso: ${titulo}`} />
      </div>
    </section>
  )
}
