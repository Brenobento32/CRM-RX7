import { Avatar } from '@/components/ui/avatar'
import { logout } from '@/lib/actions/auth'
import type { UsuarioAtual } from '@/lib/dal/auth'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'

import { SidebarNav } from './sidebar-nav'

export function Sidebar({ usuario }: { usuario: UsuarioAtual }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex h-16 items-center border-b border-zinc-200 px-5 dark:border-zinc-800">
        <span className="text-lg font-semibold tracking-tight">Scorpion CRM</span>
      </div>

      <SidebarNav />

      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar nome={usuario.nome} fotoUrl={usuario.fotoUrl} tamanho="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={usuario.nome}>
              {usuario.nome}
            </p>
            <p className="truncate text-xs text-zinc-500" title={usuario.email}>
              {usuario.email}
            </p>
            <span className="mt-2 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {ROTULO_PAPEL[usuario.role]}
            </span>
          </div>
        </div>

        <form action={logout} className="mt-3">
          <button
            type="submit"
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Sair
          </button>
        </form>
      </div>
    </aside>
  )
}
