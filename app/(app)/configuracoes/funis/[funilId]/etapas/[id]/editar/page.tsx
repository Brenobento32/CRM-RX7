import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarEtapaAction } from '@/lib/actions/etapas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterEtapa } from '@/lib/dal/etapas'

import { EtapaForm } from '../../../../_components/etapa-form'

export const metadata: Metadata = {
  title: 'Editar etapa',
}

export default async function EditarEtapaPage({
  params,
}: PageProps<'/configuracoes/funis/[funilId]/etapas/[id]/editar'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { funilId, id } = await params
  if (!z.uuid().safeParse(funilId).success || !z.uuid().safeParse(id).success) notFound()

  const etapa = await obterEtapa(id)
  if (!etapa || etapa.funilId !== funilId) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">
        {etapa.sistema ? `Cor de "${etapa.nome}"` : 'Editar etapa'}
      </h1>

      <EtapaForm
        action={editarEtapaAction.bind(null, funilId, etapa.id)}
        valoresIniciais={{ nome: etapa.nome, cor: etapa.cor }}
        nomeTravado={etapa.sistema}
        rotuloEnviar="Salvar"
        cancelarHref={`/configuracoes/funis/${funilId}`}
      />
    </div>
  )
}
