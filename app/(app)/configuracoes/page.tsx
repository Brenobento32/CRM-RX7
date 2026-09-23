import type { Metadata } from 'next'
import Link from 'next/link'

import { getUsuarioAtual } from '@/lib/dal/auth'

export const metadata: Metadata = {
  title: 'Configurações',
}

export default async function ConfiguracoesPage() {
  const usuario = await getUsuarioAtual()

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      {usuario.role === 'gerente' ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          <li>
            <Link
              href="/configuracoes/usuarios"
              className="block rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
            >
              <p className="font-medium">Usuários</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Criar, editar e desativar gerentes e closers.
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/configuracoes/etapas"
              className="block rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
            >
              <p className="font-medium">Etapas do funil</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Criar etapas personalizadas, mudar cores e a ordem das colunas.
              </p>
            </Link>
          </li>
        </ul>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nenhuma configuração disponível para o seu perfil. Para alterar seus dados de acesso,
          fale com o gerente.
        </p>
      )}
    </div>
  )
}
