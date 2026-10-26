import Link from 'next/link'

import { segmentoClass, segmentoItemClass } from '@/components/ui/estilos'
import { PERIODOS, ROTULO_PERIODO, type ChavePeriodo } from '@/lib/utils/periodo'

/**
 * Links, não estado de cliente: o período fica na URL e o servidor recalcula.
 * `caminho` é a página que recebe o `?periodo=` (dashboard, funil).
 */
export function SeletorPeriodo({ atual, caminho = '/' }: { atual: ChavePeriodo; caminho?: string }) {
  return (
    <nav aria-label="Período" className={`${segmentoClass} max-w-full flex-wrap`}>
      {PERIODOS.map((p) => (
        <Link
          key={p}
          href={p === 'mes' ? caminho : `${caminho}?periodo=${p}`}
          aria-current={p === atual ? 'page' : undefined}
          className={segmentoItemClass(p === atual)}
        >
          {ROTULO_PERIODO[p]}
        </Link>
      ))}
    </nav>
  )
}
