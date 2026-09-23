'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MENU = [
  { href: '/', rotulo: 'Início' },
  { href: '/agenda', rotulo: 'Agenda' },
  { href: '/funil', rotulo: 'Funil' },
  { href: '/clientes', rotulo: 'Clientes' },
  { href: '/relatorios', rotulo: 'Relatórios' },
  { href: '/configuracoes', rotulo: 'Configurações' },
] as const

function estaAtivo(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Client só pelo `usePathname`, que marca o item ativo. */
export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="flex-1 overflow-y-auto p-3">
      <ul className="space-y-1">
        {MENU.map((item) => {
          const ativo = estaAtivo(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={ativo ? 'page' : undefined}
                className={
                  ativo
                    ? 'block rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'block rounded-md px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }
              >
                {item.rotulo}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
