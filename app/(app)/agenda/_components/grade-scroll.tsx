'use client'

import { useLayoutEffect, useRef } from 'react'

/**
 * Container com scroll da grade de horas. Posiciona o scroll inicial em
 * `topoPx` (~08:00) antes do navegador pintar — `useLayoutEffect`, não
 * `useEffect`, pra não haver um pulo visível de "abre do topo e salta pra
 * 08:00". Isolado num Client Component pequeno só por causa disso: o
 * conteúdo em si (cabeçalho, horas, eventos) continua vindo do servidor.
 */
export function GradeScroll({ topoPx, children }: { topoPx: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = topoPx
    // Só na montagem: é a posição inicial, não deve reagir a novas renderizações.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={ref} className="max-h-[70vh] min-h-[420px] overflow-y-auto">
      {children}
    </div>
  )
}
