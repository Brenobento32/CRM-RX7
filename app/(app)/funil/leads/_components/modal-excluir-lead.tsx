'use client'

import { startTransition, useActionState, useState } from 'react'

import { excluirLeadAction, type EstadoModalFunil } from '@/lib/actions/funil'
import { ErroCampo, ErroGeral, inputClass, Modal } from '@/app/(app)/funil/_components/modal'

type Props = {
  negociacaoId: string
  clienteNome: string
  onCancelar: () => void
  onConcluido: () => void
}

/**
 * "Excluir lead" — modal visual próprio (nunca `confirm()` nativo). O texto
 * deixa claro que é remoção lógica: histórico do cliente, conversa e
 * mensagens são preservados — mesmo o botão da tela chamando isso de
 * "Excluir permanentemente" (nome já em uso), nunca prometemos destruição
 * física que não acontece (ver excluirNegociacaoPermanente em lib/dal/negociacoes.ts).
 */
export function ModalExcluirLead({ negociacaoId, clienteNome, onCancelar, onConcluido }: Props) {
  const [motivo, setMotivo] = useState('')
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoModalFunil | undefined, formData: FormData) => {
      const resultado = await excluirLeadAction(anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const erro = estado?.campos?.motivo?.[0]

  return (
    <Modal
      titulo="Excluir lead"
      descricao={
        <>
          Essa ação remove o lead de {clienteNome} da operação (sai de Ativos e Arquivados). O
          histórico do cliente, a conversa e as mensagens são preservados.
        </>
      }
      onCancelar={onCancelar}
    >
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          const formData = new FormData(e.currentTarget)
          startTransition(() => action(formData))
        }}
      >
        <ErroGeral mensagem={estado?.erro} />

        <input type="hidden" name="negociacao_id" value={negociacaoId} />

        <div>
          <label htmlFor="motivo-excluir-lead" className="mb-1.5 block text-sm font-medium">
            Motivo da exclusão
          </label>
          <textarea
            id="motivo-excluir-lead"
            name="motivo"
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: lead duplicado, cadastro de teste, erro de importação…"
            aria-invalid={erro ? true : undefined}
            aria-describedby="motivo-excluir-lead-erro"
            className={inputClass}
            autoFocus
          />
          <ErroCampo id="motivo-excluir-lead-erro" mensagem={erro} />
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <button
            type="button"
            onClick={onCancelar}
            disabled={pendente}
            className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pendente || motivo.trim() === ''}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
          >
            {pendente ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
