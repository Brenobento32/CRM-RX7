'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { Funil } from '@/lib/dal/funis'
import { inputClass } from '@/components/ui/estilos'

const selectClass =
  `${inputClass} w-auto pr-8`

/**
 * Filtro de funil da tela de Leads — "Todos" (sem `?funil=`) ou um funil
 * específico. Troca a lista imediatamente (navegação), preserva a aba atual
 * (já está em `?aba=` na URL, não precisamos recriar aqui).
 */
export function SeletorFunilLeads({
  funis,
  funilId,
}: {
  funis: Pick<Funil, 'id' | 'nome' | 'ativo'>[]
  funilId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function trocar(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('funil', id)
    else params.delete('funil')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="seletor-funil-leads" className="text-sm text-premium-secundario">
        Funil:
      </label>
      <select
        id="seletor-funil-leads"
        value={funilId ?? ''}
        onChange={(e) => trocar(e.target.value)}
        className={selectClass}
      >
        <option value="">Todos</option>
        {funis
          .filter((f) => f.ativo || f.id === funilId)
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
      </select>
    </div>
  )
}
