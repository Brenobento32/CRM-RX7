'use client'

import { useRotaInterna } from '@/lib/empresa/use-rota-interna'
import { createContext, useContext, useState, useSyncExternalStore } from 'react'

import { IconeExpandir, IconeRecolher } from './icones'
import {
  COOKIE_SIDEBAR,
  COOKIE_SIDEBAR_MAX_AGE,
  SIDEBAR_RECOLHIDA,
} from './preferencia-sidebar'
import { aplicarTema } from './preferencia-tema'

const ContextoSidebar = createContext<{ recolhida: boolean; alternar: () => void } | null>(null)

/**
 * Tema claro/escuro do AVANTE. O valor de verdade é o atributo `data-tema` do
 * <html> (aplicado antes de pintar pelo script do `app/layout.tsx`); este
 * contexto só espelha o estado para o interruptor e grava a escolha.
 */
const ContextoTema = createContext<{ claro: boolean; alternar: () => void } | null>(null)

/** Consome o tema premium atual — usado pelo botão de alternância na topbar. */
export function useTemaPremium() {
  return useContext(ContextoTema)
}

/**
 * Rotas de painel largo (até 1600px): `/funil/metricas`, `/metas` e `/funil`
 * (Kanban). As demais usam `max-w-6xl`. Cores e tema são os mesmos em todas.
 * Allowlist explícita por pathname exato (nunca `startsWith`/prefixo): uma
 * tela nova só entra se for adicionada aqui de propósito.
 */
const ROTAS_PREMIUM = new Set(['/funil/metricas', '/metas', '/funil'])

const CONSULTA_ESTREITA = '(max-width: 1023px)'

function assinarTelaEstreita(avisar: () => void) {
  const mq = window.matchMedia(CONSULTA_ESTREITA)
  mq.addEventListener('change', avisar)
  return () => mq.removeEventListener('change', avisar)
}

function telaEstreita() {
  return window.matchMedia(CONSULTA_ESTREITA).matches
}

/** Avisa quando o atributo `data-tema` do <html> muda (pelo interruptor). */
function assinarTema(avisar: () => void) {
  const observador = new MutationObserver(avisar)
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] })
  return () => observador.disconnect()
}

function temaAtualClaro() {
  return document.documentElement.getAttribute('data-tema') === 'claro'
}

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
  topo,
  children,
}: {
  recolhidaInicial: boolean
  temaClaroInicial: boolean
  sidebar: React.ReactNode
  /** Cabeçalho global (usuário, notificações, menu do perfil) — igual em toda página. */
  topo?: React.ReactNode
  children: React.ReactNode
}) {
  const [recolhidaDesktop, setRecolhidaDesktop] = useState(recolhidaInicial)
  // Tela estreita (celular/tablet em pé): menu começa recolhido, só ícones, e
  // abrir/fechar ali não grava cookie — a preferência do computador fica igual.
  const [abertaNaTelaEstreita, setAbertaNaTelaEstreita] = useState(false)
  const estreita = useSyncExternalStore(assinarTelaEstreita, telaEstreita, () => false)
  const recolhida = estreita ? !abertaNaTelaEstreita : recolhidaDesktop
  const sobreposto = estreita && abertaNaTelaEstreita

  // O tema de verdade é o atributo do <html> (sem cookie, o script do <head>
  // segue o sistema); aqui só se lê esse atributo, nunca uma cópia.
  const temaClaro = useSyncExternalStore(assinarTema, temaAtualClaro, () => temaClaroInicial)
  const premium = ROTAS_PREMIUM.has(useRotaInterna())

  function alternar() {
    if (estreita) {
      setAbertaNaTelaEstreita((v) => !v)
      return
    }
    const nova = !recolhidaDesktop
    setRecolhidaDesktop(nova)
    document.cookie = `${COOKIE_SIDEBAR}=${nova ? SIDEBAR_RECOLHIDA : 'expandida'}; path=/; max-age=${COOKIE_SIDEBAR_MAX_AGE}; samesite=lax`
  }

  function alternarTema() {
    aplicarTema(!temaClaro)
  }

  return (
    <ContextoSidebar.Provider value={{ recolhida, alternar }}>
      <ContextoTema.Provider value={{ claro: temaClaro, alternar: alternarTema }}>
        <div
          data-sidebar={recolhida ? 'recolhida' : 'expandida'}
          // Tela estreita com o menu aberto: ele fica POR CIMA do conteúdo (não o espreme).
          data-sobreposto={sobreposto ? 'sim' : undefined}
          className="group/shell flex min-h-full flex-1"
        >
          {sobreposto && (
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setAbertaNaTelaEstreita(false)}
              className="fixed inset-0 z-20 bg-black/40"
            />
          )}
          <aside
            // No celular, escolher um item do menu já o fecha.
            onClickCapture={(e) => {
              if (sobreposto && (e.target as HTMLElement).closest('a[href]')) setAbertaNaTelaEstreita(false)
            }}
            className="fixed inset-y-0 left-0 z-30 flex w-[232px] flex-col border-r border-premium-borda bg-premium-lateral transition-[width] duration-200 group-data-[sidebar=recolhida]/shell:w-[70px] group-data-[sobreposto=sim]/shell:shadow-2xl motion-reduce:transition-none"
          >
            {sidebar}
          </aside>
          <main
            className="min-h-full min-w-0 flex-1 bg-premium-bg pl-[232px] text-premium-texto transition-[padding] duration-200 group-data-[sidebar=recolhida]/shell:pl-[70px] group-data-[sobreposto=sim]/shell:pl-[70px] motion-reduce:transition-none"
          >
            {topo && (
              <header className="sticky top-0 z-20 flex h-14 items-center justify-end border-b border-premium-borda bg-premium-topo/95 px-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur sm:px-6 lg:px-8">
                {topo}
              </header>
            )}
            <div
              className={
                premium
                  ? 'mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6'
                  : 'mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8'
              }
            >
              {children}
            </div>
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
