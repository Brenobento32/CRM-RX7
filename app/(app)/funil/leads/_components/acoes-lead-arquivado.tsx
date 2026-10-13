'use client'

import { useState } from 'react'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { reativarNegociacaoAction } from '@/lib/actions/funil'

import { ModalExcluirLead } from './modal-excluir-lead'

/**
 * Ações da aba Arquivados: Reativar (confirmação nativa — reversível, baixo
 * risco) e Excluir permanentemente (modal visual próprio — ver item 13;
 * lógico, nunca `DELETE` físico).
 */
export function AcoesLeadArquivado({ id, clienteNome }: { id: string; clienteNome: string }) {
  const [excluindo, setExcluindo] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={reativarNegociacaoAction.bind(null, id)}>
        <BotaoConfirmar
          pergunta={`Reativar o lead de ${clienteNome}? Ele volta para a etapa inicial do funil.`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reativar
        </BotaoConfirmar>
      </form>

      <button
        type="button"
        onClick={() => setExcluindo(true)}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950"
      >
        Excluir permanentemente
      </button>

      {excluindo && (
        <ModalExcluirLead
          negociacaoId={id}
          clienteNome={clienteNome}
          onCancelar={() => setExcluindo(false)}
          onConcluido={() => setExcluindo(false)}
        />
      )}
    </div>
  )
}
