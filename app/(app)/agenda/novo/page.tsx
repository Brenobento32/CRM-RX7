import { redirect } from 'next/navigation'

/**
 * Endereço antigo do "Novo evento". A reunião agora é criada no modal da
 * própria agenda (`?nova=1`); aqui só se repassam dia, hora, cliente e
 * responsável para não quebrar links salvos e a ficha do cliente.
 */
export default async function NovoEventoPage({ searchParams }: PageProps<'/agenda/novo'>) {
  const params = await searchParams
  const qs = new URLSearchParams({ nova: '1' })
  for (const chave of ['dia', 'hora', 'cliente'] as const) {
    const v = params[chave]
    if (typeof v === 'string' && v) qs.set(chave, v)
  }
  if (typeof params.responsavel === 'string' && params.responsavel) qs.set('usuario', params.responsavel)
  redirect(`/agenda?${qs.toString()}`)
}
