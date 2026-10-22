'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { caminhoDaEmpresa, separarPrefixo } from '@/lib/empresa/rota'

/**
 * Mantém `/e/<slug>` na barra de endereço desta aba.
 *
 * Links e `redirect()` do app usam caminhos sem prefixo (`/clientes`). O
 * `proxy.ts` resolve a empresa pela aba de origem, mas um redirect de Server
 * Action pode deixar a URL sem o prefixo; aqui ele volta, sem recarregar, para
 * que a próxima navegação e um F5 continuem na mesma empresa — e nunca na
 * empresa de outra aba. Não autoriza nada: é só a URL.
 */
export function SincronizaUrlEmpresa({ slug }: { slug: string }) {
  const pathname = usePathname()

  useEffect(() => {
    const { pathname: atual, search, hash } = window.location
    if (separarPrefixo(atual)) return
    window.history.replaceState(null, '', `${caminhoDaEmpresa(slug, atual)}${search}${hash}`)
  }, [pathname, slug])

  return null
}
