'use client'

import { startTransition, useEffect, useState, useTransition } from 'react'

import { listarTimelineNegociacaoAction, registrarObservacaoAction } from '@/lib/actions/atividades'
import type { ItemTimeline } from '@/lib/dal/atividades'
import type { CardFunil } from '@/lib/dal/funil'
import { formatarDataHoraCompleta } from '@/lib/utils/formatacao'
import { ROTULO_TIPO_ATIVIDADE } from '@/lib/validations/atividade'

import { FormObservacaoRapida } from './form-observacao-rapida'
import { Modal } from './modal'

type Props = {
  card: CardFunil
  /**
   * GERENTE sempre `true`; SDR/CLOSER só quando `pode_mover` está
   * configurado na etapa atual do card — mesmo cálculo que `ModalFichaCliente`
   * já usa (`papel === 'gerente' || podeMoverEtapa(card.etapaId)`, em
   * `kanban.tsx`). Puramente UX — a trava real é `atividades_insert`
   * (pode_mover_etapa), nunca tocada aqui; `pode_ver` sozinho (que já é
   * suficiente pra abrir este modal, ver o card) nunca basta pra registrar.
   */
  podeTrabalharCard: boolean
  onFechar: () => void
}

/**
 * "Ver observações" do card — mesma fonte (`atividades`) e mesmas ações
 * (`listarTimelineNegociacaoAction`/`registrarObservacaoAction`) já usadas
 * antes dentro de `ModalFichaCliente`; esta é a ÚNICA leitura/escrita de
 * observação que resta no Kanban — a ficha não mostra mais essa seção, pra
 * não ter duas telas fazendo a mesma coisa.
 *
 * `Modal` (de `./modal`) já cobre X, Escape e clique fora — nenhum
 * mecanismo novo aqui. `FormObservacaoRapida` já não fecha nada sozinho e
 * já mostra "Observação registrada." inline — reaproveitado sem alteração.
 */
export function ModalObservacoes({ card, podeTrabalharCard, onFechar }: Props) {
  const [timeline, setTimeline] = useState<ItemTimeline[] | null>(null)
  const [carregando, iniciarCarregamento] = useTransition()

  useEffect(() => {
    iniciarCarregamento(async () => {
      setTimeline(await listarTimelineNegociacaoAction(card.id))
    })
  }, [card.id])

  function recarregarTimeline() {
    startTransition(async () => {
      setTimeline(await listarTimelineNegociacaoAction(card.id))
    })
  }

  const descricao = (
    <>
      {card.clienteNome}
      {card.clienteEmpresa && ` · ${card.clienteEmpresa}`}
    </>
  )

  return (
    <Modal titulo="Observações" descricao={descricao} onCancelar={onFechar}>
      <div className="space-y-5">
        {carregando && timeline === null ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : timeline === null || timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">Não há observações ainda.</p>
        ) : (
          <ol className="relative max-h-72 space-y-4 overflow-y-auto border-l border-zinc-200 pl-4 dark:border-zinc-800">
            {timeline.map((a) => (
              <li key={a.id} className="relative">
                <span
                  className="absolute top-1.5 -left-[21px] size-2 rounded-full border-2 border-white bg-zinc-400 dark:border-zinc-950"
                  aria-hidden
                />
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {ROTULO_TIPO_ATIVIDADE[a.tipo]}
                  </span>
                  <time dateTime={a.data}>{formatarDataHoraCompleta(a.data)}</time>
                  {a.usuario && <span>· {a.usuario}</span>}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{a.descricao}</p>
              </li>
            ))}
          </ol>
        )}

        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {podeTrabalharCard ? (
            <FormObservacaoRapida
              action={registrarObservacaoAction.bind(null, card.clienteId, card.id)}
              onRegistrada={recarregarTimeline}
            />
          ) : (
            <p className="text-sm text-zinc-500">
              Você só pode visualizar este card — sem permissão para registrar observações nele.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
