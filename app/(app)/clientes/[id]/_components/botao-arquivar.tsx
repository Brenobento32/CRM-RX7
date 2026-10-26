'use client'

import { useActionState } from 'react'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoPerigoClass } from '@/components/ui/estilos'
import type { EstadoArquivarCliente } from '@/lib/actions/clientes'

type Props = {
  action: (
    estado: EstadoArquivarCliente | undefined,
    formData: FormData,
  ) => Promise<EstadoArquivarCliente>
}

/** Arquiva (soft delete): pede confirmação e mostra o erro quando há negociação em andamento. */
export function BotaoArquivarCliente({ action }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)

  return (
    <form action={formAction}>
      <BotaoConfirmar
        pergunta="Arquivar este cliente? Ele deixa de aparecer nas listagens."
        className={botaoPerigoClass}
      >
        {pendente ? 'Arquivando…' : 'Arquivar cliente'}
      </BotaoConfirmar>
      {estado?.erro && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {estado.erro}
        </p>
      )}
    </form>
  )
}
