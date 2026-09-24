'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormServico } from '@/lib/actions/servicos'
import type { CampoServico } from '@/lib/validations/servico'

type Props = {
  action: (estado: EstadoFormServico | undefined, formData: FormData) => Promise<EstadoFormServico>
  valoresIniciais: Partial<Record<CampoServico, string>>
  /** Categorias já usadas, sugeridas no campo (evita "Assessoria" e "assessoria "). */
  categorias: string[]
  rotuloEnviar: string
}

export function ServicoForm({ action, valoresIniciais, categorias, rotuloEnviar }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: CampoServico) => estado?.campos?.[campo]?.[0]

  return (
    <form action={formAction} noValidate className="space-y-6">
      {estado?.erro && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {estado.erro}
        </div>
      )}

      <div className="max-w-md">
        <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
          Nome
        </label>
        <input
          id="nome"
          name="nome"
          defaultValue={valores.nome}
          maxLength={80}
          aria-invalid={erro('nome') ? true : undefined}
          className={inputClass}
        />
        <ErroCampo mensagem={erro('nome')} />
      </div>

      <div className="max-w-sm">
        <label htmlFor="categoria" className="mb-1.5 block text-sm font-medium">
          Categoria <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <input
          id="categoria"
          name="categoria"
          list="categorias-servico"
          defaultValue={valores.categoria}
          maxLength={60}
          aria-invalid={erro('categoria') ? true : undefined}
          className={inputClass}
        />
        <datalist id="categorias-servico">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <ErroCampo mensagem={erro('categoria')} />
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        <Link
          href="/configuracoes/servicos"
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
