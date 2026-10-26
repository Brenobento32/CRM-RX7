'use client'

import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoSecundarioClass, inputClass, caixaErroClass } from '@/components/ui/estilos'
import { duplicarFunilAction } from '@/lib/actions/funis'

export function DuplicarFunilForm({ funilId, nomeSugerido }: { funilId: string; nomeSugerido: string }) {
  const [estado, formAction, pendente] = useActionState(duplicarFunilAction.bind(null, funilId), undefined)
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

  return (
    <form action={formAction} noValidate className="flex flex-wrap items-end gap-3">
      {estado?.erro && (
        <div
          role="alert"
          className={`${caixaErroClass} w-full`}
        >
          {estado.erro}
        </div>
      )}
      <div className="max-w-xs flex-1">
        <label htmlFor="nome-duplicar" className="mb-1.5 block text-sm font-medium">
          Nome do novo funil
        </label>
        <input
          id="nome-duplicar"
          name="nome"
          defaultValue={String(estado?.valores?.nome ?? nomeSugerido)}
          maxLength={80}
          aria-invalid={erro('nome') ? true : undefined}
          className={inputClass}
        />
        <ErroCampo mensagem={erro('nome')} />
      </div>
      <button type="submit" disabled={pendente} className={botaoSecundarioClass}>
        {pendente ? 'Duplicando…' : 'Duplicar funil'}
      </button>
    </form>
  )
}
