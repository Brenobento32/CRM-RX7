'use client'

import { useEffect, useId, useRef } from 'react'

import { EmojiPopover } from './emoji-popover'

const LARGURA_MENU = 224

/** Mesmos emojis de reação rápida do WhatsApp Web — conteúdo real da reação, não ícone de interface (por isso ficam de fora da regra "sem emoji nos ícones"). */
const EMOJIS_RAPIDOS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const ITEM_CLASSE =
  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-premium-bg disabled:cursor-not-allowed disabled:opacity-60'

function IconeMais({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

type Props = {
  /** Se existe conteúdo/legenda pra copiar — sem isso, o item "Copiar" nem aparece. */
  copiavel: boolean
  onCopiar: () => void
  onResponder: () => void
  onReagir: (emoji: string) => void
  onEncaminhar: () => void
  onSelecionar: () => void
  onExcluir: () => void
}

/**
 * Menu de ações da mensagem — mesma Popover API nativa de `AnexoMenu`/
 * `EmojiPopover` (top layer, nunca cortado pelo drawer; Esc/clique fora já
 * fecham sozinhos, de graça). O botão ⋮ fica sempre visível (não só no
 * hover): funciona igual em desktop e mobile sem precisar detectar o tipo
 * de ponteiro. A linha de reação rápida já fica aberta dentro do próprio
 * menu (sem sub-tela) — clicar num emoji ou em "mais emojis" (reaproveita o
 * `EmojiPopover` inteiro, empilhado por cima) reage e fecha tudo.
 */
export function MenuMensagem({ copiavel, onCopiar, onResponder, onReagir, onEncaminhar, onSelecionar, onExcluir }: Props) {
  const id = useId()
  const botaoRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    const botao = botaoRef.current
    if (!menu || !botao) return

    function posicionar() {
      if (!menu || !botao) return
      const r = botao.getBoundingClientRect()
      const altura = menu.offsetHeight
      const cabeEmCima = r.top - 4 - altura >= 0
      menu.style.top = `${cabeEmCima ? r.top - 4 - altura : r.bottom + 4}px`
      menu.style.left = `${Math.min(Math.max(8, r.right - LARGURA_MENU), window.innerWidth - LARGURA_MENU - 8)}px`
    }

    function aoAlternar(e: Event) {
      if ((e as ToggleEvent).newState === 'open') posicionar()
    }

    menu.addEventListener('toggle', aoAlternar)
    return () => menu.removeEventListener('toggle', aoAlternar)
  }, [])

  function fechar() {
    menuRef.current?.hidePopover()
  }

  function disparar<A extends unknown[]>(fn: (...args: A) => void, ...args: A) {
    fechar()
    fn(...args)
  }

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        popoverTarget={`${id}-menu-mensagem`}
        aria-haspopup="menu"
        aria-label="Mais ações da mensagem"
        title="Mais ações"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-current opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
      >
        <IconeMais />
      </button>

      <div
        ref={menuRef}
        id={`${id}-menu-mensagem`}
        popover="auto"
        role="menu"
        aria-label="Ações da mensagem"
        className="fixed m-0 rounded-lg border border-premium-borda bg-premium-card p-1 text-premium-texto shadow-premium-alta"
        style={{ width: LARGURA_MENU, inset: 'auto' }}
      >
        <div className="flex items-center justify-between gap-0.5 px-0.5 py-1">
          {EMOJIS_RAPIDOS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => disparar(onReagir, emoji)}
              aria-label={`Reagir com ${emoji}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-base transition hover:bg-premium-bg"
            >
              {emoji}
            </button>
          ))}
          <div className="[&>button]:flex [&>button]:size-7 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:text-base [&>button]:leading-none [&>button]:transition [&>button]:hover:bg-zinc-100 dark:[&>button]:hover:bg-zinc-800">
            <EmojiPopover onEscolher={(emoji) => disparar(onReagir, emoji)} />
          </div>
        </div>

        <div className="my-1 border-t border-premium-borda" />

        <button type="button" role="menuitem" onClick={() => disparar(onResponder)} className={ITEM_CLASSE}>
          Responder
        </button>
        {copiavel && (
          <button type="button" role="menuitem" onClick={() => disparar(onCopiar)} className={ITEM_CLASSE}>
            Copiar
          </button>
        )}
        <button type="button" role="menuitem" onClick={() => disparar(onEncaminhar)} className={ITEM_CLASSE}>
          Encaminhar
        </button>
        <button type="button" role="menuitem" onClick={() => disparar(onSelecionar)} className={ITEM_CLASSE}>
          Selecionar
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => disparar(onExcluir)}
          className={`${ITEM_CLASSE} text-red-600 dark:text-red-400`}
        >
          Excluir para mim
        </button>
      </div>
    </>
  )
}
