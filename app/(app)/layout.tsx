import { cookies } from 'next/headers'

import {
  COOKIE_SIDEBAR,
  SIDEBAR_RECOLHIDA,
} from '@/components/layout/preferencia-sidebar'
import { EmpresaAtualProvider } from '@/components/layout/empresa-contexto'
import { FaixaAcessoGlobal } from '@/components/layout/faixa-acesso-global'
import { COOKIE_TEMA, TEMA_CLARO } from '@/components/layout/preferencia-tema'
import { ShellApp } from '@/components/layout/shell-app'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { SincronizaUrlEmpresa } from '@/components/layout/sincroniza-url-empresa'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { isSuperAdmin } from '@/lib/dal/super-admin'

/**
 * Shell da área autenticada. `getUsuarioAtual` valida a sessão, a empresa da
 * URL (`/<slug>`) e lê o perfil; sem sessão redireciona para /login, perfil
 * inativo para /sem-acesso, empresa sem vínculo para /empresas.
 *
 * O layout não substitui a checagem nas páginas: layouts não re-renderizam em
 * toda navegação, então cada página e action continua chamando a DAL.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [usuario, empresa, cookieStore, superAdmin] = await Promise.all([
    getUsuarioAtual(),
    getEmpresaAtual(),
    cookies(),
    isSuperAdmin(),
  ])
  const recolhida = cookieStore.get(COOKIE_SIDEBAR)?.value === SIDEBAR_RECOLHIDA
  const temaClaro = cookieStore.get(COOKIE_TEMA)?.value === TEMA_CLARO

  return (
    <ShellApp
      recolhidaInicial={recolhida}
      temaClaroInicial={temaClaro}
      sidebar={<Sidebar usuario={usuario} empresa={empresa} superAdmin={superAdmin} />}
      topo={<Topbar usuario={usuario} />}
    >
      <SincronizaUrlEmpresa slug={empresa.slug} />
      {empresa.acessoGlobal && <FaixaAcessoGlobal empresa={empresa.nome} />}
      <EmpresaAtualProvider empresa={{ id: empresa.id, slug: empresa.slug }}>{children}</EmpresaAtualProvider>
    </ShellApp>
  )
}
