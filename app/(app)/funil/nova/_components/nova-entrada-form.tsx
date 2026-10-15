'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { criarNegociacaoAction, type EstadoNovaNegociacao } from '@/lib/actions/funis'
import { ROTULO_TEMPERATURA, TEMPERATURAS } from '@/lib/validations/negociacao'

import { SeletorClienteBusca } from './seletor-cliente-busca'

/**
 * Sempre para um cliente já existente — nunca cria cliente aqui. O
 * responsável segue o dono do cliente; não há seletor de responsável.
 * Cliente é escolhido por busca (`SeletorClienteBusca`), nunca por uma
 * lista estática — evita carregar a base inteira de clientes no formulário.
 */
export function NovaEntradaForm({
  funilId,
  cancelarHref,
}: {
  funilId: string
  cancelarHref: string
}) {
  const [estado, formAction, pendente] = useActionState<EstadoNovaNegociacao | undefined, FormData>(
    criarNegociacaoAction,
    undefined,
  )
  const valores = estado?.valores
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

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

      <input type="hidden" name="funil_id" value={funilId} />

      <SeletorClienteBusca erro={erro('cliente_id')} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="valor_estimado" className="mb-1.5 block text-sm font-medium">
            Valor estimado (R$) <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input
            id="valor_estimado"
            name="valor_estimado"
            inputMode="decimal"
            placeholder="15.000,00"
            defaultValue={valores?.valor_estimado}
            aria-invalid={erro('valor_estimado') ? true : undefined}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('valor_estimado')} />
        </div>

        <div>
          <label htmlFor="temperatura" className="mb-1.5 block text-sm font-medium">
            Temperatura <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <select
            id="temperatura"
            name="temperatura"
            defaultValue={valores?.temperatura ?? ''}
            aria-invalid={erro('temperatura') ? true : undefined}
            className={inputClass}
          >
            <option value="">Não avaliada</option>
            {TEMPERATURAS.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TEMPERATURA[t]}
              </option>
            ))}
          </select>
          <ErroCampo mensagem={erro('temperatura')} />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Criando…' : 'Criar negociação'}
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
