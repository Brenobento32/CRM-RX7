'use client'

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
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

import { IconeSeta } from '@/components/layout/icones'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { moverNegociacaoAction } from '@/lib/actions/funil'
import type { CardFunil } from '@/lib/dal/funil'
import type { Servico } from '@/lib/dal/servicos'
import { tipoExigeModal, type EtapaKanban } from '@/lib/utils/etapas'
import { formatarMoedaCompacta } from '@/lib/utils/formatacao'

import { CardArrastavel, CardConteudo } from './card-negociacao'
import { ModalFechamento } from './modal-fechamento'
import { ModalPerda } from './modal-perda'
import { useRolagemHorizontal } from './rolagem-horizontal'

/** Cards por id de etapa. */
type Colunas = Record<string, CardFunil[]>

type MovimentoPendente = {
  card: CardFunil
  /** Qual modal abrir: fechamento (ganha) ou motivo (perdida). */
  tipo: 'ganha' | 'perdida'
  posicao: number
  /** Estado do quadro antes do arraste, para desfazer se o modal for cancelado. */
  antes: Colunas
}

/** Mesma ordem da consulta (`posicao`, depois `id`), para empates não trocarem de lugar. */
function compararCards(a: CardFunil, b: CardFunil): number {
  return a.posicao - b.posicao || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function agrupar(cards: CardFunil[], etapas: EtapaKanban[]): Colunas {
  const colunas: Colunas = Object.fromEntries(etapas.map((e) => [e.id, [] as CardFunil[]]))
  // Etapa desativada nunca tem cards (o banco impede); se aparecer um card
  // sem coluna, ele simplesmente não é exibido.
  for (const card of cards) colunas[card.etapaId]?.push(card)
  for (const lista of Object.values(colunas)) lista.sort(compararCards)
  return colunas
}

/**
 * Alvo do arraste: o que está sob o ponteiro, e só sem ponteiro (teclado) ou
 * fora de qualquer área a distância entre cantos.
 *
 * `closestCorners` sozinho falha em coluna vazia: ela estica até a altura da
 * coluna mais cheia, os cantos de baixo ficam longe, e um card da coluna
 * vizinha acaba "mais perto" — o card voltava para a coluna de origem.
 */
const deteccaoDeColisao: CollisionDetection = (args) => {
  const sobPonteiro = pointerWithin(args)
  return sobPonteiro.length > 0 ? sobPonteiro : closestCorners(args)
}

/** O `id` de um droppable é o da etapa; o de um card, o da negociação. */
function etapaDe(colunas: Colunas, id: string): string | undefined {
  if (Object.hasOwn(colunas, id)) return id
  return Object.keys(colunas).find((e) => colunas[e].some((c) => c.id === id))
}

const PASSO = 1000

/**
 * Posição nova = ponto médio entre os vizinhos. Assim mover um card grava
 * uma linha só, em vez de renumerar a coluna inteira.
 *
 * Devolve `null` quando não há espaço: vizinhos com a mesma posição (a
 * negociação nova nasce com o default 1000) ou tão próximos que o ponto
 * médio já não fica estritamente entre eles.
 */
function posicaoEntre(anterior?: CardFunil, proximo?: CardFunil): number | null {
  if (anterior && proximo) {
    const meio = (anterior.posicao + proximo.posicao) / 2
    return anterior.posicao < meio && meio < proximo.posicao ? meio : null
  }
  if (anterior) return anterior.posicao + PASSO
  if (proximo) return proximo.posicao - PASSO
  return PASSO
}

/** Coluna renumerada 1000, 2000, … na ordem atual. */
function renumerar(coluna: CardFunil[]): CardFunil[] {
  return coluna.map((c, i) => ({ ...c, posicao: (i + 1) * PASSO }))
}

export function Kanban({
  cards,
  etapas,
  servicos,
}: {
  cards: CardFunil[]
  etapas: EtapaKanban[]
  servicos: Servico[]
}) {
  const dndId = useId()
  const quadroId = useId()
  const quadroRef = useRef<HTMLDivElement>(null)
  const rolagem = useRolagemHorizontal(quadroRef)
  const [colunas, setColunas] = useState(() => agrupar(cards, etapas))

  // Quando o servidor manda dados novos (após uma action), o quadro é
  // reconstruído a partir deles — a fonte da verdade é o banco.
  const [doServidor, setDoServidor] = useState({ cards, etapas })
  if (cards !== doServidor.cards || etapas !== doServidor.etapas) {
    setDoServidor({ cards, etapas })
    setColunas(agrupar(cards, etapas))
  }

  const tipoDe = (etapaId: string) => etapas.find((e) => e.id === etapaId)?.tipo ?? 'aberta'

  const [ativo, setAtivo] = useState<CardFunil | null>(null)
  const [pendente, setPendente] = useState<MovimentoPendente | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, startTransition] = useTransition()
  const inicioArraste = useRef<{ colunas: Colunas; etapa: string } | null>(null)

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
        [para]: [...destino.slice(0, indice), { ...card, etapaId: para }, ...destino.slice(indice)],
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
    let ordenada = arrayMove(lista, de, indiceOver >= 0 ? indiceOver : de)
    const indice = ordenada.findIndex((c) => c.id === id)

    // Soltou no mesmo lugar de onde saiu: nada a gravar.
    const indiceOriginal = inicio.colunas[etapa].findIndex((c) => c.id === id)
    if (etapa === inicio.etapa && indice === indiceOriginal) {
      setColunas(inicio.colunas)
      return
    }

    let posicao = posicaoEntre(ordenada[indice - 1], ordenada[indice + 1])
    // Sem espaço entre os vizinhos: renumera a coluna e grava junto as
    // posições que mudaram, para não criar empate.
    let reposicionar: { id: string; posicao: number }[] = []
    if (posicao === null) {
      const renumerada = renumerar(ordenada)
      reposicionar = renumerada
        .filter((c, i) => i !== indice && c.posicao !== ordenada[i].posicao)
        .map((c) => ({ id: c.id, posicao: c.posicao }))
      ordenada = renumerada
      posicao = renumerada[indice].posicao
    }

    const card = { ...ordenada[indice], etapaId: etapa, posicao }
    ordenada[indice] = card
    setColunas({ ...colunas, [etapa]: ordenada })

    gravar({ card, origem: inicio.etapa, posicao, reposicionar, antes: inicio.colunas })
  }

  /**
   * Grava um movimento já aplicado no quadro. Entrar em etapa ganha/perdida
   * só abre o modal — o card fica na coluna, mas é gravado quando o modal for
   * preenchido. Qualquer falha devolve o quadro ao estado `antes`.
   */
  function gravar({
    card,
    origem,
    posicao,
    reposicionar = [],
    antes,
  }: {
    card: CardFunil
    origem: string
    posicao: number
    reposicionar?: { id: string; posicao: number }[]
    antes: Colunas
  }) {
    const etapaId = card.etapaId
    const tipo = tipoDe(etapaId)
    if (tipoExigeModal(tipo) && etapaId !== origem) {
      setPendente({ card, tipo, posicao, antes })
      return
    }

    startTransition(async () => {
      const resultado = await moverNegociacaoAction({ id: card.id, etapaId, posicao, reposicionar })
      if (!resultado.ok) {
        setColunas(antes)
        setErro(resultado.mensagem)
      }
    })
  }

  /** "Mover para" do card: vai para o fim da coluna de destino, sem arrastar. */
  function moverPara(id: string, destino: string) {
    const origem = etapaDe(colunas, id)
    const atual = origem && colunas[origem].find((c) => c.id === id)
    if (!origem || !atual || origem === destino || pendente) return

    const coluna = colunas[destino] ?? []
    const posicao = posicaoEntre(coluna.at(-1), undefined) ?? PASSO
    const card = { ...atual, etapaId: destino, posicao }

    setErro(null)
    setColunas({
      ...colunas,
      [origem]: colunas[origem].filter((c) => c.id !== id),
      [destino]: [...coluna, card],
    })
    gravar({ card, origem, posicao, antes: colunas })
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
      <div className="mb-3 flex min-h-8 items-center gap-3 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-3" aria-live="polite">
          {salvando && <span className="text-zinc-500">Salvando…</span>}
          {erro && (
            <span role="alert" className="text-red-600 dark:text-red-400">
              {erro}
            </span>
          )}
        </div>
        {rolagem.temRolagem && (
          <div className="flex shrink-0 gap-1">
            <BotaoRolagem
              rotulo="Colunas anteriores"
              controla={quadroId}
              desabilitado={!rolagem.podeVoltar}
              onClick={() => rolagem.rolar(-1)}
              esquerda
            />
            <BotaoRolagem
              rotulo="Próximas colunas"
              controla={quadroId}
              desabilitado={!rolagem.podeAvancar}
              onClick={() => rolagem.rolar(1)}
            />
          </div>
        )}
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={deteccaoDeColisao}
        onDragStart={aoIniciar}
        onDragOver={aoPassar}
        onDragEnd={aoSoltar}
        onDragCancel={aoCancelarArraste}
      >
        <div ref={quadroRef} id={quadroId} className="flex gap-4 overflow-x-auto pb-4">
          {etapas.map((etapa) => (
            <Coluna
              key={etapa.id}
              etapa={etapa}
              etapas={etapas}
              cards={colunas[etapa.id] ?? []}
              onMover={moverPara}
            />
          ))}
        </div>

        <DragOverlay>{ativo && <CardConteudo card={ativo} flutuando />}</DragOverlay>
      </DndContext>

      {pendente?.tipo === 'ganha' && (
        <ModalFechamento
          card={pendente.card}
          posicao={pendente.posicao}
          servicos={servicos}
          onCancelar={cancelarModal}
          onConcluido={() => setPendente(null)}
        />
      )}
      {pendente?.tipo === 'perdida' && (
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

function Coluna({
  etapa,
  etapas,
  cards,
  onMover,
}: {
  etapa: EtapaKanban
  etapas: EtapaKanban[]
  cards: CardFunil[]
  onMover: (id: string, etapaId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  const total = cards.reduce(
    (soma, c) => soma + ((etapa.tipo === 'ganha' ? c.valorVendido : c.valorEstimado) ?? 0),
    0,
  )

  return (
    // A coluna inteira (cabeçalho incluso) é a área de soltura.
    <section
      ref={setNodeRef}
      aria-labelledby={`coluna-${etapa.id}`}
      className={`flex w-72 shrink-0 flex-col rounded-xl transition-colors ${
        isOver ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-zinc-100 dark:bg-zinc-900'
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 id={`coluna-${etapa.id}`} className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <PontoEtapa cor={etapa.cor} />
          <span className="truncate" title={etapa.nome}>
            {etapa.nome}
          </span>
          <span className="rounded-full bg-white px-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {cards.length}
          </span>
        </h2>
        {total > 0 && (
          <span className="text-xs text-zinc-500 tabular-nums">{formatarMoedaCompacta(total)}</span>
        )}
      </header>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-32 flex-1 flex-col gap-2 p-2">
          {cards.map((card) => (
            <CardArrastavel key={card.id} card={card} etapas={etapas} onMover={onMover} />
          ))}
        </ul>
      </SortableContext>
    </section>
  )
}

/** Botão nativo: Tab chega nele, Enter/Espaço acionam. */
function BotaoRolagem({
  rotulo,
  controla,
  desabilitado,
  onClick,
  esquerda = false,
}: {
  rotulo: string
  controla: string
  desabilitado: boolean
  onClick: () => void
  esquerda?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      aria-controls={controla}
      title={rotulo}
      className="rounded-md border border-zinc-300 p-1.5 text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <IconeSeta className={`size-4 ${esquerda ? 'rotate-180' : ''}`} />
    </button>
  )
}
