'use client'

import { useState } from 'react'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { definirAtivoNichoAction, moverNichoAction } from '@/lib/actions/nichos'
import type { NichoComUso } from '@/lib/dal/nichos'
import { PALETA_ETAPAS } from '@/lib/utils/etapas'

import { ModalNicho } from './modal-nicho'

const botaoIcone =
  'rounded-md border border-zinc-300 px-2 py-1 text-xs transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800'

/**
 * `nichos` vem direto da prop (nunca copiado para estado): depois de
 * qualquer ação (`revalidatePath` em lib/actions/nichos.ts), o Next busca a
 * lista de novo no servidor e esta prop chega atualizada — guardar uma
 * cópia em `useState` desincronizaria da primeira renderização em diante.
 * Só o modal aberto/fechado é estado local (sempre começa fechado).
 */
export function ListaNichosGerente({ nichos }: { nichos: NichoComUso[] }) {
  const [modal, setModal] = useState<'novo' | NichoComUso | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setModal('novo')} className={botaoPrimarioClass}>
          + Adicionar nicho
        </button>
      </div>

      {nichos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nenhum nicho cadastrado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-3 font-medium">Nicho</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Posição</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {nichos.map((n, i) => (
                <tr key={n.id} className={n.ativo ? undefined : 'text-zinc-400'}>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        aria-hidden
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: PALETA_ETAPAS[n.cor].hex }}
                      />
                      {n.nome}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        n.ativo
                          ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800'
                      }
                    >
                      {n.ativo ? 'Ativo' : 'Desativado'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1">
                      <form action={moverNichoAction.bind(null, n.id, 'cima')}>
                        <button type="submit" disabled={i === 0} aria-label={`Subir ${n.nome}`} className={botaoIcone}>
                          ↑
                        </button>
                      </form>
                      <form action={moverNichoAction.bind(null, n.id, 'baixo')}>
                        <button
                          type="submit"
                          disabled={i === nichos.length - 1}
                          aria-label={`Descer ${n.nome}`}
                          className={botaoIcone}
                        >
                          ↓
                        </button>
                      </form>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex justify-end gap-2">
                      <button type="button" onClick={() => setModal(n)} className={botaoSecundarioClass}>
                        Editar
                      </button>
                      <form action={definirAtivoNichoAction.bind(null, n.id, !n.ativo)}>
                        <button type="submit" className={botaoSecundarioClass}>
                          {n.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      </form>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ModalNicho nicho={modal === 'novo' ? null : modal} onFechar={() => setModal(null)} />}
    </div>
  )
}
