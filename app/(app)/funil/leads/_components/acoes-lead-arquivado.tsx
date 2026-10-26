'use client'

import { useState } from 'react'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoSecundarioClass, botaoPerigoClass } from '@/components/ui/estilos'
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
          className={botaoSecundarioClass}
        >
          Reativar
        </BotaoConfirmar>
      </form>

      <button
        type="button"
        onClick={() => setExcluindo(true)}
        className={botaoPerigoClass}
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
