import { notFound } from 'next/navigation'

import { getUsuarioAtual } from '@/lib/dal/auth'

/**
 * Placeholder das seções do menu que ainda não foram implementadas.
 *
 * Rotas específicas têm prioridade sobre este catch-all, então quando
 * `app/(app)/clientes/page.tsx` (etc.) for criada ela assume a URL e o item
 * correspondente pode sair daqui. Quando todas existirem, apague este arquivo.
 */
const EM_BREVE: Record<string, string> = {
  relatorios: 'Relatórios',
  configuracoes: 'Configurações',
}

export default async function EmBrevePage({
  params,
}: PageProps<'/[...secao]'>) {
  await getUsuarioAtual()

  const { secao } = await params
  const titulo = secao.length === 1 ? EM_BREVE[secao[0]] : undefined

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
