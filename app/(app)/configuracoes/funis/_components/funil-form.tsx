'use client'

import Link from 'next/link'
import { useActionState, useRef, useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, botaoSecundarioClass, inputClass } from '@/components/ui/estilos'
import { SeletorCor } from '@/components/ui/seletor-cor'
import { criarFunilAction } from '@/lib/actions/funis'
import { CORES_ETAPA, PALETA_ETAPAS } from '@/lib/utils/etapas'

/**
 * Criar funil: nome, etapas abertas opcionais (lista dinâmica) e as duas
 * etapas obrigatórias de fechamento. `criar_funil()` no banco garante que o
 * funil nunca existe sem ganha e perdida — se a criação falhar no meio,
 * nada fica gravado.
 */
export function FunilForm() {
  const [estado, formAction, pendente] = useActionState(criarFunilAction, undefined)
  const erro = (campo: string) => estado?.campos?.[campo]?.[0]

  const proximoId = useRef(0)
  const [linhas, setLinhas] = useState<number[]>([])

  function adicionarEtapa() {
    const id = proximoId.current++
    setLinhas((atual) => [...atual, id])
  }
  function removerEtapa(id: number) {
    setLinhas((atual) => atual.filter((x) => x !== id))
  }

  return (
    <form action={formAction} noValidate className="space-y-8">
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
          Nome do funil
        </label>
        <input
          id="nome"
          name="nome"
          defaultValue={String(estado?.valores?.nome ?? '')}
          maxLength={80}
          aria-invalid={erro('nome') ? true : undefined}
          className={inputClass}
        />
        <ErroCampo mensagem={erro('nome')} />
      </div>

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-semibold">
            Etapas abertas <span className="font-normal text-zinc-500">(opcional)</span>
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Na ordem em que aparecem aqui. Ficam sempre antes do fechamento — dá pra adicionar mais depois.
          </p>
        </div>

        <div className="space-y-2">
          {linhas.map((id) => (
            <div key={id} className="flex items-center gap-2">
              <input
                name="etapa_aberta_nome"
                placeholder="Nome da etapa"
                maxLength={60}
                className={`${inputClass} flex-1`}
              />
              <select name="etapa_aberta_cor" defaultValue="azul" className={`${inputClass} w-40 shrink-0`}>
                {CORES_ETAPA.map((cor) => (
                  <option key={cor} value={cor}>
                    {PALETA_ETAPAS[cor].rotulo}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removerEtapa(id)}
                aria-label="Remover etapa"
                className={botaoSecundarioClass}
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <button type="button" onClick={adicionarEtapa} className={botaoSecundarioClass}>
          + Etapa aberta
        </button>
      </section>

      <section className="grid gap-6 border-t border-zinc-200 pt-6 sm:grid-cols-2 dark:border-zinc-800">
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Etapa ganha</h2>
          <div>
            <label htmlFor="etapa_ganha_nome" className="mb-1.5 block text-sm font-medium">
              Nome
            </label>
            <input
              id="etapa_ganha_nome"
              name="etapa_ganha_nome"
              defaultValue={String(estado?.valores?.etapaGanhaNome ?? 'Fechado')}
              maxLength={60}
              aria-invalid={erro('etapaGanhaNome') ? true : undefined}
              className={inputClass}
            />
            <ErroCampo mensagem={erro('etapaGanhaNome')} />
          </div>
          <SeletorCor name="etapa_ganha_cor" legenda="Cor" valorInicial="verde" erro={erro('etapaGanhaCor')} />
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold">Etapa perdida</h2>
          <div>
            <label htmlFor="etapa_perdida_nome" className="mb-1.5 block text-sm font-medium">
              Nome
            </label>
            <input
              id="etapa_perdida_nome"
              name="etapa_perdida_nome"
              defaultValue={String(estado?.valores?.etapaPerdidaNome ?? 'Perdido')}
              maxLength={60}
              aria-invalid={erro('etapaPerdidaNome') ? true : undefined}
              className={inputClass}
            />
            <ErroCampo mensagem={erro('etapaPerdidaNome')} />
          </div>
          <SeletorCor
            name="etapa_perdida_cor"
            legenda="Cor"
            valorInicial="vermelho"
            erro={erro('etapaPerdidaCor')}
          />
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Criando…' : 'Criar funil'}
        </button>
        <Link
          href="/configuracoes/funis"
          className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
