'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'

type Estado = { temRolagem: boolean; podeVoltar: boolean; podeAvancar: boolean }

/** Folga para arredondamento de subpixel no fim da rolagem. */
const FOLGA = 2

/**
 * Setas de navegação para um container de rolagem horizontal (as colunas do
 * Kanban). Não mexe no container: só lê a rolagem e chama `scrollTo`, então
 * o arraste do dnd-kit e a rolagem por trackpad/barra seguem iguais.
 *
 * O passo é uma coluna, medido na primeira coluna + o `gap` do container,
 * e o destino encaixa no começo de uma coluna.
 */
export function useRolagemHorizontal(ref: RefObject<HTMLElement | null>) {
  const [estado, setEstado] = useState<Estado>({ temRolagem: false, podeVoltar: false, podeAvancar: false })

  const atualizar = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const novo = {
      temRolagem: max > FOLGA,
      podeVoltar: el.scrollLeft > FOLGA,
      podeAvancar: el.scrollLeft < max - FOLGA,
    }
    setEstado((atual) =>
      atual.temRolagem === novo.temRolagem &&
      atual.podeVoltar === novo.podeVoltar &&
      atual.podeAvancar === novo.podeAvancar
        ? atual
        : novo,
    )
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    el.addEventListener('scroll', atualizar, { passive: true })
    // Dispara ao observar e a cada mudança de tamanho: janela, sidebar
    // recolhida/expandida, colunas entrando ou saindo.
    const observador = new ResizeObserver(atualizar)
    observador.observe(el)
    for (const filho of Array.from(el.children)) observador.observe(filho)

    return () => {
      el.removeEventListener('scroll', atualizar)
      observador.disconnect()
    }
  }, [ref, atualizar])

  const rolar = useCallback(
    (direcao: -1 | 1) => {
      const el = ref.current
      const coluna = el?.firstElementChild
      if (!el || !coluna) return

      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      const passo = coluna.getBoundingClientRect().width + gap
      const alvo = (Math.round(el.scrollLeft / passo) + direcao) * passo
      const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      el.scrollTo({ left: alvo, behavior: reduzirMovimento ? 'auto' : 'smooth' })
    },
    [ref],
  )

  return { ...estado, rolar }
}
