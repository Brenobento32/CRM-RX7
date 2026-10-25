import type { Metadata } from 'next'
import Link from 'next/link'

import { logout } from '@/lib/actions/auth'
import { exigirSuperAdmin } from '@/lib/dal/super-admin'

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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">AVANTE · Super Admin</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin" className="hover:underline">Empresas</Link>
            <Link href="/admin/planos" className="hover:underline">Planos</Link>
            <Link href="/admin/auditoria" className="hover:underline">Auditoria</Link>
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- sair do painel recarrega tudo */}
            <a href="/empresas" className="hover:underline">Minhas empresas</a>
            <form action={logout}>
              <button type="submit" className="hover:underline">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
