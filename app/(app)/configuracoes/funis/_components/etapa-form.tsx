'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { SeletorCor } from '@/components/ui/seletor-cor'
import type { EstadoFormEtapa } from '@/lib/actions/etapas'

type Props = {
  action: (estado: EstadoFormEtapa | undefined, formData: FormData) => Promise<EstadoFormEtapa>
  valoresIniciais: { nome?: string; cor?: string; posFechamento?: string }
  /** Etapa de sistema: o nome aparece, mas não é editável. */
  nomeTravado?: boolean
  /** Só na criação: zona não pode ser trocada depois nesta fase. */
  mostrarZona?: boolean
  rotuloEnviar: string
  cancelarHref: string
}

export function EtapaForm({
  action,
  valoresIniciais,
  nomeTravado = false,
  mostrarZona = false,
  rotuloEnviar,
  cancelarHref,
}: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: 'nome' | 'cor' | 'posFechamento') => estado?.campos?.[campo]?.[0]

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

      <div className="max-w-sm">
        <label htmlFor="nome" className="mb-1.5 block text-sm font-medium">
          Nome
        </label>
        <input
          id="nome"
          // Campo desabilitado não é enviado: em etapa de sistema o nome não muda.
          name={nomeTravado ? undefined : 'nome'}
          defaultValue={valores.nome}
          disabled={nomeTravado}
          maxLength={60}
          aria-invalid={erro('nome') ? true : undefined}
          aria-describedby={nomeTravado ? 'nome-ajuda' : undefined}
          className={`${inputClass} disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-900`}
        />
        {nomeTravado && (
          <p id="nome-ajuda" className="mt-1 text-xs text-zinc-500">
            Etapas padrão do funil mantêm o nome e a posição; só a cor pode mudar.
          </p>
        )}
        <ErroCampo mensagem={erro('nome')} />
      </div>

      <SeletorCor name="cor" legenda="Cor" valorInicial={valores.cor} erro={erro('cor')} />

      {mostrarZona && (
        <fieldset className="max-w-sm">
          <legend className="mb-1.5 block text-sm font-medium">Zona</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="posFechamento"
                value="pipeline"
                defaultChecked={(valores.posFechamento ?? 'pipeline') === 'pipeline'}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Fluxo comercial</span>
                <span className="block text-xs text-zinc-500">Entra antes de Fechado/Perdido.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="posFechamento"
                value="recuperacao"
                defaultChecked={valores.posFechamento === 'recuperacao'}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Recuperação pós-perda</span>
                <span className="block text-xs text-zinc-500">
                  Entra depois de Fechado/Perdido, num fluxo à parte — não conta no funil comercial normal.
                </span>
              </span>
            </label>
          </div>
          <ErroCampo mensagem={erro('posFechamento')} />
        </fieldset>
      )}

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
