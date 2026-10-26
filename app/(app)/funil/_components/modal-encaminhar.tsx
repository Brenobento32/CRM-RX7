'use client'

import { useEffect, useRef, useState } from 'react'

import { encaminharMensagensAction, listarConversasParaEncaminharAction } from '@/lib/actions/conversas'
import type { ConversaParaEncaminhar, MensagemEncaminhada } from '@/lib/dal/conversas'
import { inputClass } from '@/components/ui/estilos'

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
      className={'m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-premium-borda bg-premium-card p-0 text-premium-texto shadow-premium-alta backdrop:bg-black/50 backdrop:backdrop-blur-[2px]'}
    >
      <div className="flex max-h-[80vh] flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-premium-borda p-4">
          <h2 id="modal-encaminhar-titulo" className="truncate text-base font-semibold">
            Encaminhar {mensagemIds.length > 1 ? `${mensagemIds.length} mensagens` : 'mensagem'}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-1.5 text-premium-mudo transition hover:bg-premium-bg disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </header>

        <div className="border-b border-premium-borda p-3">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente…"
            aria-label="Buscar cliente"
            className={inputClass}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversas === null && <p className="p-4 text-center text-sm text-premium-mudo">Carregando…</p>}
          {conversas !== null && filtradas.length === 0 && (
            <p className="p-4 text-center text-sm text-premium-mudo">Nenhuma conversa encontrada.</p>
          )}
          {filtradas.map((c) => (
            <button
              key={c.conversaId}
              type="button"
              disabled={enviando}
              onClick={() => void confirmar(c.conversaId)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-premium-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.clienteNome}</span>
                {c.clienteEmpresa && <span className="block truncate text-xs text-premium-mudo">{c.clienteEmpresa}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </dialog>
  )
}
