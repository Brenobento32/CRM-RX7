import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

/**
 * Endereço antigo do "Editar evento". A edição agora acontece no modal da
 * agenda (`?editar=<id>`); a RLS continua decidindo se a reunião aparece.
 */
export default async function EditarEventoPage({ params }: PageProps<'/agenda/[id]/editar'>) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  redirect(`/agenda?editar=${id}`)
}
