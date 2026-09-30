'use client'

import { useEffect, useId, useRef } from 'react'

import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { tipoExigeModal, type EtapaKanban } from '@/lib/utils/etapas'

const LARGURA_MENU = 208

/**
 * "Mover para": troca de etapa sem arrastar (teclado, touch, precisão).
 *
 * Usa a Popover API nativa: o menu vai para a top layer — não é cortado pela
 * rolagem horizontal do quadro — e Esc / clique fora já o fecham. A posição
 * é calculada a partir do botão na abertura.
 *
 * O card inteiro escuta ponteiro e teclado do dnd-kit. Botão e menu param a
 * propagação, senão um Enter aqui iniciaria um arraste pelo teclado.
 */
export function MenuMoverPara({
  etapaAtual,
  etapas,
  nomeCliente,
  onEscolher,
}: {
  /** Id da etapa em que o card está. */
  etapaAtual: string
  etapas: EtapaKanban[]
  nomeCliente: string
  onEscolher: (etapaId: string) => void
}) {
  const id = useId()
  const botaoRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    const botao = botaoRef.current
    if (!menu || !botao) return

    const fechar = () => menu.hidePopover()

    function posicionar() {
      if (!menu || !botao) return
      const r = botao.getBoundingClientRect()
      const altura = menu.offsetHeight
      const cabeEmbaixo = r.bottom + 4 + altura <= window.innerHeight
      menu.style.top = `${cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - 4 - altura)}px`
      menu.style.left = `${Math.min(
        Math.max(8, r.right - LARGURA_MENU),
        window.innerWidth - LARGURA_MENU - 8,
      )}px`
    }

    function aoAlternar(e: Event) {
      if ((e as ToggleEvent).newState === 'open') {
        posicionar()
        menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        // Menu fixo na tela: rolar ou redimensionar o descolaria do botão.
        window.addEventListener('scroll', fechar, true)
        window.addEventListener('resize', fechar)
      } else {
        window.removeEventListener('scroll', fechar, true)
        window.removeEventListener('resize', fechar)
      }
    }

    menu.addEventListener('toggle', aoAlternar)
    return () => {
      menu.removeEventListener('toggle', aoAlternar)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
  }, [])

  function navegarComSetas(e: React.KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const itens = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const atual = itens.indexOf(document.activeElement as HTMLElement)
    const proximo = e.key === 'ArrowDown' ? atual + 1 : atual - 1
    itens[(proximo + itens.length) % itens.length]?.focus()
  }

  const pararArraste = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  }

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        popoverTarget={`${id}-menu`}
        aria-haspopup="menu"
        aria-label={`Mover ${nomeCliente} para outra etapa`}
        title="Mover para"
        onClick={(e) => e.stopPropagation()}
        className="-mt-0.5 -mr-1 shrink-0 cursor-pointer rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        {...pararArraste}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      <div
        ref={menuRef}
        id={`${id}-menu`}
        popover="auto"
        role="menu"
        aria-label="Mover para"
        onKeyDown={navegarComSetas}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="fixed m-0 rounded-lg border border-zinc-200 bg-white p-1 text-sm text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        style={{ width: LARGURA_MENU, inset: 'auto' }}
      >
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-zinc-500">Mover para</p>
        {etapas.filter((etapa) => etapa.id !== etapaAtual).map((etapa) => (
          <button
            key={etapa.id}
            type="button"
            role="menuitem"
            onClick={() => {
              menuRef.current?.hidePopover()
              onEscolher(etapa.id)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
          >
            <PontoEtapa cor={etapa.cor} />
            <span className="truncate">{etapa.nome}</span>
            {tipoExigeModal(etapa.tipo) && <span className="ml-auto text-xs text-zinc-400">…</span>}
          </button>
        ))}
      </div>
    </>
  )
}
