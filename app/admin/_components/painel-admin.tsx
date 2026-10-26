import Link from 'next/link'

import { logoutAdmin } from '@/lib/actions/auth'

import { MarcaAdmin } from './marca-admin'
import { NavAdmin } from './nav-admin'

/**
 * Moldura do painel global (Rio X7). Só é montada depois de o banco confirmar
 * o Super Admin (`acessoAdmin()`); fora de qualquer empresa, sem dados
 * comerciais. Sair encerra a sessão e volta ao login administrativo.
 */
export function PainelAdmin({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-premium-bg">
      <header className="sticky top-0 z-20 border-b border-premium-borda bg-premium-topo/95 shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-x-6 px-4">
          <Link href="/admin" className="flex items-center">
            <MarcaAdmin />
          </Link>
          <NavAdmin />
          <div className="ml-auto flex items-center gap-1 text-sm">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- ir para as empresas recarrega tudo */}
            <a href="/empresas" className="rounded-lg px-3 py-1.5 text-premium-secundario transition hover:bg-premium-bg hover:text-premium-texto">
              Minhas empresas
            </a>
            <form action={logoutAdmin}>
              <button type="submit" className="rounded-lg px-3 py-1.5 text-premium-secundario transition hover:bg-premium-bg hover:text-premium-texto">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
