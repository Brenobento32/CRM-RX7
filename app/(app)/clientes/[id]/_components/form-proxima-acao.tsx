'use client'

import { startTransition, useActionState, useRef } from 'react'

import { ErroCampo as Erro } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormAtividade } from '@/lib/actions/atividades'

import { CampoNegociacao, type OpcaoNegociacao } from './campo-negociacao'

type Props = {
  action: (
    estado: EstadoFormAtividade | undefined,
    formData: FormData,
  ) => Promise<EstadoFormAtividade>
  negociacoes: OpcaoNegociacao[]
  hoje: string
}

export function FormProximaAcao({ action, negociacoes, hoje }: Props) {
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
        <div className="sm:col-span-2">
          <label htmlFor="acao-titulo" className="mb-1.5 block text-sm font-medium">
            Próxima ação
          </label>
          <input
            id="acao-titulo"
            name="titulo"
            placeholder="Ex.: enviar proposta revisada"
            aria-invalid={erro('titulo') ? true : undefined}
            className={inputClass}
          />
          <Erro mensagem={erro('titulo')} />
        </div>

        <div>
          <label htmlFor="acao-data" className="mb-1.5 block text-sm font-medium">
            Data
          </label>
          <input
            id="acao-data"
            name="data"
            type="date"
            defaultValue={hoje}
            aria-invalid={erro('data') ? true : undefined}
            className={inputClass}
          />
          <Erro mensagem={erro('data')} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="acao-observacao" className="mb-1.5 block text-sm font-medium">
            Observação <span className="font-normal text-premium-mudo">(opcional)</span>
          </label>
          <input
            id="acao-observacao"
            name="observacao"
            aria-invalid={erro('observacao') ? true : undefined}
            className={inputClass}
          />
          <Erro mensagem={erro('observacao')} />
        </div>

        <CampoNegociacao id="acao-negociacao" negociacoes={negociacoes} erro={erro('negociacao_id')} />
      </div>

      <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
        {pendente ? 'Salvando…' : 'Agendar próxima ação'}
      </button>
    </form>
  )
}
