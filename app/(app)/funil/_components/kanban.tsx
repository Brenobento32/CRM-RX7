'use client'

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useId, useRef, useState, useTransition } from 'react'

import { moverNegociacaoAction } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'
import { COR_ETAPA, ROTULO_ETAPA, type EtapaFunil } from '@/lib/utils/etapas'
import { formatarMoedaCompacta } from '@/lib/utils/formatacao'
import { ETAPAS, exigeModal } from '@/lib/validations/funil'

import { CardArrastavel, CardConteudo } from './card-negociacao'
import { ModalFechamento } from './modal-fechamento'
import { ModalPerda } from './modal-perda'

type Colunas = Record<EtapaFunil, CardFunil[]>

type MovimentoPendente = {
  card: CardFunil
  etapa: 'fechado' | 'perdido'
  posicao: number
  /** Estado do quadro antes do arraste, para desfazer se o modal for cancelado. */
  antes: Colunas
}

function agrupar(cards: CardFunil[]): Colunas {
  const colunas = Object.fromEntries(ETAPAS.map((e) => [e, [] as CardFunil[]])) as Colunas
  for (const card of cards) colunas[card.etapa].push(card)
  for (const etapa of ETAPAS) colunas[etapa].sort((a, b) => a.posicao - b.posicao)
  return colunas
}

/** O `id` de um droppable é a etapa; o de um card, o id da negociação. */
function etapaDe(colunas: Colunas, id: string): EtapaFunil | undefined {
  if ((ETAPAS as readonly string[]).includes(id)) return id as EtapaFunil
  return ETAPAS.find((e) => colunas[e].some((c) => c.id === id))
}

const PASSO = 1000

/**
 * Posição nova = ponto médio entre os vizinhos. Assim mover um card grava
 * uma linha só, em vez de renumerar a coluna inteira.
 */
function posicaoEntre(anterior?: CardFunil, proximo?: CardFunil): number {
  if (anterior && proximo) return (anterior.posicao + proximo.posicao) / 2
  if (anterior) return anterior.posicao + PASSO
  if (proximo) return proximo.posicao - PASSO
  return PASSO
}

export function Kanban({ cards }: { cards: CardFunil[] }) {
  const dndId = useId()
  const [colunas, setColunas] = useState(() => agrupar(cards))

  // Quando o servidor manda dados novos (após uma action), o quadro é
  // reconstruído a partir deles — a fonte da verdade é o banco.
  const [cardsDoServidor, setCardsDoServidor] = useState(cards)
  if (cards !== cardsDoServidor) {
    setCardsDoServidor(cards)
    setColunas(agrupar(cards))
  }

  const [ativo, setAtivo] = useState<CardFunil | null>(null)
  const [pendente, setPendente] = useState<MovimentoPendente | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, startTransition] = useTransition()
  const inicioArraste = useRef<{ colunas: Colunas; etapa: EtapaFunil } | null>(null)

  const sensors = useSensors(
    // A distância mínima deixa o clique no nome do cliente funcionar como link.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function aoIniciar({ active }: DragStartEvent) {
    const etapa = etapaDe(colunas, String(active.id))
    if (!etapa) return
    inicioArraste.current = { colunas, etapa }
    setAtivo(colunas[etapa].find((c) => c.id === active.id) ?? null)
    setErro(null)
  }

  /** Troca de coluna durante o arraste, para o destino "abrir espaço". */
  function aoPassar({ active, over }: DragOverEvent) {
    if (!over) return

    setColunas((atual) => {
      const de = etapaDe(atual, String(active.id))
      const para = etapaDe(atual, String(over.id))
      if (!de || !para || de === para) return atual

      const card = atual[de].find((c) => c.id === active.id)
      if (!card) return atual

      const destino = atual[para]
      const indiceOver = destino.findIndex((c) => c.id === over.id)
      const indice = indiceOver >= 0 ? indiceOver : destino.length

      return {
        ...atual,
        [de]: atual[de].filter((c) => c.id !== active.id),
        [para]: [...destino.slice(0, indice), { ...card, etapa: para }, ...destino.slice(indice)],
      }
    })
  }

  function aoSoltar({ active, over }: DragEndEvent) {
    setAtivo(null)
    const inicio = inicioArraste.current
    inicioArraste.current = null
    if (!inicio) return

    if (!over) {
      setColunas(inicio.colunas)
      return
    }

    const id = String(active.id)
    const etapa = etapaDe(colunas, id)
    if (!etapa) return

    const lista = colunas[etapa]
    const de = lista.findIndex((c) => c.id === id)
    const indiceOver = lista.findIndex((c) => c.id === over.id)
    const ordenada = arrayMove(lista, de, indiceOver >= 0 ? indiceOver : de)
    const indice = ordenada.findIndex((c) => c.id === id)

    // Soltou no mesmo lugar de onde saiu: nada a gravar.
    const indiceOriginal = inicio.colunas[etapa].findIndex((c) => c.id === id)
    if (etapa === inicio.etapa && indice === indiceOriginal) {
      setColunas(inicio.colunas)
      return
    }

    const posicao = posicaoEntre(ordenada[indice - 1], ordenada[indice + 1])
    const card = { ...ordenada[indice], etapa, posicao }
    ordenada[indice] = card
    setColunas({ ...colunas, [etapa]: ordenada })

    // Entrar em fechado/perdido: o card fica na coluna, mas só é gravado
    // depois que o modal for preenchido.
    if (exigeModal(etapa) && etapa !== inicio.etapa) {
      setPendente({ card, etapa, posicao, antes: inicio.colunas })
      return
    }

    startTransition(async () => {
      const resultado = await moverNegociacaoAction({ id, etapa, posicao })
      if (!resultado.ok) {
        setColunas(inicio.colunas)
        setErro(resultado.mensagem)
      }
    })
  }

  function aoCancelarArraste() {
    setAtivo(null)
    if (inicioArraste.current) setColunas(inicioArraste.current.colunas)
    inicioArraste.current = null
  }

  function cancelarModal() {
    if (pendente) setColunas(pendente.antes)
    setPendente(null)
  }

  return (
    <>
      <div className="mb-3 flex min-h-6 items-center gap-3 text-sm" aria-live="polite">
        {salvando && <span className="text-zinc-500">Salvando…</span>}
        {erro && (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {erro}
          </span>
        )}
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={aoIniciar}
        onDragOver={aoPassar}
        onDragEnd={aoSoltar}
        onDragCancel={aoCancelarArraste}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {ETAPAS.map((etapa) => (
            <Coluna key={etapa} etapa={etapa} cards={colunas[etapa]} />
          ))}
        </div>

        <DragOverlay>{ativo && <CardConteudo card={ativo} flutuando />}</DragOverlay>
      </DndContext>

      {pendente?.etapa === 'fechado' && (
        <ModalFechamento
          card={pendente.card}
          posicao={pendente.posicao}
          onCancelar={cancelarModal}
          onConcluido={() => setPendente(null)}
        />
      )}
      {pendente?.etapa === 'perdido' && (
        <ModalPerda
          card={pendente.card}
          posicao={pendente.posicao}
          onCancelar={cancelarModal}
          onConcluido={() => setPendente(null)}
        />
      )}
    </>
  )
}

function Coluna({ etapa, cards }: { etapa: EtapaFunil; cards: CardFunil[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa })
  const total = cards.reduce((soma, c) => soma + (c.valorEstimado ?? 0), 0)

  return (
    <section
      aria-labelledby={`coluna-${etapa}`}
      className="flex w-72 shrink-0 flex-col rounded-xl bg-zinc-100 dark:bg-zinc-900"
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 id={`coluna-${etapa}`} className="flex items-center gap-2 text-sm font-semibold">
          <span className={`size-2.5 rounded-full ${COR_ETAPA[etapa]}`} aria-hidden />
          {ROTULO_ETAPA[etapa]}
          <span className="rounded-full bg-white px-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {cards.length}
          </span>
        </h2>
        {total > 0 && (
          <span className="text-xs text-zinc-500 tabular-nums">{formatarMoedaCompacta(total)}</span>
        )}
      </header>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex min-h-32 flex-1 flex-col gap-2 rounded-b-xl p-2 transition-colors ${
            isOver ? 'bg-zinc-200/70 dark:bg-zinc-800/70' : ''
          }`}
        >
          {cards.map((card) => (
            <CardArrastavel key={card.id} card={card} />
          ))}
        </ul>
      </SortableContext>
    </section>
  )
}
