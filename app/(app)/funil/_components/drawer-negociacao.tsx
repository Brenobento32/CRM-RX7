'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'

import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { obterHistoricoNegociacaoAction } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'
import type { EtapaKanban } from '@/lib/utils/etapas'
import { formatarData, formatarMoeda } from '@/lib/utils/formatacao'
import { formatarDuracaoHistorico, montarHistorico, type LinhaHistoricoBruta } from '@/lib/utils/historico'
import { ROTULO_TIPO_ATIVIDADE } from '@/lib/validations/atividade'

type Props = {
  card: CardFunil
  etapas: EtapaKanban[]
  onFechar: () => void
  onEditar: (card: CardFunil) => void
  onMover: (id: string, etapaId: string) => void
  onAbrirConversa: (card: CardFunil) => void
}

/**
 * Painel lateral do card — abre sem sair de `/funil` (mesmo padrão de
 * `Modal`: `<dialog>` nativo, foco preso, Esc fecha). "Tempo parado na
 * etapa" vem de `historico_etapas` (via `montarHistorico`, a mesma lógica já
 * usada na tela de edição da negociação), buscado ao abrir — não existe
 * ainda no `CardFunil` que o Kanban já tem em mãos.
 */
export function DrawerNegociacao({ card, etapas, onFechar, onEditar, onMover, onAbrirConversa }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [historico, setHistorico] = useState<LinhaHistoricoBruta[] | null>(null)
  const [carregando, startTransition] = useTransition()

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    // O drawer desmonta e remonta a cada card (troca via `{drawer && <DrawerNegociacao .../>}`
    // no Kanban), então `historico` já nasce `null` — sem precisar resetar aqui.
    startTransition(async () => {
      setHistorico(await obterHistoricoNegociacaoAction(card.id))
    })
  }, [card.id])

  const etapa = etapas.find((e) => e.id === card.etapaId)
  // A etapa atual é sempre a última entrada (saida === null); tempo parado é a duração dela até agora.
  const etapaAtualHistorico = historico ? montarHistorico(historico).at(-1) : undefined

  return (
    <dialog
      ref={ref}
      aria-labelledby="drawer-titulo"
      onCancel={(e) => {
        e.preventDefault()
        onFechar()
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-sm border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0">
            {card.clienteEmpresa && (
              <p className="truncate text-base font-semibold" title={card.clienteEmpresa}>
                {card.clienteEmpresa}
              </p>
            )}
            <p
              id="drawer-titulo"
              className={`truncate ${card.clienteEmpresa ? 'text-sm text-zinc-500' : 'text-base font-semibold'}`}
              title={card.clienteNome}
            >
              {card.clienteNome}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar painel"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Etapa atual</dt>
              <dd className="mt-1 flex items-center gap-2 font-medium">
                {etapa && <PontoEtapa cor={etapa.cor} />}
                {etapa?.nome ?? '—'}
              </dd>
            </div>

            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Tempo parado na etapa</dt>
              <dd className="mt-1">
                {carregando
                  ? '…'
                  : etapaAtualHistorico
                    ? formatarDuracaoHistorico(etapaAtualHistorico.duracaoMs)
                    : '—'}
              </dd>
            </div>

            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Responsável</dt>
              <dd className="mt-1">{card.responsavel ?? '—'}</dd>
            </div>

            {card.valorEstimado !== null && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Valor estimado</dt>
                <dd className="mt-1">{formatarMoeda(card.valorEstimado)}</dd>
              </div>
            )}

            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Última atividade</dt>
              <dd className="mt-1">
                {card.ultimaAtividade ? (
                  <>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {ROTULO_TIPO_ATIVIDADE[card.ultimaAtividade.tipo]}
                      </span>
                      {formatarData(card.ultimaAtividade.data)}
                    </p>
                    <p className="mt-1 text-zinc-700 dark:text-zinc-300">{card.ultimaAtividade.descricao}</p>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          <section className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ações rápidas</h3>

            <button
              type="button"
              onClick={() => {
                onFechar()
                onEditar(card)
              }}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Editar negociação
            </button>

            <Link
              href={`/clientes/${card.clienteId}`}
              className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Ver ficha do cliente
            </Link>

            {etapas.length > 1 && (
              <div className="pt-1">
                <p className="mb-1.5 text-xs text-zinc-500">Mover para</p>
                <div className="flex flex-wrap gap-1.5">
                  {etapas
                    .filter((e) => e.id !== card.etapaId)
                    .map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          onMover(card.id, e.id)
                          onFechar()
                        }}
                        className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <PontoEtapa cor={e.cor} />
                        {e.nome}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">WhatsApp</h3>

            <button
              type="button"
              onClick={() => {
                onFechar()
                onAbrirConversa(card)
              }}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Abrir conversa
            </button>
          </section>
        </div>
      </div>
    </dialog>
  )
}
