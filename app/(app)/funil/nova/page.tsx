import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { listarOpcoesClientes } from '@/lib/dal/eventos'
import { listarFunis } from '@/lib/dal/funis'

import { NovaEntradaForm } from './_components/nova-entrada-form'

export const metadata: Metadata = {
  title: 'Nova entrada',
}

export default async function NovaEntradaPage({ searchParams }: PageProps<'/funil/nova'>) {
  const { funil: funilParam } = await searchParams
  const funis = await listarFunis()
  const funil = funis.find((f) => f.id === funilParam && f.ativo)
  if (!funil) notFound()

  const clientes = await listarOpcoesClientes()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova entrada em &ldquo;{funil.nome}&rdquo;</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Para um cliente já cadastrado. O responsável é sempre o dono atual do cliente.
        </p>
      </div>

      <NovaEntradaForm clientes={clientes} funilId={funil.id} cancelarHref={`/funil?funil=${funil.id}`} />
    </div>
  )
}
