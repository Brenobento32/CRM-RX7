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
  const usuario = await getUsuarioAtual()

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar usuario={usuario} />
      <main className="flex-1 pl-60">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  )
}
