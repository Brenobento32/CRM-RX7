'use client'

import { useEffect, useRef, useState } from 'react'

import { encaminharMensagensAction, listarConversasParaEncaminharAction } from '@/lib/actions/conversas'
import type { ConversaParaEncaminhar, MensagemEncaminhada } from '@/lib/dal/conversas'

type Props = {
  mensagemIds: string[]
  conversaAtualId: string
  onFechar: () => void
  onEncaminhado: (resultado: { enviadas: MensagemEncaminhada[]; falhas: number }) => void
}

/**
 * Seletor de conversa destino pro "Encaminhar" — `<dialog>` modal próprio,
 * empilha por cima do `PainelConversa` igual o `PainelConversa` empilha
 * sobre o `DrawerNegociacao` (mesma pilha nativa, sem nada especial aqui).
 * CRM-only: `encaminharMensagensAction` só cria mensagens `pendente` na
 * conversa destino, nunca chama o whatsapp-service diretamente.
 */
export function ModalEncaminhar({ mensagemIds, conversaAtualId, onFechar, onEncaminhado }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [conversas, setConversas] = useState<ConversaParaEncaminhar[] | null>(null)
  const [busca, setBusca] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
    void listarConversasParaEncaminharAction(conversaAtualId).then(setConversas)
  }, [conversaAtualId])

  async function confirmar(destinoId: string) {
    if (enviando) return
    setEnviando(true)
    const resultado = await encaminharMensagensAction(destinoId, mensagemIds)
    setEnviando(false)
    onEncaminhado(resultado)
    onFechar()
  }

  const filtradas = (conversas ?? []).filter((c) =>
    `${c.clienteNome} ${c.clienteEmpresa ?? ''}`.toLowerCase().includes(busca.trim().toLowerCase()),
  )

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-encaminhar-titulo"
      onCancel={(e) => {
        e.preventDefault()
        if (!enviando) onFechar()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="flex max-h-[80vh] flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h2 id="modal-encaminhar-titulo" className="truncate text-base font-semibold">
            Encaminhar {mensagemIds.length > 1 ? `${mensagemIds.length} mensagens` : 'mensagem'}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </header>

        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente…"
            aria-label="Buscar cliente"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversas === null && <p className="p-4 text-center text-sm text-zinc-500">Carregando…</p>}
          {conversas !== null && filtradas.length === 0 && (
            <p className="p-4 text-center text-sm text-zinc-500">Nenhuma conversa encontrada.</p>
          )}
          {filtradas.map((c) => (
            <button
              key={c.conversaId}
              type="button"
              disabled={enviando}
              onClick={() => void confirmar(c.conversaId)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-800"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.clienteNome}</span>
                {c.clienteEmpresa && <span className="block truncate text-xs text-zinc-500">{c.clienteEmpresa}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </dialog>
  )
}
