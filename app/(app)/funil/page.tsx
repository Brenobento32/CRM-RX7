import type { Metadata } from 'next'
import Link from 'next/link'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapas } from '@/lib/dal/etapas'
import { DIAS_VISIVEIS_ENCERRADOS, listarCardsFunil } from '@/lib/dal/funil'

import { Kanban } from './_components/kanban'

export const metadata: Metadata = {
  title: 'Funil',
}

/** Kanban operacional. As métricas ficam em /funil/metricas. */
export default async function FunilPage() {
  const usuario = await getUsuarioAtual()

  const [cards, etapas] = await Promise.all([listarCardsFunil(), listarEtapas()])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Funil</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.role === 'gerente' ? 'Negociações de toda a equipe.' : 'Suas negociações.'} Fechadas e
            perdidas aparecem por {DIAS_VISIVEIS_ENCERRADOS} dias.
          </p>
        </div>
        <Link href="/funil/metricas" className={botaoSecundarioClass}>
          Ver métricas
        </Link>
      </div>

      <Kanban
        cards={cards}
        etapas={etapas.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo }))}
      />
    </div>
  )
}
