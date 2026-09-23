'use client'

import { startTransition, useActionState } from 'react'

import { marcarPerdidaAction, type EstadoModalFunil } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'

import { BotoesModal, ErroCampo, ErroGeral, inputClass, Modal } from './modal'

type Props = {
  card: CardFunil
  posicao: number
  onCancelar: () => void
  onConcluido: () => void
}

export function ModalPerda({ card, posicao, onCancelar, onConcluido }: Props) {
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoModalFunil | undefined, formData: FormData) => {
      const resultado = await marcarPerdidaAction(anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const erro = estado?.campos?.motivo_perda?.[0]

  return (
    <Modal
      titulo="Marcar como perdida"
      descricao={
        <>
          {card.clienteNome}
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
        <input type="hidden" name="posicao" value={posicao} />

        <div>
          <label htmlFor="motivo_perda" className="mb-1.5 block text-sm font-medium">
            Motivo da perda
          </label>
          <textarea
            id="motivo_perda"
            name="motivo_perda"
            rows={4}
            placeholder="Ex.: escolheu concorrente, sem orçamento, parou de responder…"
            aria-invalid={erro ? true : undefined}
            aria-describedby="motivo_perda-erro"
            className={inputClass}
            autoFocus
          />
          <ErroCampo id="motivo_perda-erro" mensagem={erro} />
        </div>

        <BotoesModal pendente={pendente} rotulo="Marcar como perdida" onCancelar={onCancelar} />
      </form>
    </Modal>
  )
}
