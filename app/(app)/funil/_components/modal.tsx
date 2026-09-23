'use client'

import { useEffect, useRef } from 'react'

/**
 * Modal sobre `<dialog>` nativo: `showModal()` já entrega foco preso, Esc e
 * fundo inerte. Esc e "Cancelar" chamam `onCancelar` — no funil isso desfaz o
 * movimento do card.
 */
export function Modal({
  titulo,
  descricao,
  onCancelar,
  children,
}: {
  titulo: string
  descricao?: React.ReactNode
  onCancelar: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-titulo"
      onCancel={(e) => {
        e.preventDefault()
        onCancelar()
      }}
      className="m-auto w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <h2 id="modal-titulo" className="text-lg font-semibold">
          {titulo}
        </h2>
        {descricao && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{descricao}</p>
        )}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  )
}

export const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300'

export function ErroCampo({ id, mensagem }: { id: string; mensagem?: string }) {
  if (!mensagem) return null
  return (
    <p id={id} className="mt-1 text-sm text-red-600 dark:text-red-400">
      {mensagem}
    </p>
  )
}

export function ErroGeral({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {mensagem}
    </div>
  )
}

export function BotoesModal({
  pendente,
  rotulo,
  onCancelar,
}: {
  pendente: boolean
  rotulo: string
  onCancelar: () => void
}) {
  return (
    <div className="flex justify-end gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
      <button
        type="button"
        onClick={onCancelar}
        disabled={pendente}
        className="rounded-md px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={pendente}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pendente ? 'Salvando…' : rotulo}
      </button>
    </div>
  )
}
