'use client'

import { startTransition, useActionState } from 'react'

import { SeletorCor } from '@/components/ui/seletor-cor'
import { criarNichoAction, editarNichoAction, type EstadoFormNicho } from '@/lib/actions/nichos'
import type { NichoComUso } from '@/lib/dal/nichos'

import { BotoesModal, ErroCampo, ErroGeral, inputClass, Modal } from '@/app/(app)/funil/_components/modal'

/**
 * Modal de criar/editar nicho (item 8 do pedido) — nunca `prompt()`/
 * `confirm()` nativo, reaproveita o `<dialog>` já usado no funil. `slug`
 * nunca aparece aqui: é gerado uma vez na criação e nunca editado (ver
 * `lib/dal/nichos.ts`).
 */
export function ModalNicho({ nicho, onFechar }: { nicho: NichoComUso | null; onFechar: () => void }) {
  const [estado, action, pendente] = useActionState(
    async (anterior: EstadoFormNicho | undefined, formData: FormData) => {
      const resultado = nicho
        ? await editarNichoAction(nicho.id, anterior, formData)
        : await criarNichoAction(anterior, formData)
      if (resultado.ok) onFechar()
      return resultado
    },
    undefined,
  )

  const erro = (campo: 'nome' | 'cor') => estado?.campos?.[campo]?.[0]

  return (
    <Modal titulo={nicho ? 'Editar nicho' : 'Novo nicho'} onCancelar={onFechar}>
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

        <div>
          <label htmlFor="nicho-nome" className="mb-1.5 block text-sm font-medium">
            Nome
          </label>
          <input
            id="nicho-nome"
            name="nome"
            defaultValue={nicho?.nome}
            maxLength={80}
            aria-invalid={erro('nome') ? true : undefined}
            className={inputClass}
            autoFocus
          />
          <ErroCampo mensagem={erro('nome')} />
        </div>

        <SeletorCor name="cor" legenda="Cor" valorInicial={nicho?.cor} erro={erro('cor')} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="ativo"
            defaultChecked={nicho ? nicho.ativo : true}
            className="size-4 rounded border-premium-borda"
          />
          Ativo
        </label>

        <BotoesModal pendente={pendente} rotulo={nicho ? 'Salvar' : 'Criar nicho'} onCancelar={onFechar} />
      </form>
    </Modal>
  )
}
