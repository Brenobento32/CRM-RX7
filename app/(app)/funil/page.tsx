import type { Metadata } from 'next'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { DIAS_VISIVEIS_ENCERRADOS, listarCardsFunil } from '@/lib/dal/funil'

import { Kanban } from './_components/kanban'

export const metadata: Metadata = {
  title: 'Funil',
}

export default async function FunilPage() {
  const usuario = await getUsuarioAtual()
  const cards = await listarCardsFunil()

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Funil</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {usuario.role === 'gerente'
            ? 'Negociações de toda a equipe.'
            : 'Suas negociações.'}{' '}
          Fechadas e perdidas aparecem por {DIAS_VISIVEIS_ENCERRADOS} dias.
        </p>
      </div>

      <Kanban cards={cards} />
    </div>
  )
}
