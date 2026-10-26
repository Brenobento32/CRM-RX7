'use client'

import { startTransition, useActionState, useState } from 'react'

import { botaoFantasmaClass } from '@/components/ui/estilos'
import { arquivarNegociacaoAction, type EstadoModalFunil } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'

import { ErroCampo, ErroGeral, inputClass, Modal } from './modal'

type Props = {
  card: CardFunil
  onCancelar: () => void
  onConcluido: () => void
}

/**
 * "Desqualificar lead" — modal visual próprio (nunca `prompt()`/`confirm()`
 * nativo). O motivo é digitado e confirmado no mesmo passo: não há uma
 * segunda tela de "tem certeza?" — o botão "Desqualificar lead" já É a
 * confirmação, igual ao resto do CRM (ModalPerda, ModalFechamento).
 */
export function ModalDesqualificar({ card, onCancelar, onConcluido }: Props) {
  const [motivo, setMotivo] = useState('')
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoModalFunil | undefined, formData: FormData) => {
      const resultado = await arquivarNegociacaoAction(anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const erro = estado?.campos?.motivo?.[0]

  return (
    <Modal
      titulo="Desqualificar lead"
      descricao={
        <>
          Por que este lead foi desqualificado? {card.clienteNome}
          {card.clienteEmpresa && ` · ${card.clienteEmpresa}`}
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

        <input type="hidden" name="negociacao_id" value={card.id} />

        <div>
          <label htmlFor="motivo-desqualificar" className="mb-1.5 block text-sm font-medium">
            Motivo
          </label>
          <textarea
            id="motivo-desqualificar"
            name="motivo"
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: fora do perfil, sem orçamento, número errado…"
            aria-invalid={erro ? true : undefined}
            aria-describedby="motivo-desqualificar-erro"
            className={inputClass}
            autoFocus
          />
          <ErroCampo id="motivo-desqualificar-erro" mensagem={erro} />
        </div>

        <div className="flex justify-end gap-3 border-t border-premium-borda pt-5">
          <button
            type="button"
            onClick={onCancelar}
            disabled={pendente}
            className={botaoFantasmaClass}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pendente || motivo.trim() === ''}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
          >
            {pendente ? 'Desqualificando…' : 'Desqualificar lead'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
