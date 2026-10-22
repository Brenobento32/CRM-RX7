'use client'

import { useRotaInterna } from '@/lib/empresa/use-rota-interna'
import { createContext, useContext, useState } from 'react'

import { IconeExpandir, IconeRecolher } from './icones'
import {
  COOKIE_SIDEBAR,
  COOKIE_SIDEBAR_MAX_AGE,
  SIDEBAR_RECOLHIDA,
} from './preferencia-sidebar'
import { COOKIE_TEMA, COOKIE_TEMA_MAX_AGE, TEMA_CLARO } from './preferencia-tema'

const ContextoSidebar = createContext<{ recolhida: boolean; alternar: () => void } | null>(null)

/**
 * Tema claro/escuro do design system premium — mesma ideia do
 * `ContextoSidebar` (estado vive aqui, cookie grava a preferência pro
 * servidor já renderizar certo da próxima vez). Só afeta as rotas/casca que
 * já usam tokens `premium-*` (ver `ROTAS_PREMIUM` abaixo); as demais telas
 * continuam no esquema claro/escuro antigo (`prefers-color-scheme`),
 * intocado.
 */
const ContextoTema = createContext<{ claro: boolean; alternar: () => void } | null>(null)

/** Consome o tema premium atual — usado pelo botão de alternância na topbar. */
export function useTemaPremium() {
  return useContext(ContextoTema)
}

/**
 * Rotas que usam o novo visual "dashboard premium" (fundo escuro, largura
 * ampliada até 1600px) — `/funil/metricas`, `/metas` e `/funil` (Kanban)
 * nesta rodada. As demais continuam no visual padrão claro/`max-w-6xl` até
 * migrarem também; a sidebar e a topbar, por serem casca compartilhada, já
 * ficam escuras em toda rota — só o CONTEÚDO (`main`) varia por aqui.
 * Allowlist explícita por pathname exato (nunca `startsWith`/prefixo): uma
 * tela nova só entra se for adicionada aqui de propósito, nunca "por
 * engano" por estar debaixo da mesma rota.
 */
const ROTAS_PREMIUM = new Set(['/funil/metricas', '/metas', '/funil'])

/**
 * Casca da área autenticada: sidebar fixa + conteúdo.
 *
 * O estado recolhido vive aqui e vira `data-sidebar` no elemento raiz. As
 * partes da sidebar que são Server Components (usuário, sair) reagem por CSS
 * (`group-data-[sidebar=recolhida]/shell:*`), sem precisar virar client.
 */
export function ShellApp({
  recolhidaInicial,
  temaClaroInicial,
  sidebar,
  children,
}: {
  recolhidaInicial: boolean
  temaClaroInicial: boolean
  sidebar: React.ReactNode
  children: React.ReactNode
}) {
  const [recolhida, setRecolhida] = useState(recolhidaInicial)
  const [temaClaro, setTemaClaro] = useState(temaClaroInicial)
  const premium = ROTAS_PREMIUM.has(useRotaInterna())

  function alternar() {
    const nova = !recolhida
    setRecolhida(nova)
    document.cookie = `${COOKIE_SIDEBAR}=${nova ? SIDEBAR_RECOLHIDA : 'expandida'}; path=/; max-age=${COOKIE_SIDEBAR_MAX_AGE}; samesite=lax`
  }

  function alternarTema() {
    const novo = !temaClaro
    setTemaClaro(novo)
    document.cookie = `${COOKIE_TEMA}=${novo ? TEMA_CLARO : 'escuro'}; path=/; max-age=${COOKIE_TEMA_MAX_AGE}; samesite=lax`
  }

  return (
    <ContextoSidebar.Provider value={{ recolhida, alternar }}>
      <ContextoTema.Provider value={{ claro: temaClaro, alternar: alternarTema }}>
        <div
          data-sidebar={recolhida ? 'recolhida' : 'expandida'}
          data-theme={temaClaro ? 'light' : undefined}
          className="group/shell flex min-h-full flex-1"
        >
          <aside className="fixed inset-y-0 left-0 z-30 flex w-[220px] flex-col border-r border-premium-borda bg-premium-elevado transition-[width] duration-200 group-data-[sidebar=recolhida]/shell:w-[70px] motion-reduce:transition-none">
            {sidebar}
          </aside>
          <main
            className={`flex-1 pl-[220px] transition-[padding] duration-200 group-data-[sidebar=recolhida]/shell:pl-[70px] motion-reduce:transition-none ${
              premium ? 'min-h-full bg-premium-bg' : ''
            }`}
          >
            <div className={premium ? 'mx-auto max-w-[1600px] px-6 py-6' : 'mx-auto max-w-6xl px-8 py-8'}>{children}</div>
          </main>
        </div>
      </ContextoTema.Provider>
    </ContextoSidebar.Provider>
  )
}

/**
 * `variant="icone"` (padrão): botão compacto, só o ícone — uso solto.
 * `variant="linha"`: linha de largura total com rótulo, no mesmo padrão
 * visual dos itens de navegação — usada no rodapé da sidebar.
 */
export function BotaoRecolherSidebar({ variant = 'icone' }: { variant?: 'icone' | 'linha' }) {
  const contexto = useContext(ContextoSidebar)
  if (!contexto) return null
  const { recolhida, alternar } = contexto
  const rotulo = recolhida ? 'Expandir menu' : 'Recolher menu'

  if (variant === 'linha') {
    return (
      <button
        type="button"
        onClick={alternar}
        aria-expanded={!recolhida}
        title={rotulo}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-premium-secundario transition hover:bg-premium-card hover:text-premium-texto group-data-[sidebar=recolhida]/shell:justify-center group-data-[sidebar=recolhida]/shell:px-0"
      >
        {recolhida ? <IconeExpandir className="size-5 shrink-0" /> : <IconeRecolher className="size-5 shrink-0" />}
        <span className="truncate group-data-[sidebar=recolhida]/shell:sr-only">{rotulo}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-expanded={!recolhida}
      aria-label={rotulo}
      title={rotulo}
      className="rounded-md p-1.5 text-premium-mudo transition hover:bg-premium-card hover:text-premium-texto"
    >
      {recolhida ? <IconeExpandir /> : <IconeRecolher />}
    </button>
  )
}
