'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  IconeAgenda,
  IconeClientes,
  IconeConfiguracoes,
  IconeFunil,
  IconeInicio,
  IconeMetas,
  IconeRelatorios,
} from './icones'

const MENU = [
  { href: '/', rotulo: 'Início', Icone: IconeInicio },
  { href: '/agenda', rotulo: 'Agenda', Icone: IconeAgenda },
  { href: '/funil', rotulo: 'Funil', Icone: IconeFunil },
  { href: '/clientes', rotulo: 'Clientes', Icone: IconeClientes },
  { href: '/metas', rotulo: 'Metas', Icone: IconeMetas },
  { href: '/relatorios', rotulo: 'Relatórios', Icone: IconeRelatorios },
  { href: '/configuracoes', rotulo: 'Configurações', Icone: IconeConfiguracoes },
] as const

function estaAtivo(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Client só pelo `usePathname`, que marca o item ativo. Com a sidebar
 * recolhida o nome fica `sr-only` (o leitor de tela continua lendo) e o
 * `title` mostra o nome ao passar o mouse.
 */
export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Menu principal" className="flex-1 overflow-y-auto p-3 group-data-[sidebar=recolhida]/shell:px-2">
      <ul className="space-y-1">
        {MENU.map(({ href, rotulo, Icone }) => {
          const ativo = estaAtivo(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                title={rotulo}
                aria-current={ativo ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:px-0 ${
                  ativo
                    ? 'bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                <Icone />
                <span className="truncate group-data-[sidebar=recolhida]/shell:sr-only">{rotulo}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
