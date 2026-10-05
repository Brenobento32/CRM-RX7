'use client'

import { startTransition, useActionState, useEffect, useRef, useState } from 'react'

import { enviarMensagemAction, obterConversaAction, type EstadoEnvioMensagem } from '@/lib/actions/conversas'
import type { MensagemConversa } from '@/lib/dal/conversas'
import { createClient } from '@/lib/supabase/client'
import { formatarHora } from '@/lib/utils/formatacao'

type Props = {
  card: { clienteId: string; clienteNome: string; clienteEmpresa: string | null }
  onFechar: () => void
}

type Estado =
  | { status: 'carregando' }
  | { status: 'sem-conversa' }
  | { status: 'pronto'; conversaId: string; mensagens: MensagemConversa[] }

/** Linha crua do Realtime (`postgres_changes`) — mesmas colunas de `mensagens`. */
type LinhaMensagem = {
  id: string
  conversa_id: string
  direcao: MensagemConversa['direcao']
  tipo: MensagemConversa['tipo']
  conteudo: string | null
  created_at: string
}

function paraMensagem(linha: LinhaMensagem): MensagemConversa {
  return {
    id: linha.id,
    direcao: linha.direcao,
    tipo: linha.tipo,
    conteudo: linha.conteudo,
    createdAt: linha.created_at,
  }
}

/**
 * Leitura das mensagens de WhatsApp da conversa do cliente — carga inicial
 * via server action (`obterConversaAction`, respeita a RLS de
 * `conversas`/`mensagens`) e novas mensagens em tempo real via Supabase
 * Realtime (`postgres_changes` em `mensagens`, filtrado pela conversa).
 * Fase de leitura: sem envio, emoji, anexo, áudio ou vídeo ainda.
 */
export function PainelConversa({ card, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' })

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  // O painel desmonta e remonta a cada card (troca via `{conversa && <PainelConversa .../>}`
  // no Kanban), então `estado` já nasce 'carregando' — sem precisar resetar aqui.
  useEffect(() => {
    let ativo = true
    void obterConversaAction(card.clienteId).then((conversa) => {
      if (!ativo) return
      setEstado(
        conversa
          ? { status: 'pronto', conversaId: conversa.id, mensagens: conversa.mensagens }
          : { status: 'sem-conversa' },
      )
    })
    return () => {
      ativo = false
    }
  }, [card.clienteId])

  const conversaId = estado.status === 'pronto' ? estado.conversaId : null

  const [texto, setTexto] = useState('')
  const [estadoEnvio, formAction, enviando] = useActionState(
    async (_anterior: EstadoEnvioMensagem | undefined, formData: FormData) => {
      if (!conversaId) return { erro: 'Conversa não encontrada.' }
      const resultado = await enviarMensagemAction(conversaId, _anterior, formData)
      if (resultado.ok) setTexto('')
      return resultado
    },
    undefined,
  )

  useEffect(() => {
    if (!conversaId) return

    const supabase = createClient()
    const canal = supabase
      .channel(`mensagens-conversa-${conversaId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversaId}` },
        (payload) => {
          const nova = paraMensagem(payload.new as LinhaMensagem)
          setEstado((atual) => {
            if (atual.status !== 'pronto') return atual
            if (atual.mensagens.some((m) => m.id === nova.id)) return atual
            return { ...atual, mensagens: [...atual.mensagens, nova] }
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(canal)
    }
  }, [conversaId])

  const mensagens = estado.status === 'pronto' ? estado.mensagens : []

  useEffect(() => {
    const lista = listaRef.current
    if (lista) lista.scrollTop = lista.scrollHeight
  }, [mensagens.length])

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

        <div ref={listaRef} className="flex-1 overflow-y-auto p-4">
          {estado.status === 'carregando' && (
            <p className="text-center text-sm text-zinc-500">Carregando…</p>
          )}

          {estado.status !== 'carregando' && mensagens.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-sm text-zinc-500">Nenhuma mensagem ainda.</p>
            </div>
          )}

          {mensagens.length > 0 && (
            <ul className="space-y-2">
              {mensagens.map((m) => (
                <li key={m.id} className={m.direcao === 'saida' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.direcao === 'saida'
                        ? 'bg-green-600 text-white'
                        : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.conteudo ?? ''}</p>
                    <p
                      className={`mt-1 text-right text-[11px] ${
                        m.direcao === 'saida' ? 'text-green-100' : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {formatarHora(m.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="flex flex-col gap-1.5 border-t border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault()
            if (!texto.trim()) return
            const formData = new FormData(e.currentTarget)
            startTransition(() => formAction(formData))
          }}
        >
          {estadoEnvio?.erro && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {estadoEnvio.erro}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              name="texto"
              rows={2}
              placeholder="Escreva uma mensagem…"
              aria-label="Mensagem"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              disabled={!conversaId}
              className="flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              disabled={!conversaId || !texto.trim() || enviando}
              className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
