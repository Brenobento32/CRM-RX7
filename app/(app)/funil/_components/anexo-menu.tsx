'use client'

import { useEffect, useId, useRef } from 'react'

const LARGURA_MENU = 224

/**
 * Só o visual, preparado pra quando upload/envio de mídia existir. Nenhum
 * item é clicável de verdade nesta etapa — "em breve" em todos, sem fingir
 * que algo foi enviado.
 */
const ITENS = [
  { rotulo: 'Fotos e vídeos', icone: '🖼️' },
  { rotulo: 'Documento', icone: '📄' },
  { rotulo: 'Câmera', icone: '📷' },
  { rotulo: 'Áudio', icone: '🎵' },
] as const

/** Botão 📎 + menu de anexos pro composer do `PainelConversa` — mesma Popover API nativa de `MenuMoverPara`. */
export function AnexoMenu({ disabled = false }: { disabled?: boolean }) {
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
      menu.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - LARGURA_MENU - 8)}px`
    }

    function aoAlternar(e: Event) {
      if ((e as ToggleEvent).newState === 'open') posicionar()
    }

    menu.addEventListener('toggle', aoAlternar)
    return () => menu.removeEventListener('toggle', aoAlternar)
  }, [])

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        popoverTarget={`${id}-anexo`}
        aria-haspopup="menu"
        aria-label="Anexar"
        title="Anexar"
        disabled={disabled}
        className="shrink-0 rounded-md p-2 text-lg leading-none transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-800"
      >
        📎
      </button>

      <div
        ref={menuRef}
        id={`${id}-anexo`}
        popover="auto"
        role="menu"
        aria-label="Anexar arquivo"
        className="fixed m-0 rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        style={{ width: LARGURA_MENU, inset: 'auto' }}
      >
        {ITENS.map((item) => (
          <button
            key={item.rotulo}
            type="button"
            role="menuitem"
            disabled
            title="Em breve"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-500"
          >
            <span aria-hidden>{item.icone}</span>
            <span className="truncate">{item.rotulo}</span>
            <span className="ml-auto shrink-0 text-xs">Em breve</span>
          </button>
        ))}
      </div>
    </>
  )
}
