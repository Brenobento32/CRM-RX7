'use client'

import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { salvarConfiguracaoWhatsappAction } from '@/lib/actions/whatsapp'
import type { OpcaoResponsavel } from '@/lib/dal/clientes'
import type { Funil } from '@/lib/dal/funis'

export function WhatsappForm({
  funis,
  responsaveis,
  valoresIniciais,
  desabilitado,
}: {
  funis: Funil[]
  responsaveis: OpcaoResponsavel[]
  valoresIniciais: { funilId: string; responsavelPadraoId: string }
  /** `true` quando a conexão (linha única) ainda não existe — não há o que salvar. */
  desabilitado: boolean
}) {
  const [estado, formAction, pendente] = useActionState(salvarConfiguracaoWhatsappAction, undefined)
  const valores = {
    funilId: valoresIniciais.funilId,
    responsavelPadraoId: valoresIniciais.responsavelPadraoId,
    ...estado?.valores,
  }
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

  return (
    <form action={formAction} noValidate className="space-y-4">
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      <div className="max-w-sm">
        <label htmlFor="funil_id" className="mb-1.5 block text-sm font-medium">
          Funil
        </label>
        <select
          id="funil_id"
          name="funil_id"
          defaultValue={String(valores.funilId ?? '')}
          disabled={desabilitado}
          aria-invalid={erro('funilId') ? true : undefined}
          className={inputClass}
        >
          <option value="" disabled>
            Selecione…
          </option>
          {funis.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
        <ErroCampo mensagem={erro('funilId')} />
      </div>

      <div className="max-w-sm">
        <label htmlFor="responsavel_padrao_id" className="mb-1.5 block text-sm font-medium">
          Responsável padrão
        </label>
        <select
          id="responsavel_padrao_id"
          name="responsavel_padrao_id"
          defaultValue={String(valores.responsavelPadraoId ?? '')}
          disabled={desabilitado}
          aria-invalid={erro('responsavelPadraoId') ? true : undefined}
          className={inputClass}
        >
          <option value="" disabled>
            Selecione…
          </option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome} {r.role === 'gerente' ? '(gerente)' : ''}
            </option>
          ))}
        </select>
        <ErroCampo mensagem={erro('responsavelPadraoId')} />
      </div>

      <button type="submit" disabled={pendente || desabilitado} className={botaoPrimarioClass}>
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  )
}
