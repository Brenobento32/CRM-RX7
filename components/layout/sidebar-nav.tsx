'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import type { Database } from '@/lib/types/database'

import {
  IconeAgenda,
  IconeClientes,
  IconeConfiguracoes,
  IconeFunil,
  IconeInicio,
  IconeMetas,
  IconePropostas,
  IconeRelatorios,
  IconeSeta,
} from './icones'

type Papel = Database['public']['Enums']['user_role']
type Icone = (p: { className?: string }) => React.ReactNode

type Subitem = { href: string; rotulo: string; somenteGerente?: boolean }
type ItemSimples = { href: string; rotulo: string; Icone: Icone }
type Grupo = { base: string; rotulo: string; Icone: Icone; filhos: Subitem[] }

const MENU: (ItemSimples | Grupo)[] = [
  { href: '/', rotulo: 'Início', Icone: IconeInicio },
  { href: '/agenda', rotulo: 'Agenda', Icone: IconeAgenda },
  {
    base: '/funil',
    rotulo: 'Funil',
    Icone: IconeFunil,
    filhos: [
      { href: '/funil', rotulo: 'Kanban' },
      { href: '/funil/metricas', rotulo: 'Métricas' },
      { href: '/funil/leads', rotulo: 'Leads' },
    ],
  },
  { href: '/clientes', rotulo: 'Clientes', Icone: IconeClientes },
  { href: '/metas', rotulo: 'Metas', Icone: IconeMetas },
  {
    base: '/propostas',
    rotulo: 'Propostas',
    Icone: IconePropostas,
    filhos: [
      { href: '/propostas/abertas', rotulo: 'Abertas' },
      { href: '/propostas/fechadas', rotulo: 'Fechadas' },
    ],
  },
  {
    base: '/relatorios',
    rotulo: 'Relatórios',
    Icone: IconeRelatorios,
    filhos: [
      { href: '/relatorios/vendas', rotulo: 'Vendas' },
      { href: '/relatorios/conversao', rotulo: 'Conversão' },
      { href: '/relatorios/exportacao', rotulo: 'Exportação' },
    ],
  },
  {
    base: '/configuracoes',
    rotulo: 'Configurações',
    Icone: IconeConfiguracoes,
    filhos: [
      { href: '/configuracoes/usuarios', rotulo: 'Usuários', somenteGerente: true },
      { href: '/configuracoes/etapas', rotulo: 'Etapas', somenteGerente: true },
      { href: '/configuracoes/nichos', rotulo: 'Nichos' },
      { href: '/configuracoes/servicos', rotulo: 'Serviços' },
      { href: '/configuracoes/agenda', rotulo: 'Agenda Google', somenteGerente: true },
    ],
  },
]

function dentroDe(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Entre subitens aninhados (/funil e /funil/metricas) vence o mais específico. */
function subitemAtivo(pathname: string, filhos: Subitem[]): string | undefined {
  return filhos
    .filter((f) => dentroDe(pathname, f.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
}

const linhaBase =
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:px-0'
const linhaAtiva = 'bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
const linhaInativa = 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/**
 * Client pelo `usePathname` (item ativo) e pelo estado dos grupos abertos.
 *
 * Sidebar expandida: o grupo é um botão que abre/fecha os subitens; o grupo
 * da página atual começa aberto. Sidebar recolhida: o ícone do grupo leva ao
 * primeiro subitem, e passar o mouse ou focar nele abre um painel flutuante
 * com os subitens (`group-hover` / `group-focus-within`, então o teclado
 * também chega lá: Tab do ícone entra no painel).
 */
export function SidebarNav({ papel }: { papel: Papel }) {
  const pathname = usePathname()
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})

  return (
    <nav
      aria-label="Menu principal"
      className="flex-1 overflow-y-auto p-3 group-data-[sidebar=recolhida]/shell:overflow-visible group-data-[sidebar=recolhida]/shell:px-2"
    >
      <ul className="space-y-1">
        {MENU.map((item) => {
          if (!('filhos' in item)) {
            const ativo = dentroDe(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.rotulo}
                  aria-current={ativo ? 'page' : undefined}
                  className={`${linhaBase} ${ativo ? linhaAtiva : linhaInativa}`}
                >
                  <item.Icone />
                  <span className="truncate group-data-[sidebar=recolhida]/shell:sr-only">{item.rotulo}</span>
                </Link>
              </li>
            )
          }

          const filhos = item.filhos.filter((f) => !f.somenteGerente || papel === 'gerente')
          if (filhos.length === 0) return null

          const ativoGrupo = dentroDe(pathname, item.base)
          const aberto = abertos[item.base] ?? ativoGrupo
          return (
            <GrupoMenu
              key={item.base}
              grupo={item}
              filhos={filhos}
              ativoGrupo={ativoGrupo}
              ativoHref={subitemAtivo(pathname, filhos)}
              aberto={aberto}
              alternar={() => setAbertos((a) => ({ ...a, [item.base]: !aberto }))}
            />
          )
        })}
      </ul>
    </nav>
  )
}

function GrupoMenu({
  grupo,
  filhos,
  ativoGrupo,
  ativoHref,
  aberto,
  alternar,
}: {
  grupo: Grupo
  filhos: Subitem[]
  ativoGrupo: boolean
  ativoHref: string | undefined
  aberto: boolean
  alternar: () => void
}) {
  const idLista = `submenu-${grupo.base.slice(1)}`

  return (
    <li className="group/item relative">
      {/* Expandida: abre/fecha os subitens. */}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        aria-controls={idLista}
        className={`${linhaBase} w-full group-data-[sidebar=recolhida]/shell:hidden ${
          ativoGrupo ? 'font-medium text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800' : linhaInativa
        }`}
      >
        <grupo.Icone />
        <span className="flex-1 truncate text-left">{grupo.rotulo}</span>
        <IconeSeta className={`size-4 text-zinc-400 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`} />
      </button>

      {aberto && (
        <ul id={idLista} className="mt-1 space-y-1 pl-8 group-data-[sidebar=recolhida]/shell:hidden">
          {filhos.map((f) => (
            <li key={f.href}>
              <LinkSubitem subitem={f} ativo={f.href === ativoHref} />
            </li>
          ))}
        </ul>
      )}

      {/* Recolhida: ícone leva ao primeiro subitem; o painel mostra todos. */}
      <Link
        href={filhos[0].href}
        aria-label={grupo.rotulo}
        className={`${linhaBase} hidden group-data-[sidebar=recolhida]/shell:flex ${ativoGrupo ? linhaAtiva : linhaInativa}`}
      >
        <grupo.Icone />
      </Link>

      <div className="absolute top-0 left-full z-40 hidden pl-2 group-data-[sidebar=recolhida]/shell:group-focus-within/item:block group-data-[sidebar=recolhida]/shell:group-hover/item:block">
        <div className="min-w-44 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <p className="px-3 py-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{grupo.rotulo}</p>
          <ul className="space-y-0.5">
            {filhos.map((f) => (
              <li key={f.href}>
                <LinkSubitem subitem={f} ativo={f.href === ativoHref} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  )
}

function LinkSubitem({ subitem, ativo }: { subitem: Subitem; ativo: boolean }) {
  return (
    <Link
      href={subitem.href}
      aria-current={ativo ? 'page' : undefined}
      className={`block truncate rounded-md px-3 py-1.5 text-sm transition ${ativo ? linhaAtiva : linhaInativa}`}
    >
      {subitem.rotulo}
    </Link>
  )
}
