import Link from 'next/link'

import type { Servico } from '@/lib/dal/servicos'
import { EstadoVazio } from '@/components/ui/estado-vazio'
import { tabelaCaixaClass, theadClass, tbodyClass } from '@/components/ui/estilos'

const ABAS = [
  { href: '/propostas/abertas', rotulo: 'Abertas' },
  { href: '/propostas/fechadas', rotulo: 'Fechadas' },
] as const

/** Abas como links: cada uma tem URL própria (a sidebar aponta para elas). */
export function AbasPropostas({ atual }: { atual: (typeof ABAS)[number]['href'] }) {
  return (
    <nav aria-label="Propostas" className="flex gap-1 border-b border-premium-borda">
      {ABAS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          aria-current={a.href === atual ? 'page' : undefined}
          className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
            a.href === atual
              ? 'border-premium-acento font-medium text-premium-texto'
              : 'border-transparent text-premium-secundario hover:border-premium-borda hover:text-premium-texto'
          }`}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  )
}

export function EtiquetasServicos({ servicos }: { servicos: Servico[] }) {
  if (servicos.length === 0) return <span className="text-premium-mudo">—</span>
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Serviços">
      {servicos.map((s) => (
        <li
          key={s.id}
          className="rounded-md bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario ring-1 ring-premium-borda ring-inset"
        >
          {s.nome}
          {!s.ativo && <span className="text-premium-mudo"> (desativado)</span>}
        </li>
      ))}
    </ul>
  )
}

export function TabelaPropostas({ colunas, children }: { colunas: { rotulo: string; direita?: boolean }[]; children: React.ReactNode }) {
  return (
    <div className={tabelaCaixaClass}>
      <table className="w-full text-left text-sm">
        <thead className={theadClass}>
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className={`px-4 py-3 font-medium ${c.direita ? 'text-right' : ''}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={`${tbodyClass} align-top`}>{children}</tbody>
      </table>
    </div>
  )
}

/** Estado vazio das listas: mensagem e, quando houver, o próximo passo. */
export function Vazio({ children, acao, descricao }: { children: string; acao?: { href: string; rotulo: string }; descricao?: string }) {
  return <EstadoVazio titulo={children} descricao={descricao} acao={acao} />
}
