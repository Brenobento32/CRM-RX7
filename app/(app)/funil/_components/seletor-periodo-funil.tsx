'use client'

import Link from 'next/link'
import { useState } from 'react'

import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { PERIODOS_FUNIL, ROTULO_PERIODO_FUNIL, type PeriodoFunil } from '@/lib/utils/periodo'

/**
 * Atalhos de período da tela de métricas do funil (7/30/90 dias, este ano,
 * personalizado) — independentes do {@link import('@/app/(app)/_components/dashboard/seletor-periodo').SeletorPeriodo}
 * do dashboard (outros atalhos, outro propósito). Período fica na URL
 * (`?periodo=`, `?inicio=`, `?fim=`); o servidor recalcula tudo — o único
 * estado de cliente aqui é se o formulário de datas está visível.
 */
export function SeletorPeriodoFunil({
  caminho,
  funilId,
  atual,
  hoje,
}: {
  caminho: string
  funilId: string
  atual: PeriodoFunil
  hoje: string
}) {
  const [abrirPersonalizado, setAbrirPersonalizado] = useState(atual.chave === 'personalizado')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav
        aria-label="Período"
        className="inline-flex flex-wrap rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        {PERIODOS_FUNIL.filter((p) => p !== 'personalizado').map((p) => (
          <Link
            key={p}
            href={`${caminho}?funil=${funilId}&periodo=${p}`}
            aria-current={p === atual.chave ? 'page' : undefined}
            className={
              p === atual.chave
                ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }
          >
            {ROTULO_PERIODO_FUNIL[p]}
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={abrirPersonalizado}
          aria-current={atual.chave === 'personalizado' ? 'page' : undefined}
          onClick={() => setAbrirPersonalizado((v) => !v)}
          className={
            atual.chave === 'personalizado'
              ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'rounded-md px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }
        >
          {ROTULO_PERIODO_FUNIL.personalizado}
        </button>
      </nav>

      {abrirPersonalizado && (
        <form
          method="get"
          action={caminho}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <input type="hidden" name="funil" value={funilId} />
          <input type="hidden" name="periodo" value="personalizado" />
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Início
            <input
              type="date"
              name="inicio"
              defaultValue={atual.inicio}
              max={hoje}
              required
              className={`${inputClass} mt-0.5 py-1`}
            />
          </label>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Fim
            <input
              type="date"
              name="fim"
              defaultValue={atual.fim}
              max={hoje}
              required
              className={`${inputClass} mt-0.5 py-1`}
            />
          </label>
          <button type="submit" className={`${botaoPrimarioClass} py-1.5`}>
            Aplicar
          </button>
        </form>
      )}
    </div>
  )
}
