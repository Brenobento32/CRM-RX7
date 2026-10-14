'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import type { EstadoFormMeta } from '@/lib/actions/metas'
import type { OpcaoAlvo } from '@/lib/dal/metas'
import { ROTULO_TIPO_META, TIPOS_META, type CampoMeta } from '@/lib/validations/meta'

type Props = {
  action: (estado: EstadoFormMeta | undefined, formData: FormData) => Promise<EstadoFormMeta>
  valoresIniciais: Partial<Record<CampoMeta, string>>
  /** Criar: escolhe alvo e mês. Editar: omitido — só o valor muda. */
  alvos?: OpcaoAlvo[]
  cancelarHref: string
  rotuloEnviar: string
}

export function MetaForm({ action, valoresIniciais, alvos, cancelarHref, rotuloEnviar }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: CampoMeta) => estado?.campos?.[campo]?.[0]

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

      {alvos && (
        <div className="grid max-w-lg gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="alvo" className="mb-1.5 block text-sm font-medium">
              Meta de
            </label>
            <select
              id="alvo"
              name="alvo"
              defaultValue={valores.alvo}
              aria-invalid={erro('alvo') ? true : undefined}
              className={inputClass}
            >
              {alvos.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={erro('alvo')} />
          </div>

          <div>
            <label htmlFor="tipo_meta" className="mb-1.5 block text-sm font-medium">
              Tipo
            </label>
            <select
              id="tipo_meta"
              name="tipo_meta"
              defaultValue={valores.tipo_meta}
              aria-invalid={erro('tipo_meta') ? true : undefined}
              className={inputClass}
            >
              {TIPOS_META.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_META[t]}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={erro('tipo_meta')} />
          </div>

          <div>
            <label htmlFor="mes" className="mb-1.5 block text-sm font-medium">
              Mês
            </label>
            <input
              id="mes"
              name="mes"
              type="month"
              defaultValue={valores.mes}
              aria-invalid={erro('mes') ? true : undefined}
              className={inputClass}
            />
            <ErroCampo mensagem={erro('mes')} />
          </div>
        </div>
      )}

      <div className="max-w-xs">
        <label htmlFor="valor_meta" className="mb-1.5 block text-sm font-medium">
          Valor da meta (R$)
        </label>
        <input
          id="valor_meta"
          name="valor_meta"
          inputMode="decimal"
          placeholder="50.000,00"
          defaultValue={valores.valor_meta}
          aria-invalid={erro('valor_meta') ? true : undefined}
          className={inputClass}
        />
        <ErroCampo mensagem={erro('valor_meta')} />
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : rotuloEnviar}
        </button>
        <Link
          href={cancelarHref}
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
