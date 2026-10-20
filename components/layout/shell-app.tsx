'use client'

import { usePathname } from 'next/navigation'
import { createContext, useContext, useState } from 'react'

import { IconeExpandir, IconeRecolher } from './icones'
import {
  COOKIE_SIDEBAR,
  COOKIE_SIDEBAR_MAX_AGE,
  SIDEBAR_RECOLHIDA,
} from './preferencia-sidebar'

const ContextoSidebar = createContext<{ recolhida: boolean; alternar: () => void } | null>(null)

/**
 * Rotas que podem usar mais largura que o padrão do CRM (`max-w-6xl`,
 * ~1152px) — hoje só o dashboard de métricas do funil, que tem três painéis
 * lado a lado e desperdiça espaço em monitores largos com o teto padrão.
 * Allowlist explícita por pathname exato (nunca `startsWith`/prefixo): uma
 * tela nova só ganha mais largura se for adicionada aqui de propósito,
 * nunca "por engano" por estar debaixo da mesma rota.
 */
const ROTAS_LARGURA_AMPLIADA = new Set(['/funil/metricas'])

/**
 * Casca da área autenticada: sidebar fixa + conteúdo.
 *
 * O estado recolhido vive aqui e vira `data-sidebar` no elemento raiz. As
 * partes da sidebar que são Server Components (usuário, sair) reagem por CSS
 * (`group-data-[sidebar=recolhida]/shell:*`), sem precisar virar client.
 */
export function ShellApp({
  recolhidaInicial,
  sidebar,
  children,
}: {
  recolhidaInicial: boolean
  sidebar: React.ReactNode
  children: React.ReactNode
}) {
  const [recolhida, setRecolhida] = useState(recolhidaInicial)
  const larguraAmpliada = ROTAS_LARGURA_AMPLIADA.has(usePathname())

  function alternar() {
    const nova = !recolhida
    setRecolhida(nova)
    document.cookie = `${COOKIE_SIDEBAR}=${nova ? SIDEBAR_RECOLHIDA : 'expandida'}; path=/; max-age=${COOKIE_SIDEBAR_MAX_AGE}; samesite=lax`
  }

  return (
    <ContextoSidebar.Provider value={{ recolhida, alternar }}>
      <div
        data-sidebar={recolhida ? 'recolhida' : 'expandida'}
        className="group/shell flex min-h-full flex-1"
      >
        <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-zinc-200 bg-white transition-[width] duration-200 group-data-[sidebar=recolhida]/shell:w-16 motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-950">
          {sidebar}
        </aside>
        <main className="flex-1 pl-60 transition-[padding] duration-200 group-data-[sidebar=recolhida]/shell:pl-16 motion-reduce:transition-none">
          <div className={larguraAmpliada ? 'mx-auto max-w-[1600px] px-8 py-8' : 'mx-auto max-w-6xl px-8 py-8'}>
            {children}
          </div>
        </main>
      </div>
    </ContextoSidebar.Provider>
  )
}

export function BotaoRecolherSidebar() {
  const contexto = useContext(ContextoSidebar)
  if (!contexto) return null
  const { recolhida, alternar } = contexto

  return (
    <button
      type="button"
      onClick={alternar}
      aria-expanded={!recolhida}
      aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
      title={recolhida ? 'Expandir menu' : 'Recolher menu'}
      className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {recolhida ? <IconeExpandir /> : <IconeRecolher />}
    </button>
  )
}
