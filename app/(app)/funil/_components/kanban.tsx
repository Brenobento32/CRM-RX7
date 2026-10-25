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
import {
  CHAVE_HANDOFF_SDR,
  podeMoverNegociacaoColaborador,
  sdrPodeMoverPara,
  temTetoDeHandoff,
  tipoExigeModal,
  type EtapaKanban,
} from '@/lib/utils/etapas'
import { formatarMoedaCompacta } from '@/lib/utils/formatacao'
import type { Cargo as Papel } from '@/lib/validations/usuario'

/**
 * Mesmas mensagens do backend (`lib/dal/funil.ts`) — checagem aqui é só UX,
 * a trava real é no servidor (RPC `mover_negociacao` + RLS + trigger de
 * handoff).
 */
const MSG_HANDOFF_SDR = 'SDR e Atendente não podem movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'
const MSG_SEM_PERMISSAO_MOVER = 'Você não tem permissão para mover esta negociação.'

import { CardArrastavel, CardConteudo } from './card-negociacao'
import { DrawerNegociacao } from './drawer-negociacao'
import { ModalDesqualificar } from './modal-desqualificar'
import { ModalEdicaoRapida } from './modal-edicao-rapida'
import { ModalFechamento } from './modal-fechamento'
import { ModalFichaCliente } from './modal-ficha-cliente'
import { ModalObservacoes } from './modal-observacoes'
import { ModalPerda } from './modal-perda'
import { PainelConversa } from './painel-conversa'
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

/**
 * Etapa inicial do funil (`etapa.etapaInicial` — onde leads automáticos
 * entram, nunca mais resolvida pelo nome "Lead Novo"): mais recente
 * primeiro, por `card.dataChegada` (não por `posicao` — um lead importado
 * hoje não deve "subir" por ter sido gravado hoje). Nunca grava nada; é só
 * a ordem inicial de exibição, recalculada a cada carregamento do quadro.
 */
function compararChegada(a: CardFunil, b: CardFunil): number {
  const diff = new Date(b.dataChegada).getTime() - new Date(a.dataChegada).getTime()
  return diff !== 0 ? diff : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function agrupar(cards: CardFunil[], etapas: EtapaKanban[]): Colunas {
  const colunas: Colunas = Object.fromEntries(etapas.map((e) => [e.id, [] as CardFunil[]]))
  // Etapa desativada nunca tem cards (o banco impede); se aparecer um card
  // sem coluna, ele simplesmente não é exibido.
  for (const card of cards) colunas[card.etapaId]?.push(card)
  for (const etapa of etapas) {
    colunas[etapa.id]?.sort(etapa.etapaInicial ? compararChegada : compararCards)
  }
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
  papel,
  etapasMovimentaveis,
  servicos,
  whatsappHabilitado,
  meuId,
}: {
  /** Usuário atual — a carteira do Atendente (UX; o banco confere). */
  meuId: string
  cards: CardFunil[]
  etapas: EtapaKanban[]
  /** Dono da trava real é o servidor; aqui só decide o que esconder/desabilitar (item "Kanban"/UX). */
  papel: Papel
  /**
   * Etapas em que o usuário tem `pode_mover` configurado
   * (20261014160000_permissoes_colaborador.sql) — `null` pra gerente (sem
   * restrição nenhuma). owner_id NÃO entra nesta decisão: a tabela de
   * permissões é a única fonte de verdade pra SDR/CLOSER.
   */
  etapasMovimentaveis: string[] | null
  servicos: Servico[]
  whatsappHabilitado: boolean
}) {
  const dndId = useId()
  const quadroId = useId()
  const quadroRef = useRef<HTMLDivElement>(null)
  const rolagem = useRolagemHorizontal(quadroRef)
  const [colunas, setColunas] = useState(() => agrupar(cards, etapas))

  // `null` quando o funil não tem a etapa técnica "reuniao_realizada" — a
  // trava simplesmente não existe nele (mesma regra do backend).
  const ordemLimiteSdr = etapas.find((e) => e.chave === CHAVE_HANDOFF_SDR)?.ordem ?? null
  const ordemDe = (etapaId: string) => etapas.find((e) => e.id === etapaId)?.ordem ?? 0
  const etapasMovimentaveisSet = etapasMovimentaveis === null ? null : new Set(etapasMovimentaveis)
  const podeMoverEtapa = (etapaId: string) => etapasMovimentaveisSet === null || etapasMovimentaveisSet.has(etapaId)

  const etapaPorId = (etapaId: string) => etapas.find((e) => e.id === etapaId)

  /** Mesma decisão do RPC `mover_negociacao`/DAL — pura, testada (lib/utils/etapas.ts). */
  function podeMover(etapaOrigemId: string, etapaDestinoId: string, card?: CardFunil): boolean {
    return podeMoverNegociacaoColaborador({
      papel,
      podeMoverOrigem: podeMoverEtapa(etapaOrigemId),
      podeMoverDestino: podeMoverEtapa(etapaDestinoId),
      ordemOrigem: ordemDe(etapaOrigemId),
      ordemDestino: ordemDe(etapaDestinoId),
      ordemLimiteHandoffSdr: ordemLimiteSdr,
      atendente:
        papel === 'atendente'
          ? {
              origemLiberada: etapaPorId(etapaOrigemId)?.atendentePodeMover === true,
              destinoLiberado: etapaPorId(etapaDestinoId)?.atendentePodeMover === true,
              destinoAberto: etapaPorId(etapaDestinoId)?.tipo === 'aberta',
              // Sem card (decisão da coluna inteira): a carteira é vista card a card.
              daCarteira: card === undefined || card.ownerId === meuId,
            }
          : undefined,
    })
  }

  /** Etapas que podem ser destino a partir de `etapaOrigemId` no "Mover para"/drawer — as demais nem aparecem. */
  function etapasPermitidas(etapaOrigemId: string, card?: CardFunil): EtapaKanban[] {
    if (papel === 'gerente') return etapas
    return etapas.filter((e) => e.id === etapaOrigemId || podeMover(etapaOrigemId, e.id, card))
  }

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
  const [edicaoRapida, setEdicaoRapida] = useState<CardFunil | null>(null)
  const [drawer, setDrawer] = useState<CardFunil | null>(null)
  const [conversa, setConversa] = useState<CardFunil | null>(null)
  const [ficha, setFicha] = useState<CardFunil | null>(null)
  const [observacoes, setObservacoes] = useState<CardFunil | null>(null)
  const [desqualificar, setDesqualificar] = useState<CardFunil | null>(null)
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

    // UX: evita o round-trip quando o próprio frontend já sabe que o
    // servidor vai recusar (o servidor confere de novo, sempre — ver
    // moverNegociacao em lib/dal/funil.ts).
    if (papel !== 'gerente' && etapaId !== origem && !podeMover(origem, etapaId, card)) {
      setColunas(antes)
      const bloqueadoPeloHandoff =
        temTetoDeHandoff(papel) && !sdrPodeMoverPara(ordemDe(origem), ordemDe(etapaId), ordemLimiteSdr)
      setErro(bloqueadoPeloHandoff ? MSG_HANDOFF_SDR : MSG_SEM_PERMISSAO_MOVER)
      return
    }

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
          {salvando && <span className="text-premium-mudo">Salvando…</span>}
          {erro && (
            <span role="alert" className="text-red-400">
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
          {etapas.map((etapa) => {
            const alemDoHandoffSdr = temTetoDeHandoff(papel) && ordemLimiteSdr !== null && etapa.ordem > ordemLimiteSdr
            const semPermissaoNestaEtapa =
              papel !== 'gerente' &&
              (!podeMoverEtapa(etapa.id) || (papel === 'atendente' && etapa.atendentePodeMover !== true))
            return (
              <Coluna
                key={etapa.id}
                etapa={etapa}
                etapasPermitidas={etapasPermitidas}
                cards={colunas[etapa.id] ?? []}
                aviso={alemDoHandoffSdr ? 'Somente CLOSER' : semPermissaoNestaEtapa ? 'Sem permissão' : null}
                travada={papel !== 'gerente' && etapasPermitidas(etapa.id).length <= 1}
                onMover={moverPara}
                onEditar={setEdicaoRapida}
                onAbrirDrawer={setDrawer}
                onAbrirObservacoes={setObservacoes}
              />
            )
          })}
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

      {edicaoRapida && (
        <ModalEdicaoRapida
          card={edicaoRapida}
          servicosAtivos={servicos}
          onCancelar={() => setEdicaoRapida(null)}
          onConcluido={() => setEdicaoRapida(null)}
        />
      )}

      {drawer && (
        <DrawerNegociacao
          card={drawer}
          etapas={etapasPermitidas(drawer.etapaId, drawer)}
          whatsappHabilitado={whatsappHabilitado}
          onFechar={() => setDrawer(null)}
          onEditar={setEdicaoRapida}
          onMover={moverPara}
          onAbrirConversa={setConversa}
          onAbrirFicha={setFicha}
          onDesqualificar={setDesqualificar}
        />
      )}

      {conversa && <PainelConversa card={conversa} onFechar={() => setConversa(null)} />}

      {ficha && (
        <ModalFichaCliente
          card={ficha}
          etapas={etapas}
          // UX apenas — a trava real é a RLS de `atividades_insert`
          // (pode_mover_etapa). GERENTE sempre pode; SDR/CLOSER só se a
          // etapa atual do card estiver em `etapasMovimentaveis`.
          podeTrabalharCard={papel === 'gerente' || podeMoverEtapa(ficha.etapaId)}
          onFechar={() => setFicha(null)}
        />
      )}

      {observacoes && (
        <ModalObservacoes
          card={observacoes}
          // Mesmo cálculo de `podeTrabalharCard` da ficha, acima — UX
          // apenas, a trava real é `atividades_insert` (pode_mover_etapa).
          podeTrabalharCard={papel === 'gerente' || podeMoverEtapa(observacoes.etapaId)}
          onFechar={() => setObservacoes(null)}
        />
      )}

      {desqualificar && (
        <ModalDesqualificar
          card={desqualificar}
          onCancelar={() => setDesqualificar(null)}
          onConcluido={() => {
            setDesqualificar(null)
            // O lead some do Kanban (funil_cards filtra arquivada_em) —
            // manter o drawer aberto mostraria um card que já não existe mais ali.
            setDrawer(null)
          }}
        />
      )}
    </>
  )
}

function Coluna({
  etapa,
  etapasPermitidas,
  cards,
  aviso,
  travada,
  onMover,
  onEditar,
  onAbrirDrawer,
  onAbrirObservacoes,
}: {
  etapa: EtapaKanban
  /** Destinos válidos a partir desta coluna — ver `etapasPermitidas` em `Kanban`. Com o card, considera também a carteira do Atendente. */
  etapasPermitidas: (etapaOrigemId: string, card?: CardFunil) => EtapaKanban[]
  cards: CardFunil[]
  /** "Somente CLOSER" (além do handoff do SDR) ou "Sem permissão" (etapa fora do `pode_mover` configurado) — só informativo (UX), a trava real é no servidor. */
  aviso: string | null
  /** Não há nenhum destino válido a partir desta coluna — arraste desabilitado em todos os cards dela. */
  travada: boolean
  onMover: (id: string, etapaId: string) => void
  onEditar: (card: CardFunil) => void
  onAbrirDrawer: (card: CardFunil) => void
  onAbrirObservacoes: (card: CardFunil) => void
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
      className={`flex w-72 shrink-0 flex-col rounded-xl border transition-colors ${
        isOver ? 'border-premium-acento/40 bg-premium-borda/60' : 'border-premium-borda bg-premium-card'
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 id={`coluna-${etapa.id}`} className="flex min-w-0 items-center gap-2 text-sm font-semibold text-premium-texto">
          <PontoEtapa cor={etapa.cor} />
          <span className="truncate" title={etapa.nome}>
            {etapa.nome}
          </span>
          <span className="rounded-full bg-premium-borda px-1.5 text-xs font-medium text-premium-secundario">
            {cards.length}
          </span>
          {aviso && (
            <span
              title={
                aviso === 'Somente CLOSER'
                  ? 'A partir daqui, só o CLOSER movimenta o lead.'
                  : 'Você não tem permissão configurada para movimentar nesta etapa.'
              }
              className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
            >
              {aviso}
            </span>
          )}
        </h2>
        {total > 0 && <span className="text-xs text-premium-mudo tabular-nums">{formatarMoedaCompacta(total)}</span>}
      </header>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-32 flex-1 flex-col gap-2 p-2">
          {cards.map((card) => (
            <CardArrastavel
              key={card.id}
              card={card}
              etapas={etapasPermitidas(etapa.id, card)}
              travado={travada || etapasPermitidas(etapa.id, card).length <= 1}
              onMover={onMover}
              onEditar={onEditar}
              onAbrirDrawer={onAbrirDrawer}
              onAbrirObservacoes={onAbrirObservacoes}
            />
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
      className="rounded-md border border-premium-borda p-1.5 text-premium-secundario transition hover:bg-premium-card disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <IconeSeta className={`size-4 ${esquerda ? 'rotate-180' : ''}`} />
    </button>
  )
}
