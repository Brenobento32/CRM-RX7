import { cookies } from 'next/headers'

import {
  COOKIE_SIDEBAR,
  SIDEBAR_RECOLHIDA,
} from '@/components/layout/preferencia-sidebar'
import { COOKIE_TEMA, TEMA_CLARO } from '@/components/layout/preferencia-tema'
import { ShellApp } from '@/components/layout/shell-app'
import { Sidebar } from '@/components/layout/sidebar'
import { getUsuarioAtual } from '@/lib/dal/auth'

/**
 * Shell da área autenticada. `getUsuarioAtual` valida a sessão e lê o perfil;
 * sem sessão redireciona para /login, perfil inativo para /sem-acesso.
 *
 * O layout não substitui a checagem nas páginas: layouts não re-renderizam em
 * toda navegação, então cada página e action continua chamando a DAL.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [usuario, cookieStore] = await Promise.all([getUsuarioAtual(), cookies()])
  const recolhida = cookieStore.get(COOKIE_SIDEBAR)?.value === SIDEBAR_RECOLHIDA
  const temaClaro = cookieStore.get(COOKIE_TEMA)?.value === TEMA_CLARO

  return (
    <ShellApp recolhidaInicial={recolhida} temaClaroInicial={temaClaro} sidebar={<Sidebar usuario={usuario} />}>
      {children}
    </ShellApp>
  )
}
