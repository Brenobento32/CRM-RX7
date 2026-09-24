import { Avatar } from '@/components/ui/avatar'
import { logout } from '@/lib/actions/auth'
import type { UsuarioAtual } from '@/lib/dal/auth'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'

import { IconeSair } from './icones'
import { BotaoRecolherSidebar } from './shell-app'
import { SidebarNav } from './sidebar-nav'

/**
 * Conteúdo da sidebar. A largura e o `<aside>` ficam no ShellApp; aqui cada
 * texto some com a sidebar recolhida — `sr-only` onde precisa continuar
 * acessível, `hidden` onde é só decoração.
 */
export function Sidebar({ usuario }: { usuario: UsuarioAtual }) {
  return (
    <>
      <div className="flex h-16 items-center justify-between gap-2 border-b border-zinc-200 px-4 group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:px-0 dark:border-zinc-800">
        <span className="truncate text-lg font-semibold tracking-tight group-data-[sidebar=recolhida]/shell:hidden">
          Scorpion CRM
        </span>
        <BotaoRecolherSidebar />
      </div>

      <SidebarNav papel={usuario.role} />

      <div className="border-t border-zinc-200 p-4 group-data-[sidebar=recolhida]/shell:px-2 dark:border-zinc-800">
        <div
          className="flex min-w-0 items-start gap-3 group-data-[sidebar=recolhida]/shell:justify-center"
          title={`${usuario.nome} · ${ROTULO_PAPEL[usuario.role]}`}
        >
          <Avatar nome={usuario.nome} fotoUrl={usuario.fotoUrl} tamanho="md" />
          <div className="min-w-0 group-data-[sidebar=recolhida]/shell:sr-only">
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
            title="Sair"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 group-data-[sidebar=recolhida]/shell:px-0 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <IconeSair className="size-4" />
            <span className="group-data-[sidebar=recolhida]/shell:sr-only">Sair</span>
          </button>
        </form>
      </div>
    </>
  )
}
