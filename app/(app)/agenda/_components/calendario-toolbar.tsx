import Link from 'next/link'

import { inputClass } from '@/components/ui/estilos'
import type { ResponsavelAgenda } from '@/lib/dal/eventos'
import { ROTULO_VISAO, VISOES, type LinkAgenda, type Visao } from '@/lib/utils/calendario'

const navClass =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'

/** Hoje / anterior / próximo, o seletor de visão e o título do período. */
export function CalendarioToolbar({
  visao,
  titulo,
  anteriorDia,
  proximoDia,
  hoje,
  link,
}: {
  visao: Visao
  titulo: string
  anteriorDia: string
  proximoDia: string
  hoje: string
  link: LinkAgenda
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Navegar no período" className="flex items-center gap-1">
          <Link href={link({ dia: anteriorDia })} className={navClass} aria-label="Período anterior">
            ←
          </Link>
          <Link href={link({ dia: hoje })} className={navClass}>
            Hoje
          </Link>
          <Link href={link({ dia: proximoDia })} className={navClass} aria-label="Próximo período">
            →
          </Link>
        </nav>
        <h2 className="text-lg font-semibold first-letter:uppercase">{titulo}</h2>
      </div>

      <nav
        aria-label="Visão da agenda"
        className="inline-flex flex-wrap rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        {VISOES.map((v) => (
          <Link
            key={v}
            href={link({ visao: v })}
            aria-current={v === visao ? 'page' : undefined}
            className={
              v === visao
                ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }
          >
            {ROTULO_VISAO[v]}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** Filtro de responsável (só o gerente vê a agenda de outras pessoas). */
export function FiltroResponsavel({
  visao,
  dia,
  usuarioId,
  responsaveis,
}: {
  visao: Visao
  dia: string
  usuarioId?: string
  responsaveis: ResponsavelAgenda[]
}) {
  return (
    <form action="/agenda" className="flex max-w-md items-end gap-2">
      <input type="hidden" name="visao" value={visao} />
      <input type="hidden" name="dia" value={dia} />
      <div className="flex-1">
        <label htmlFor="filtro-usuario" className="mb-1.5 block text-sm font-medium">
          Responsável
        </label>
        <select id="filtro-usuario" name="usuario" defaultValue={usuarioId ?? ''} className={inputClass}>
          <option value="">Toda a equipe</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={navClass}>
        Filtrar
      </button>
    </form>
  )
}
