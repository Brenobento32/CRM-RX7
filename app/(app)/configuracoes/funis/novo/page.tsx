import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getUsuarioAtual } from '@/lib/dal/auth'

import { FunilForm } from '../_components/funil-form'

export const metadata: Metadata = {
  title: 'Novo funil',
}

export default async function NovoFunilPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Novo funil</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nasce sempre com uma etapa ganha e uma perdida — não dá pra ficar sem fechamento.
        </p>
      </div>

      <FunilForm />
    </div>
  )
}
