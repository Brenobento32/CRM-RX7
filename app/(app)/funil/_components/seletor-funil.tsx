'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { Funil } from '@/lib/dal/funis'
import { COOKIE_FUNIL, COOKIE_FUNIL_MAX_AGE } from '@/lib/utils/preferencia-funil'

const selectClass =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

/**
 * Troca o funil selecionado: atualiza `?funil=` na URL atual e grava um
 * cookie, para a escolha sobreviver a navegações sem o parâmetro (ex.: link
 * na sidebar).
 */
export function SeletorFunil({ funis, funilId }: { funis: Pick<Funil, 'id' | 'nome' | 'ativo'>[]; funilId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function trocar(id: string) {
    document.cookie = `${COOKIE_FUNIL}=${id}; path=/; max-age=${COOKIE_FUNIL_MAX_AGE}; samesite=lax`
    const params = new URLSearchParams(searchParams.toString())
    params.set('funil', id)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500" htmlFor="seletor-funil">
        Funil
      </label>
      <select id="seletor-funil" value={funilId} onChange={(e) => trocar(e.target.value)} className={selectClass}>
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
