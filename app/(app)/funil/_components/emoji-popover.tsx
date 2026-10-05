'use client'

import dynamic from 'next/dynamic'
import { useEffect, useId, useRef, useState } from 'react'

import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'

const LARGURA_POPOVER = 320
const ALTURA_POPOVER = 380

/**
 * O componente inteiro (categorias, busca, dados de todos os emojis) só é
 * buscado quando o popover abre pela primeira vez — não entra no bundle
 * inicial do `/funil`. `EmojiStyle`/`Theme` não são importados como valor
 * aqui (só como tipo, acima, que o TS descarta em tempo de build) pra não
 * criar um segundo caminho estático até o pacote e anular esse code-split.
 */
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

/**
 * Botão 😊 + seletor completo de emojis pro composer do `PainelConversa`.
 *
 * O botão e o container do popover usam a Popover API nativa (mesma ideia de
 * `MenuMoverPara`): vão pra top layer — não afetam a largura/layout do
 * painel — e Esc / clique fora já fecham sozinhos, sem listener nenhum. O
 * seletor em si (categorias, busca, rolagem, teclado) é o `emoji-picker-react`
 * — renderiza emoji nativo do sistema (`emojiStyle: 'native'`), sem buscar
 * imagem nenhuma de CDN.
 */
export function EmojiPopover({
  onEscolher,
  disabled = false,
}: {
  onEscolher: (emoji: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const botaoRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    const popover = popoverRef.current
    const botao = botaoRef.current
    if (!popover || !botao) return

    function posicionar() {
      if (!popover || !botao) return
      const r = botao.getBoundingClientRect()
      const altura = popover.offsetHeight || ALTURA_POPOVER
      const cabeEmCima = r.top - 4 - altura >= 0
      popover.style.top = `${cabeEmCima ? r.top - 4 - altura : r.bottom + 4}px`
      popover.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - LARGURA_POPOVER - 8)}px`
    }

    function aoAlternar(e: Event) {
      const estado = (e as ToggleEvent).newState
      setAberto(estado === 'open')
      if (estado === 'open') posicionar()
    }

    popover.addEventListener('toggle', aoAlternar)
    return () => popover.removeEventListener('toggle', aoAlternar)
  }, [])

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        popoverTarget={`${id}-emoji`}
        aria-haspopup="true"
        aria-label="Inserir emoji"
        title="Emoji"
        disabled={disabled}
        className="shrink-0 rounded-md p-2 text-lg leading-none transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-800"
      >
        😊
      </button>

      <div
        ref={popoverRef}
        id={`${id}-emoji`}
        popover="auto"
        aria-label="Selecionar emoji"
        className="fixed m-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-0 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        style={{ width: LARGURA_POPOVER, height: ALTURA_POPOVER, inset: 'auto' }}
      >
        {aberto && (
          <EmojiPicker
            // Não fecha o popover (igual ao WhatsApp Web): dá pra escolher
            // vários emojis em sequência. Fechar aqui competia com o foco
            // que a textarea precisa receber de volta — ver `inserirEmoji`.
            onEmojiClick={(dado: EmojiClickData) => onEscolher(dado.emoji)}
            autoFocusSearch
            lazyLoadEmojis
            previewConfig={{ showPreview: false }}
            emojiStyle={'native' as EmojiStyle}
            theme={'auto' as Theme}
            width={LARGURA_POPOVER}
            height={ALTURA_POPOVER}
          />
        )}
      </div>
    </>
  )
}
