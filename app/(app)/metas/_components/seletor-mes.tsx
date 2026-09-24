import Link from 'next/link'

import { mesAtual, rotuloMes, somarMeses } from '@/lib/utils/periodo'

const seta =
  'rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'

/** Links, não estado de cliente: o mês fica na URL e o servidor recalcula. */
export function SeletorMes({ mes }: { mes: string }) {
  const atual = mesAtual()
  const anterior = somarMeses(mes, -1)
  const seguinte = somarMeses(mes, 1)

  return (
    <nav
      aria-label="Mês"
      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <Link href={`/metas?mes=${anterior}`} aria-label={rotuloMes(anterior)} className={seta}>
        ‹
      </Link>
      <span className="min-w-40 px-2 text-center text-sm font-medium">{rotuloMes(mes)}</span>
      <Link href={`/metas?mes=${seguinte}`} aria-label={rotuloMes(seguinte)} className={seta}>
        ›
      </Link>
      {mes !== atual && (
        <Link href="/metas" className={seta}>
          Mês atual
        </Link>
      )}
    </nav>
  )
}
