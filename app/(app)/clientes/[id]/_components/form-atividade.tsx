'use client'

import { startTransition, useActionState, useRef } from 'react'

import { ErroCampo as Erro } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormAtividade } from '@/lib/actions/atividades'
import { ROTULO_TIPO_ATIVIDADE, TIPOS_ATIVIDADE } from '@/lib/validations/atividade'

import { CampoNegociacao, type OpcaoNegociacao } from './campo-negociacao'

type Props = {
  action: (
    estado: EstadoFormAtividade | undefined,
    formData: FormData,
  ) => Promise<EstadoFormAtividade>
  negociacoes: OpcaoNegociacao[]
  /** "Agora" em São Paulo, calculado no servidor para não divergir na hidratação. */
  agora: string
}

export function FormAtividade({ action, negociacoes, agora }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const [estado, formAction, pendente] = useActionState(
    async (anterior: EstadoFormAtividade | undefined, formData: FormData) => {
      const resultado = await action(anterior, formData)
      if (resultado.ok) formRef.current?.reset()
      return resultado
    },
    undefined,
  )

  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      // Envio manual para um erro de validação não limpar o que foi digitado.
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(() => formAction(formData))
      }}
    >
      {estado?.erro && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {estado.erro}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="atividade-tipo" className="mb-1.5 block text-sm font-medium">
            Tipo
          </label>
          <select id="atividade-tipo" name="tipo" defaultValue="ligacao" className={inputClass}>
            {TIPOS_ATIVIDADE.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_ATIVIDADE[t]}
              </option>
            ))}
          </select>
          <Erro mensagem={erro('tipo')} />
        </div>

        <div>
          <label htmlFor="atividade-data" className="mb-1.5 block text-sm font-medium">
            Data
          </label>
          <input
            id="atividade-data"
            name="data"
            type="datetime-local"
            defaultValue={agora}
            max={agora}
            aria-invalid={erro('data') ? true : undefined}
            className={inputClass}
          />
          <Erro mensagem={erro('data')} />
        </div>

        <CampoNegociacao
          id="atividade-negociacao"
          negociacoes={negociacoes}
          erro={erro('negociacao_id')}
        />
      </div>

      <div>
        <label htmlFor="atividade-descricao" className="mb-1.5 block text-sm font-medium">
          Descrição
        </label>
        <textarea
          id="atividade-descricao"
          name="descricao"
          rows={3}
          placeholder="O que foi conversado, próximos passos combinados…"
          aria-invalid={erro('descricao') ? true : undefined}
          className={inputClass}
        />
        <Erro mensagem={erro('descricao')} />
      </div>

      <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
        {pendente ? 'Registrando…' : 'Registrar atividade'}
      </button>
    </form>
  )
}
