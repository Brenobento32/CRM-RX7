'use client'

import { startTransition, useActionState } from 'react'

import { CampoTipoVenda, CamposComplementaresFechamento, ROTULOS_CAMPOS_FECHAMENTO } from '@/components/funil/campos-fechamento'
import { ResumoErros } from '@/components/ui/resumo-erros'
import { fecharNegociacaoAction, type EstadoModalFunil } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'
import type { Servico } from '@/lib/dal/servicos'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import type { RegrasFechamento } from '@/lib/validations/funil'

import { BotoesModal, ErroCampo, ErroGeral, inputClass, Modal } from './modal'

type Props = {
  card: CardFunil
  posicao: number
  /** Catálogo ativo, pra marcar como "serviço contratado" ao fechar. */
  servicos: Servico[]
  /** Regras comerciais da empresa (Super Admin): tipos de venda e itens do fechamento. */
  regras: RegrasFechamento
  onCancelar: () => void
  onConcluido: () => void
}

export function ModalFechamento({ card, posicao, servicos, regras, onCancelar, onConcluido }: Props) {
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
  const obrigatorios = Object.entries(regras.campos).some(([, r]) => r === 'obrigatorio' || r === 'confirmar')

  return (
    <Modal
      titulo="Fechar negociação"
      descricao={
        <>
          {card.clienteNome}
          {card.clienteEmpresa && ` · ${card.clienteEmpresa}`}.{' '}
          {obrigatorios ? 'Campos marcados como opcionais podem ficar em branco.' : 'Informe o tipo, o valor e a data da venda.'}
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

        <CampoTipoVenda regras={regras} modo="novo" erro={erro('tipo_venda')} />

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

        <CamposComplementaresFechamento regras={regras} servicos={servicos} servicoIdsAtuais={card.servicoIds} erro={erro} />

        <BotoesModal
          pendente={pendente}
          rotulo="Fechar negociação"
          onCancelar={onCancelar}
          resumo={<ResumoErros campos={estado?.campos} rotulos={ROTULOS_CAMPOS_FECHAMENTO} erro={estado?.erro} />}
        />
      </form>
    </Modal>
  )
}
