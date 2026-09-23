'use client'

import { startTransition, useActionState } from 'react'

import { fecharNegociacaoAction, type EstadoModalFunil } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import {
  ROTULO_STATUS_ONBOARDING,
  ROTULO_STATUS_PAGAMENTO,
  STATUS_ONBOARDING,
  STATUS_PAGAMENTO_FECHAMENTO,
} from '@/lib/validations/funil'

import { BotoesModal, ErroCampo, ErroGeral, inputClass, Modal } from './modal'

type Props = {
  card: CardFunil
  posicao: number
  onCancelar: () => void
  onConcluido: () => void
}

export function ModalFechamento({ card, posicao, onCancelar, onConcluido }: Props) {
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoModalFunil | undefined, formData: FormData) => {
      const resultado = await fecharNegociacaoAction(anterior, formData)
      if (resultado.ok) onConcluido()
      return resultado
    },
    undefined,
  )

  const erro = (campo: string) => estado?.campos?.[campo]?.[0]
  const hoje = hojeSaoPaulo()

  return (
    <Modal
      titulo="Fechar negociação"
      descricao={
        <>
          {card.clienteNome}
          {card.clienteEmpresa && ` · ${card.clienteEmpresa}`}. Todos os campos
          são obrigatórios, exceto o link do contrato.
        </>
      }
      onCancelar={onCancelar}
    >
      {/*
        Submissão manual: com `action={...}` o React limpa o formulário após
        cada envio, e um erro de validação apagaria tudo o que foi digitado.
      */}
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

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="valor_vendido" className="mb-1.5 block text-sm font-medium">
              Valor vendido (R$)
            </label>
            <input
              id="valor_vendido"
              name="valor_vendido"
              inputMode="decimal"
              placeholder="0,00"
              defaultValue={
                card.valorEstimado
                  ? card.valorEstimado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
                  : ''
              }
              aria-invalid={erro('valor_vendido') ? true : undefined}
              aria-describedby="valor_vendido-erro"
              className={inputClass}
              autoFocus
            />
            <ErroCampo id="valor_vendido-erro" mensagem={erro('valor_vendido')} />
          </div>

          <div>
            <label htmlFor="data_fechamento" className="mb-1.5 block text-sm font-medium">
              Data de fechamento
            </label>
            <input
              id="data_fechamento"
              name="data_fechamento"
              type="date"
              max={hoje}
              defaultValue={hoje}
              aria-invalid={erro('data_fechamento') ? true : undefined}
              aria-describedby="data_fechamento-erro"
              className={inputClass}
            />
            <ErroCampo id="data_fechamento-erro" mensagem={erro('data_fechamento')} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <SimNao nome="contrato_enviado" rotulo="Contrato enviado?" erro={erro('contrato_enviado')} />
          <SimNao nome="contrato_assinado" rotulo="Contrato assinado?" erro={erro('contrato_assinado')} />
        </div>

        <div>
          <label htmlFor="link_contrato" className="mb-1.5 block text-sm font-medium">
            Link do contrato <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input
            id="link_contrato"
            name="link_contrato"
            type="url"
            placeholder="https://"
            aria-invalid={erro('link_contrato') ? true : undefined}
            aria-describedby="link_contrato-erro"
            className={inputClass}
          />
          <ErroCampo id="link_contrato-erro" mensagem={erro('link_contrato')} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="status_pagamento" className="mb-1.5 block text-sm font-medium">
              Status do pagamento
            </label>
            <select
              id="status_pagamento"
              name="status_pagamento"
              defaultValue=""
              aria-invalid={erro('status_pagamento') ? true : undefined}
              aria-describedby="status_pagamento-erro"
              className={inputClass}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {STATUS_PAGAMENTO_FECHAMENTO.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS_PAGAMENTO[s]}
                </option>
              ))}
            </select>
            <ErroCampo id="status_pagamento-erro" mensagem={erro('status_pagamento')} />
          </div>

          <div>
            <label htmlFor="status_onboarding" className="mb-1.5 block text-sm font-medium">
              Status do onboarding
            </label>
            <select
              id="status_onboarding"
              name="status_onboarding"
              defaultValue=""
              aria-invalid={erro('status_onboarding') ? true : undefined}
              aria-describedby="status_onboarding-erro"
              className={inputClass}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {STATUS_ONBOARDING.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS_ONBOARDING[s]}
                </option>
              ))}
            </select>
            <ErroCampo id="status_onboarding-erro" mensagem={erro('status_onboarding')} />
          </div>
        </div>

        <BotoesModal pendente={pendente} rotulo="Fechar negociação" onCancelar={onCancelar} />
      </form>
    </Modal>
  )
}

/** Sim/Não sem opção pré-marcada: o closer precisa responder. */
function SimNao({ nome, rotulo, erro }: { nome: string; rotulo: string; erro?: string }) {
  return (
    <fieldset aria-describedby={`${nome}-erro`}>
      <legend className="mb-1.5 text-sm font-medium">{rotulo}</legend>
      <div className="flex gap-2">
        {(['sim', 'nao'] as const).map((v) => (
          <label
            key={v}
            className="flex flex-1 cursor-pointer items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-sm has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900"
          >
            <input type="radio" name={nome} value={v} className="sr-only" />
            {v === 'sim' ? 'Sim' : 'Não'}
          </label>
        ))}
      </div>
      <ErroCampo id={`${nome}-erro`} mensagem={erro} />
    </fieldset>
  )
}
