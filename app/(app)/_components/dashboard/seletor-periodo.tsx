import Link from 'next/link'

import { PERIODOS, ROTULO_PERIODO, type ChavePeriodo } from '@/lib/utils/periodo'

/**
 * Links, não estado de cliente: o período fica na URL e o servidor recalcula.
 * `caminho` é a página que recebe o `?periodo=` (dashboard, funil).
 */
export function SeletorPeriodo({ atual, caminho = '/' }: { atual: ChavePeriodo; caminho?: string }) {
  return (
    <nav
      aria-label="Período"
      className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      {PERIODOS.map((p) => (
        <Link
          key={p}
          href={p === 'mes' ? caminho : `${caminho}?periodo=${p}`}
          aria-current={p === atual ? 'page' : undefined}
          className={
            p === atual
              ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }
        >
          {ROTULO_PERIODO[p]}
        </Link>
      ))}
    </nav>
  )
}
