import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { criarEtapaAction } from '@/lib/actions/etapas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterFunil } from '@/lib/dal/funis'

import { EtapaForm } from '../../../_components/etapa-form'

export const metadata: Metadata = {
  title: 'Nova etapa',
}

export default async function NovaEtapaPage({ params }: PageProps<'/configuracoes/funis/[funilId]/etapas/nova'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { funilId } = await params
  if (!z.uuid().safeParse(funilId).success) notFound()
  const funil = await obterFunil(funilId)
  if (!funil) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova etapa em &ldquo;{funil.nome}&rdquo;</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Entra logo antes do fechamento do funil. Depois é possível mudar a posição na lista de etapas.
        </p>
      </div>

      <EtapaForm
        action={criarEtapaAction.bind(null, funilId)}
        valoresIniciais={{ cor: 'ciano' }}
        rotuloEnviar="Criar etapa"
        cancelarHref={`/configuracoes/funis/${funilId}`}
      />
    </div>
  )
}
