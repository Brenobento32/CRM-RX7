'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { Funil } from '@/lib/dal/funis'

const selectClass =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

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
      <label htmlFor="seletor-funil-leads" className="text-sm text-zinc-600 dark:text-zinc-400">
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
