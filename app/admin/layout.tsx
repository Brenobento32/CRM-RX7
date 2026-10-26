import type { Metadata } from 'next'
import Link from 'next/link'

import { logout } from '@/lib/actions/auth'
import { exigirSuperAdmin } from '@/lib/dal/super-admin'

import { NavAdmin } from './_components/nav-admin'

export const metadata: Metadata = {
  title: { default: 'Super Admin', template: '%s · Super Admin' },
}

/**
 * Painel da plataforma (Rio X7). Fora de qualquer empresa: sem `/<slug>`,
 * sem dados comerciais. Quem não é Super Admin recebe 404 aqui e em cada
 * página; o banco confere de novo em cada RPC.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await exigirSuperAdmin()

  return (
    <div className="min-h-screen bg-premium-bg">
      <header className="sticky top-0 z-20 border-b border-premium-borda bg-premium-topo/95 shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-x-6 px-4">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-premium-acento text-sm font-bold text-premium-acento-texto">
              A
            </span>
            <span className="font-semibold tracking-tight text-premium-texto">AVANTE</span>
            <span className="rounded-md bg-premium-texto px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-premium-bg uppercase">
              Super Admin
            </span>
          </Link>
          <NavAdmin />
          <div className="ml-auto flex items-center gap-1 text-sm">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- sair do painel recarrega tudo */}
            <a href="/empresas" className="rounded-lg px-3 py-1.5 text-premium-secundario transition hover:bg-premium-bg hover:text-premium-texto">
              Minhas empresas
            </a>
            <form action={logout}>
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
