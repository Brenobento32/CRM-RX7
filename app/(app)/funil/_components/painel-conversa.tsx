'use client'

import { useEffect, useRef } from 'react'

type Props = {
  card: { clienteNome: string; clienteEmpresa: string | null }
  onFechar: () => void
}

/**
 * Placeholder visual da conversa por WhatsApp — sem integração ainda (ver
 * `DrawerNegociacao`, seção "WhatsApp"). Mesmo padrão de painel lateral
 * direito do drawer de negociação: `<dialog>` nativo, foco preso, Esc fecha.
 */
export function PainelConversa({ card, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="painel-conversa-titulo"
      onCancel={(e) => {
        e.preventDefault()
        onFechar()
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-sm border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
              <span aria-hidden>●</span> WhatsApp
            </p>
            {card.clienteEmpresa && (
              <p className="truncate text-base font-semibold" title={card.clienteEmpresa}>
                {card.clienteEmpresa}
              </p>
            )}
            <p
              id="painel-conversa-titulo"
              className={`truncate ${card.clienteEmpresa ? 'text-sm text-zinc-500' : 'text-base font-semibold'}`}
              title={card.clienteNome}
            >
              {card.clienteNome}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar conversa"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </header>

        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
          <p className="text-center text-sm text-zinc-500">
            Nenhuma mensagem ainda.
            <br />
            Conversa por WhatsApp — em breve.
          </p>
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
        >
          <textarea
            rows={2}
            placeholder="Escreva uma mensagem…"
            aria-label="Mensagem"
            className="flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Enviar
          </button>
        </form>
      </div>
    </dialog>
  )
}
