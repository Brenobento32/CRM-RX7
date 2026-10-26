'use client'

import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass, caixaErroClass } from '@/components/ui/estilos'
import { editarFunilAction } from '@/lib/actions/funis'

export function EditarFunilForm({
  funilId,
  nome,
  descricao,
  whatsappHabilitado,
}: {
  funilId: string
  nome: string
  descricao: string | null
  whatsappHabilitado: boolean
}) {
  const [estado, formAction, pendente] = useActionState(editarFunilAction.bind(null, funilId), undefined)
  const valores = {
    nome,
    descricao: descricao ?? '',
    whatsappHabilitado: whatsappHabilitado ? 'on' : '',
    ...estado?.valores,
  }
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

  return (
    <form action={formAction} noValidate className="space-y-4">
      {estado?.erro && (
        <div
          role="alert"
          className={caixaErroClass}
        >
          {estado.erro}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
            Nome do funil
          </label>
          <input
            id="nome"
            name="nome"
            defaultValue={String(valores.nome ?? '')}
            maxLength={80}
            aria-invalid={erro('nome') ? true : undefined}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('nome')} />
        </div>
        <div>
          <label htmlFor="descricao" className="mb-1.5 block text-sm font-medium">
            Descrição <span className="font-normal text-premium-mudo">(opcional)</span>
          </label>
          <input
            id="descricao"
            name="descricao"
            defaultValue={String(valores.descricao ?? '')}
            maxLength={500}
            aria-invalid={erro('descricao') ? true : undefined}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('descricao')} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="whatsapp_habilitado"
          defaultChecked={valores.whatsappHabilitado === 'on'}
        />
        Permitir conversa WhatsApp neste funil
      </label>

      <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  )
}
