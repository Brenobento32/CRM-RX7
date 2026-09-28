'use client'

import { useEffect, useRef, useState } from 'react'

import { minutosAgora } from '@/lib/utils/calendario'

/**
 * Linha do horário atual. Recebe o minuto já calculado no servidor (mesmo
 * valor no primeiro render do cliente, para não gerar erro de hidratação) e
 * só passa a se atualizar sozinha depois de montada.
 *
 * Não rola até si mesma — quem posiciona o scroll inicial da grade é o
 * `GradeScroll` (sempre ~08:00), pra não competir com "agora" quando os dois
 * discordam de onde abrir a grade.
 */
export function LinhaAgora({ minutoInicial, alturaHoraPx }: { minutoInicial: number; alturaHoraPx: number }) {
  const [minutos, setMinutos] = useState(minutoInicial)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setMinutos(minutosAgora()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: (minutos / 60) * alturaHoraPx }}
    >
      <span className="-ml-1 size-2 shrink-0 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500" />
    </div>
  )
}
