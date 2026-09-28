import { notFound, redirect } from 'next/navigation'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarFunis } from '@/lib/dal/funis'

/** Rota antiga (funil único). Redireciona para a nova etapa do Funil Principal. */
export default async function NovaEtapaPageRedirect() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const funis = await listarFunis()
  const principal = funis.find((f) => f.padrao)
  if (!principal) notFound()

  redirect(`/configuracoes/funis/${principal.id}/etapas/nova`)
}
