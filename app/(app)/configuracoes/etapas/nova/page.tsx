import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarEtapaAction } from '@/lib/actions/etapas'
import { getUsuarioAtual } from '@/lib/dal/auth'

import { EtapaForm } from '../_components/etapa-form'

export const metadata: Metadata = {
  title: 'Nova etapa',
}

export default async function NovaEtapaPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova etapa</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Entra logo antes de Negociação. Depois é possível mudar a posição na lista de etapas.
        </p>
      </div>

      <EtapaForm action={criarEtapaAction} valoresIniciais={{ cor: 'ciano' }} rotuloEnviar="Criar etapa" />
    </div>
  )
}
