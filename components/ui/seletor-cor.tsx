'use client'

import { useState } from 'react'

import { CORES_ETAPA, PALETA_ETAPAS, type CorEtapa } from '@/lib/utils/etapas'

type Props = {
  name: string
  legenda: string
  valorInicial?: string
  /** Mostra a opção "Sem cor" (valor vazio). */
  permitirVazio?: boolean
  /** Quem já usa cada cor: vira um aviso, sem bloquear a escolha. */
  emUso?: Partial<Record<CorEtapa, string[]>>
  ajuda?: string
  erro?: string
}

const opcaoClass =
  'flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:ring-zinc-100'

/**
 * Paleta fixa (a mesma das etapas do funil) em radios. A cor nunca aparece
 * sozinha: cada opção tem o nome escrito.
 */
export function SeletorCor({ name, legenda, valorInicial = '', permitirVazio = false, emUso, ajuda, erro }: Props) {
  const [valor, setValor] = useState(valorInicial)
  const outros = valor ? (emUso?.[valor as CorEtapa] ?? []) : []

  return (
    <fieldset aria-describedby={ajuda ? `${name}-ajuda` : undefined}>
      <legend className="mb-2 text-sm font-medium">{legenda}</legend>
      <div className="flex flex-wrap gap-2">
        {permitirVazio && (
          <label className={opcaoClass}>
            <input
              type="radio"
              name={name}
              value=""
              checked={valor === ''}
              onChange={() => setValor('')}
              className="sr-only"
            />
            <span aria-hidden className="size-4 rounded-full border border-dashed border-zinc-400" />
            Sem cor
          </label>
        )}
        {CORES_ETAPA.map((cor) => (
          <label key={cor} className={opcaoClass}>
            <input
              type="radio"
              name={name}
              value={cor}
              checked={valor === cor}
              onChange={() => setValor(cor)}
              className="sr-only"
            />
            <span aria-hidden className="size-4 rounded-full" style={{ backgroundColor: PALETA_ETAPAS[cor].hex }} />
            {PALETA_ETAPAS[cor].rotulo}
          </label>
        ))}
      </div>
      {ajuda && (
        <p id={`${name}-ajuda`} className="mt-1.5 text-xs text-zinc-500">
          {ajuda}
        </p>
      )}
      {outros.length > 0 && (
        <p role="status" className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
          {PALETA_ETAPAS[valor as CorEtapa].rotulo} já é usada por {outros.join(', ')}. Dá para repetir, mas fica
          difícil distinguir na agenda.
        </p>
      )}
      {erro && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{erro}</p>}
    </fieldset>
  )
}
