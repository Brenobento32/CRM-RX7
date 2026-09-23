import type { Metadata } from 'next'

import { getUsuarioAtual } from '@/lib/dal/auth'

export const metadata: Metadata = {
  title: 'Início',
}

export default async function InicioPage() {
  const usuario = await getUsuarioAtual()
  const primeiroNome = usuario.nome.split(' ')[0]

  return (
    <div>
      <h1 className="text-2xl font-semibold">Olá, {primeiroNome}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {usuario.role === 'gerente'
          ? 'Você está logado como gerente e tem visão de toda a equipe.'
          : 'Você está logado como closer e vê apenas a sua carteira.'}
      </p>
    </div>
  )
}
