import { notFound, redirect } from 'next/navigation'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarFunis } from '@/lib/dal/funis'

/** Rota antiga (funil único). Redireciona para o Funil Principal em /configuracoes/funis. */
export default async function EtapasPageRedirect() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const funis = await listarFunis()
  const principal = funis.find((f) => f.padrao)
  if (!principal) notFound()

  redirect(`/configuracoes/funis/${principal.id}`)
}
