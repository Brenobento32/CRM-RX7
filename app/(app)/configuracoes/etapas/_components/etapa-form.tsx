'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormEtapa } from '@/lib/actions/etapas'
import { CORES_ETAPA, PALETA_ETAPAS } from '@/lib/utils/etapas'

type Props = {
  action: (estado: EstadoFormEtapa | undefined, formData: FormData) => Promise<EstadoFormEtapa>
  valoresIniciais: { nome?: string; cor?: string }
  /** Etapa de sistema: o nome aparece, mas não é editável. */
  nomeTravado?: boolean
  rotuloEnviar: string
}

export function EtapaForm({ action, valoresIniciais, nomeTravado = false, rotuloEnviar }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: 'nome' | 'cor') => estado?.campos?.[campo]?.[0]

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      <div className="max-w-sm">
        <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
          Nome
        </label>
        <input
          id="nome"
          // Campo desabilitado não é enviado: em etapa de sistema o nome não muda.
          name={nomeTravado ? undefined : 'nome'}
          defaultValue={valores.nome}
          disabled={nomeTravado}
          maxLength={60}
          aria-invalid={erro('nome') ? true : undefined}
          aria-describedby={nomeTravado ? 'nome-ajuda' : undefined}
          className={`${inputClass} disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-900`}
        />
        {nomeTravado && (
          <p id="nome-ajuda" className="mt-1 text-xs text-zinc-500">
            Etapas padrão do funil mantêm o nome e a posição; só a cor pode mudar.
          </p>
        )}
        <ErroCampo mensagem={erro('nome')} />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Cor</legend>
        <div className="flex flex-wrap gap-2">
          {CORES_ETAPA.map((cor) => (
            <label
              key={cor}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:ring-zinc-100"
            >
              <input
                type="radio"
                name="cor"
                value={cor}
                defaultChecked={valores.cor === cor}
                className="sr-only"
              />
              <span
                aria-hidden
                className="size-4 rounded-full"
                style={{ backgroundColor: PALETA_ETAPAS[cor].hex }}
              />
              {PALETA_ETAPAS[cor].rotulo}
            </label>
          ))}
        </div>
        <ErroCampo mensagem={erro('cor')} />
      </fieldset>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        <Link
          href="/configuracoes/etapas"
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
