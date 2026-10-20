'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { Funil } from '@/lib/dal/funis'
import { COOKIE_FUNIL, COOKIE_FUNIL_MAX_AGE } from '@/lib/utils/preferencia-funil'

const CLASSE_PADRAO =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

/** Visual do dashboard premium (claro ou escuro, pelo `data-theme` da shell) — `BarraFunil` do Kanban e `/funil/metricas` passam `variant="premium"`. */
const CLASSE_PREMIUM =
  'rounded-lg border border-premium-borda bg-premium-card px-2.5 py-1.5 text-sm text-premium-texto outline-none transition focus:border-premium-acento focus:ring-2 focus:ring-premium-acento/20'

/**
 * Troca o funil selecionado: atualiza `?funil=` na URL atual e grava um
 * cookie, para a escolha sobreviver a navegações sem o parâmetro (ex.: link
 * na sidebar).
 */
export function SeletorFunil({
  funis,
  funilId,
  variant = 'padrao',
  comRotulo = true,
}: {
  funis: Pick<Funil, 'id' | 'nome' | 'ativo'>[]
  funilId: string
  variant?: 'padrao' | 'premium'
  /** `false`: omite o `<label>` "Funil" acima do select — pro cabeçalho do `FunilVisual`, que já diz "Funil de vendas" ao lado. `BarraFunil` (Kanban) não passa isso, continua com o rótulo de sempre. */
  comRotulo?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function trocar(id: string) {
    document.cookie = `${COOKIE_FUNIL}=${id}; path=/; max-age=${COOKIE_FUNIL_MAX_AGE}; samesite=lax`
    const params = new URLSearchParams(searchParams.toString())
    params.set('funil', id)
    router.push(`${pathname}?${params.toString()}`)
  }

  const premium = variant === 'premium'

  return (
    <div>
      {comRotulo && (
        <label className={`mb-1 block text-xs ${premium ? 'text-premium-mudo' : 'text-zinc-500'}`} htmlFor="seletor-funil">
          Funil
        </label>
      )}
      <select
        id="seletor-funil"
        value={funilId}
        onChange={(e) => trocar(e.target.value)}
        aria-label={comRotulo ? undefined : 'Funil'}
        className={premium ? CLASSE_PREMIUM : CLASSE_PADRAO}
      >
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
