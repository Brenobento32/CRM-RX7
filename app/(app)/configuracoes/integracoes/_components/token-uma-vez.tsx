'use client'

import { useActionState } from 'react'

import { botaoSecundarioClass, inputClass } from '@/components/ui/estilos'
import { girarTokenAction, type EstadoToken } from '@/lib/actions/fontes-leads'

/** Mostra o token uma única vez (ele não fica salvo em lugar nenhum além do hash). */
export function TokenUmaVez({ token }: { token: string }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <p className="font-medium">Copie agora: este token não será mostrado de novo.</p>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        Use só no servidor/automação que envia os leads (header <code>Authorization: Bearer …</code>). Nunca em página pública.
      </p>
      <input
        readOnly
        value={token}
        onFocus={(e) => e.currentTarget.select()}
        className={`${inputClass} mt-2 w-full font-mono text-xs`}
        aria-label="Token da fonte"
      />
    </div>
  )
}

/** Gera um token novo; o anterior deixa de valer na hora. */
export function GirarToken({ id }: { id: string }) {
  const [estado, acao, enviando] = useActionState<EstadoToken, FormData>(girarTokenAction, {})
  return (
    <div className="space-y-2">
      <form action={acao}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={enviando} className={botaoSecundarioClass}>
          {enviando ? 'Gerando…' : 'Gerar novo token (invalida o atual)'}
        </button>
      </form>
      {estado.erro && <p className="text-sm text-red-600">{estado.erro}</p>}
      {estado.token && <TokenUmaVez token={estado.token} />}
    </div>
  )
}
