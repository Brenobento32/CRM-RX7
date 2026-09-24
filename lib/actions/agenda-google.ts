'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { desconectarGoogle, iniciarConexaoGoogle } from '@/lib/dal/agenda-google'

const PAGINA = '/configuracoes/agenda'

/** Origem do CRM a partir do request: funciona em localhost e em produção. */
async function origemAtual() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function comErro(mensagem: string) {
  return `${PAGINA}?google=erro&mensagem=${encodeURIComponent(mensagem)}`
}

/** Leva o gerente ao consentimento do Google; o retorno cai nesta página. */
export async function conectarGoogleAction(): Promise<void> {
  const r = await iniciarConexaoGoogle(`${await origemAtual()}${PAGINA}`)
  if (!r.ok) redirect(comErro(r.mensagem))
  redirect(r.url)
}

export async function desconectarGoogleAction(): Promise<void> {
  const r = await desconectarGoogle()
  revalidatePath(PAGINA)
  redirect(r.ok ? `${PAGINA}?google=desconectado` : comErro(r.mensagem))
}
