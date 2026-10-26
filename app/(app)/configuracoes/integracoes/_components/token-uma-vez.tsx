'use client'

import { useActionState } from 'react'

import { botaoSecundarioClass, inputClass, caixaAlertaClass, caixaErroClass } from '@/components/ui/estilos'
import { girarTokenAction, type EstadoToken } from '@/lib/actions/fontes-leads'

/** Mostra o token uma única vez (ele não fica salvo em lugar nenhum além do hash). */
export function TokenUmaVez({ token }: { token: string }) {
  return (
    <div className={`${caixaAlertaClass} text-premium-texto`}>
      <p className="font-medium">Copie agora: este token não será mostrado de novo.</p>
      <p className="mt-1 text-premium-secundario">
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
      {estado.erro && <p role="alert" className={caixaErroClass}>{estado.erro}</p>}
      {estado.token && <TokenUmaVez token={estado.token} />}
    </div>
  )
}
