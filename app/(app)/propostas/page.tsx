import { redirect } from 'next/navigation'

/** Sem página própria: a aba padrão é Abertas. */
export default function PropostasPage() {
  redirect('/propostas/abertas')
}
