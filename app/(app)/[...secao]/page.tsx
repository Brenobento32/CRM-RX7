import { notFound } from 'next/navigation'

import { exigirCargo } from '@/lib/dal/auth'
import { CARGOS_POR_AREA } from '@/lib/validations/usuario'

/**
 * Placeholder das seções do menu que ainda não foram implementadas.
 *
 * Rotas específicas têm prioridade sobre este catch-all, então quando
 * `app/(app)/clientes/page.tsx` (etc.) for criada ela assume a URL e o item
 * correspondente pode sair daqui. Quando todas existirem, apague este arquivo.
 */
const EM_BREVE: Record<string, string> = {
  relatorios: 'Relatórios',
  'relatorios/vendas': 'Relatórios · Vendas',
  'relatorios/conversao': 'Relatórios · Conversão',
  'relatorios/exportacao': 'Relatórios · Exportação',
}

export default async function EmBrevePage({
  params,
}: PageProps<'/[...secao]'>) {
  await exigirCargo(CARGOS_POR_AREA.relatorios)

  const { secao } = await params
  const titulo = EM_BREVE[secao.join('/')]

  if (!titulo) notFound()

  return (
    <div>
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Em construção.
      </p>
    </div>
  )
}
