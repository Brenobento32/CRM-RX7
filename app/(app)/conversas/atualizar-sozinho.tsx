'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Recarrega a caixa de entrada de tempos em tempos, só com a aba visível e sem ninguém digitando. */
export function AtualizarSozinho({ segundos }: { segundos: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      const digitando = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value !== ''
      if (document.visibilityState === 'visible' && !digitando) router.refresh()
    }, segundos * 1000)
    return () => clearInterval(id)
  }, [router, segundos])
  return null
}
