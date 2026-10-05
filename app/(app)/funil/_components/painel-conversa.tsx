'use client'

import { startTransition, useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  enviarMensagemAction,
  obterConversaAction,
  obterStatusMensagemAction,
  type EstadoEnvioMensagem,
} from '@/lib/actions/conversas'
import type { MensagemConversa } from '@/lib/dal/conversas'
import { createClient } from '@/lib/supabase/client'
import { formatarHora } from '@/lib/utils/formatacao'

import { AnexoMenu } from './anexo-menu'
import { EmojiPopover } from './emoji-popover'

/** Textarea cresce com o texto até esse limite; depois disso, rola por dentro. */
const ALTURA_MAX_TEXTAREA = 160

/** Fallback do Realtime: confere no servidor o status da própria mensagem a cada 1s, por no máximo 10 tentativas. */
const INTERVALO_VERIFICACAO_MS = 1000
const TENTATIVAS_MAX_VERIFICACAO = 10

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
  status: MensagemConversa['status']
  created_at: string
}

function paraMensagem(linha: LinhaMensagem): MensagemConversa {
  return {
    id: linha.id,
    direcao: linha.direcao,
    tipo: linha.tipo,
    conteudo: linha.conteudo,
    status: linha.status,
    createdAt: linha.created_at,
  }
}

const ROTULO_STATUS_ENVIO: Record<NonNullable<MensagemConversa['status']>, string> = {
  pendente: 'Enviando…',
  enviando: 'Enviando…',
  enviado: '✓ Enviado',
  falhou: '⚠ Falhou',
}

/** Posição no ciclo de envio — nunca deixa um payload atrasado regredir pra uma posição anterior. */
const ORDEM_STATUS_ENVIO: Record<NonNullable<MensagemConversa['status']>, number> = {
  pendente: 0,
  enviando: 1,
  enviado: 2,
  falhou: 2,
}

/**
 * Insere mensagem nova (INSERT) ou atualiza uma já carregada (UPDATE de
 * status, eco tardio do próprio INSERT otimista, ou o fallback de
 * verificação pontual) pelo id.
 *
 * A inserção otimista local, o INSERT do Realtime da mesma linha, os
 * UPDATEs de status (pendente → enviando → enviado/falhou) e o fallback de
 * verificação podem chegar fora de ordem no cliente — ex.: o eco do INSERT,
 * que carrega o snapshot `status: 'pendente'` de quando a linha nasceu,
 * chegando *depois* de um UPDATE que já levou pra `enviando`. Pra mensagem
 * de saída, só aceita o status novo se ele não regredir no ciclo —
 * `enviado`/`falhou` são terminais (nunca mais aceitam nada; o retry cria
 * mensagem nova) e `enviando` nunca volta pra `pendente`. Mensagem de
 * entrada não tem ciclo (`status` é sempre `null`) e passa direto por essa
 * checagem.
 */
function mesclarMensagem(atual: MensagemConversa[], nova: MensagemConversa, inserirSeNaoExistir: boolean) {
  const indice = atual.findIndex((m) => m.id === nova.id)
  if (indice === -1) return inserirSeNaoExistir ? [...atual, nova] : atual

  const existente = atual[indice]
  if (existente.status && nova.status && ORDEM_STATUS_ENVIO[nova.status] < ORDEM_STATUS_ENVIO[existente.status]) {
    return atual
  }

  const copia = [...atual]
  copia[indice] = nova
  return copia
}

/**
 * Conversa de WhatsApp do cliente — carga inicial via server action
 * (`obterConversaAction`, respeita a RLS de `conversas`/`mensagens`) e
 * atualização em tempo real via Supabase Realtime (`postgres_changes` em
 * `mensagens`, filtrado pela conversa): INSERT pra mensagem nova, UPDATE pro
 * ciclo de status de saída (pendente → enviando → enviado/falhou) que o
 * whatsapp-service grava de forma assíncrona. Envia texto (com emoji) —
 * anexo, câmera e áudio são só o botão/menu preparados, sem upload ainda.
 */
export function PainelConversa({ card, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Posição de cursor a restaurar depois que `texto` comitar no DOM (ver `inserirEmoji`). */
  const posicaoPendenteRef = useRef<number | null>(null)
  /** Pra não aplicar o fallback de verificação (setTimeout) depois que o painel já fechou. */
  const montadoRef = useRef(true)
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' })

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => {
      montadoRef.current = false
      dialog?.close()
    }
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

  /**
   * Fallback pro caso do UPDATE do Realtime (pendente → enviando →
   * enviado/falhou) não chegar no próprio remetente: confere no servidor só
   * o status DESSA mensagem (uma linha, nunca a conversa inteira) a cada 1s,
   * por no máximo 10 tentativas (10s) — uma única checagem fixa não bastava
   * porque o envio pode demorar mais do que o intervalo escolhido. Para
   * assim que o status real vier `enviado`/`falhou` (aplicado via
   * `mesclarMensagem`, que já impede regressão) ou ao esgotar as tentativas;
   * nunca "assume" um status, só usa o que o banco devolve.
   */
  function agendarVerificacaoStatus(id: string) {
    let tentativas = 0

    const intervalo = setInterval(async () => {
      tentativas += 1

      if (!montadoRef.current) {
        clearInterval(intervalo)
        return
      }

      const status = await obterStatusMensagemAction(id)
      if (!montadoRef.current) {
        clearInterval(intervalo)
        return
      }

      if (status === 'enviado' || status === 'falhou') {
        clearInterval(intervalo)
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          const existente = atual.mensagens.find((m) => m.id === id)
          if (!existente) return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, { ...existente, status }, false) }
        })
        return
      }

      if (tentativas >= TENTATIVAS_MAX_VERIFICACAO) clearInterval(intervalo)
    }, INTERVALO_VERIFICACAO_MS)
  }

  const [texto, setTexto] = useState('')
  const [estadoEnvio, formAction, enviando] = useActionState(
    async (_anterior: EstadoEnvioMensagem | undefined, formData: FormData) => {
      if (!conversaId) return { erro: 'Conversa não encontrada.' }
      const resultado = await enviarMensagemAction(conversaId, _anterior, formData)
      if (resultado.ok && resultado.id && resultado.createdAt) {
        setTexto('')
        // Mostra a própria mensagem na hora — não espera o Realtime (que
        // só chega de volta depois). `mesclarMensagem` descarta por id se o
        // evento do Realtime também chegar depois, então não duplica.
        const nova: MensagemConversa = {
          id: resultado.id,
          direcao: 'saida',
          tipo: 'texto',
          conteudo: resultado.conteudo ?? '',
          status: 'pendente',
          createdAt: resultado.createdAt,
        }
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
        })
        agendarVerificacaoStatus(resultado.id)
      }
      return resultado
    },
    undefined,
  )

  /** "Tentar novamente" numa mensagem `falhou` — reaproveita o mesmo envio (nova mensagem pendente). */
  function reenviar(conteudo: string) {
    const formData = new FormData()
    formData.set('texto', conteudo)
    startTransition(() => formAction(formData))
  }

  /** Insere o emoji na posição do cursor (não no final) — o foco é devolvido no `useLayoutEffect` abaixo. */
  function inserirEmoji(emoji: string) {
    const campo = textareaRef.current
    const inicio = campo?.selectionStart ?? texto.length
    const fim = campo?.selectionEnd ?? texto.length

    posicaoPendenteRef.current = inicio + emoji.length
    setTexto(texto.slice(0, inicio) + emoji + texto.slice(fim))
  }

  // Roda assim que `texto` comita no DOM (antes da pintura) — não depende de
  // rAF nem de quando o popover de emoji devolve ou não o foco, só do React
  // ter aplicado o novo valor na textarea.
  useLayoutEffect(() => {
    const posicao = posicaoPendenteRef.current
    if (posicao === null) return
    posicaoPendenteRef.current = null
    const campo = textareaRef.current
    campo?.focus()
    campo?.setSelectionRange(posicao, posicao)
  }, [texto])

  // Cresce com o conteúdo (digitado, emoji inserido ou campo limpo depois do
  // envio) até ALTURA_MAX_TEXTAREA; depois disso, rola por dentro.
  useEffect(() => {
    const campo = textareaRef.current
    if (!campo) return
    campo.style.height = 'auto'
    campo.style.height = `${Math.min(campo.scrollHeight, ALTURA_MAX_TEXTAREA)}px`
  }, [texto])

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
            return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
          })
        },
      )
      .on(
        // O whatsapp-service faz pendente → enviando → enviado/falhou via UPDATE
        // nesta mesma linha; é só isso que chega aqui (conteúdo não muda depois do INSERT).
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversaId}` },
        (payload) => {
          const atualizada = paraMensagem(payload.new as LinhaMensagem)
          setEstado((atual) => {
            if (atual.status !== 'pronto') return atual
            return { ...atual, mensagens: mesclarMensagem(atual.mensagens, atualizada, false) }
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
      className="m-0 ml-auto h-dvh max-h-dvh w-full border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 sm:w-[48vw] sm:min-w-[420px] dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
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
                      className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] ${
                        m.direcao === 'saida' ? 'text-green-100' : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {formatarHora(m.createdAt)}
                      {m.direcao === 'saida' && m.status && <span>· {ROTULO_STATUS_ENVIO[m.status]}</span>}
                    </p>
                    {m.direcao === 'saida' && m.status === 'falhou' && (
                      <button
                        type="button"
                        onClick={() => reenviar(m.conteudo ?? '')}
                        disabled={enviando}
                        className="mt-1 text-[11px] font-medium text-green-100 underline decoration-dotted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Tentar novamente
                      </button>
                    )}
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
          <div className="flex items-end gap-1">
            <EmojiPopover onEscolher={inserirEmoji} disabled={!conversaId} />
            <AnexoMenu disabled={!conversaId} />
            <textarea
              ref={textareaRef}
              name="texto"
              rows={1}
              placeholder="Escreva uma mensagem…"
              aria-label="Mensagem"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter envia; Shift+Enter quebra linha (comportamento padrão do textarea).
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (texto.trim()) e.currentTarget.form?.requestSubmit()
                }
              }}
              disabled={!conversaId}
              className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
            {texto.trim() ? (
              <button
                type="submit"
                disabled={!conversaId || enviando}
                className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
            ) : (
              <button
                type="button"
                disabled
                aria-label="Gravar áudio (em breve)"
                title="Gravação de áudio — em breve"
                className="shrink-0 rounded-md p-2 text-lg leading-none text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-500"
              >
                🎤
              </button>
            )}
          </div>
        </form>
      </div>
    </dialog>
  )
}
