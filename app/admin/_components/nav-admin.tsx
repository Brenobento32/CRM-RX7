'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITENS = [
  { href: '/admin', rotulo: 'Empresas', exato: false, alternativas: ['/admin/empresas'] },
  { href: '/admin/planos', rotulo: 'Planos', exato: false, alternativas: [] },
  { href: '/admin/auditoria', rotulo: 'Auditoria', exato: false, alternativas: [] },
]

/** Abas do painel global: a atual fica marcada (cor e `aria-current`). */
export function NavAdmin() {
  const pathname = usePathname()
  const ativo = (i: (typeof ITENS)[number]) =>
    i.href === '/admin'
      ? pathname === '/admin' || i.alternativas.some((a) => pathname.startsWith(a))
      : pathname === i.href || pathname.startsWith(`${i.href}/`)

  return (
    <nav aria-label="Painel global" className="flex items-center gap-1">
      {ITENS.map((i) => {
        const atual = ativo(i)
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={atual ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              atual ? 'bg-premium-acento-suave font-medium text-premium-acento' : 'text-premium-secundario hover:bg-premium-bg hover:text-premium-texto'
            }`}
          >
            {i.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
