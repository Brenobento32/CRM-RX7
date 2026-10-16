'use client'

import { startTransition, useActionState, useRef } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormAtividade } from '@/lib/actions/atividades'

type Props = {
  action: (
    estado: EstadoFormAtividade | undefined,
    formData: FormData,
  ) => Promise<EstadoFormAtividade>
  /** Chamado depois de um registro bem-sucedido — recarrega a timeline da ficha. */
  onRegistrada?: () => void
}

/**
 * "Observação" do card: sempre vira uma `atividade` (tipo 'nota') ligada à
 * negociação do próprio card — nunca edita `clientes.observacoes` (esse é
 * cadastro, editado em "Dados do cliente", continua owner/gerente). Quem
 * só tem `pode_ver` (sem `pode_mover`) recebe o erro vindo da RLS; o campo
 * fica sempre visível (a trava real é no banco, não aqui).
 */
export function FormObservacaoRapida({ action, onRegistrada }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const [estado, formAction, pendente] = useActionState(
    async (anterior: EstadoFormAtividade | undefined, formData: FormData) => {
      const resultado = await action(anterior, formData)
      if (resultado.ok) {
        formRef.current?.reset()
        onRegistrada?.()
      }
      return resultado
    },
    undefined,
  )

  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-3"
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
      {estado?.ok && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Observação registrada.</p>
      )}

      <div>
        <label htmlFor="observacao-descricao" className="mb-1.5 block text-sm font-medium">
          Nova observação
        </label>
        <textarea
          id="observacao-descricao"
          name="descricao"
          rows={2}
          placeholder="O que foi conversado, próximos passos combinados…"
          aria-invalid={erro('descricao') ? true : undefined}
          className={inputClass}
        />
        <ErroCampo mensagem={erro('descricao')} />
      </div>

      <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
        {pendente ? 'Registrando…' : 'Registrar observação'}
      </button>
    </form>
  )
}
