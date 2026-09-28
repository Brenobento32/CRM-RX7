import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterEtapa } from '@/lib/dal/etapas'

/** Rota antiga (funil único). Redireciona para a mesma etapa dentro do seu funil. */
export default async function EditarEtapaPageRedirect({ params }: PageProps<'/configuracoes/etapas/[id]/editar'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const etapa = await obterEtapa(id)
  if (!etapa) notFound()

  redirect(`/configuracoes/funis/${etapa.funilId}/etapas/${etapa.id}/editar`)
}
