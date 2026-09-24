import Link from 'next/link'

import type { Servico } from '@/lib/dal/servicos'

const ABAS = [
  { href: '/propostas/abertas', rotulo: 'Abertas' },
  { href: '/propostas/fechadas', rotulo: 'Fechadas' },
] as const

/** Abas como links: cada uma tem URL própria (a sidebar aponta para elas). */
export function AbasPropostas({ atual }: { atual: (typeof ABAS)[number]['href'] }) {
  return (
    <nav aria-label="Propostas" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {ABAS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          aria-current={a.href === atual ? 'page' : undefined}
          className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
            a.href === atual
              ? 'border-zinc-900 font-medium dark:border-zinc-100'
              : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  )
}

export function EtiquetasServicos({ servicos }: { servicos: Servico[] }) {
  if (servicos.length === 0) return <span className="text-zinc-400">—</span>
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Serviços">
      {servicos.map((s) => (
        <li
          key={s.id}
          className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {s.nome}
          {!s.ativo && <span className="text-zinc-500"> (desativado)</span>}
        </li>
      ))}
    </ul>
  )
}

export function TabelaPropostas({ colunas, children }: { colunas: { rotulo: string; direita?: boolean }[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className={`px-4 py-3 font-medium ${c.direita ? 'text-right' : ''}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 align-top dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  )
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </p>
  )
}
