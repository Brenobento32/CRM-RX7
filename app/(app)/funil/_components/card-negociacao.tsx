'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Link from 'next/link'

import type { CardFunil } from '@/lib/dal/funil'
import type { EtapaKanban } from '@/lib/utils/etapas'
import { formatarData, formatarDia, formatarMoeda, hojeSaoPaulo } from '@/lib/utils/formatacao'
import { ROTULO_TIPO_ATIVIDADE } from '@/lib/validations/atividade'
import { ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { MenuMoverPara } from './menu-mover'

const COR_TEMPERATURA: Record<NonNullable<CardFunil['temperatura']>, string> = {
  quente: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  morno: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  frio: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
}

/**
 * O card inteiro escuta ponteiro e teclado do dnd-kit (mesmo motivo do botão
 * "Mover para" em menu-mover.tsx): sem isso, um clique no lápis também
 * tentaria iniciar um arraste, e Enter com o link focado dispararia um
 * arraste por teclado.
 */
const pararArraste = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
}

export function CardArrastavel({
  card,
  etapas,
  onMover,
  onEditar,
  onAbrirDrawer,
}: {
  card: CardFunil
  etapas: EtapaKanban[]
  onMover: (id: string, etapaId: string) => void
  onEditar: (card: CardFunil) => void
  onAbrirDrawer: (card: CardFunil) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : undefined}
      aria-label={`Negociação de ${card.clienteNome}`}
      {...attributes}
      {...listeners}
    >
      <CardConteudo
        card={card}
        onEditar={onEditar}
        onAbrirDrawer={onAbrirDrawer}
        menu={
          <MenuMoverPara
            etapaAtual={card.etapaId}
            etapas={etapas}
            nomeCliente={card.clienteNome}
            onEscolher={(etapa) => onMover(card.id, etapa)}
          />
        }
      />
    </li>
  )
}

export function CardConteudo({
  card,
  flutuando = false,
  menu,
  onEditar,
  onAbrirDrawer,
}: {
  card: CardFunil
  flutuando?: boolean
  /** Menu "Mover para"; ausente na cópia flutuante do arraste. */
  menu?: React.ReactNode
  /** Abre a edição rápida; ausente na cópia flutuante do arraste. */
  onEditar?: (card: CardFunil) => void
  /** Abre o painel lateral; ausente na cópia flutuante do arraste. */
  onAbrirDrawer?: (card: CardFunil) => void
}) {
  return (
    <article
      onClick={() => onAbrirDrawer?.(card)}
      className={`relative cursor-grab touch-none rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950 ${
        flutuando ? 'cursor-grabbing shadow-lg ring-2 ring-zinc-900/10' : 'shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onEditar?.(card)
        }}
        aria-label={`Editar negociação de ${card.clienteNome}`}
        title="Editar"
        className="absolute top-2 left-2 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        {...pararArraste}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <path d="M16.862 4.487a1.875 1.875 0 1 1 2.652 2.652L7.5 19.153l-4.243 1.06 1.06-4.242 12.545-12.484Z" />
        </svg>
      </button>

      <div className="flex items-start justify-between gap-2 pl-6">
        <div className="min-w-0">
          {card.clienteEmpresa && (
            <p className="truncate text-sm font-semibold" title={card.clienteEmpresa}>
              {card.clienteEmpresa}
            </p>
          )}
          <Link
            href={`/clientes/${card.clienteId}`}
            onClick={(e) => e.stopPropagation()}
            className={`block truncate hover:underline ${
              card.clienteEmpresa ? 'text-xs font-normal text-zinc-500' : 'font-medium'
            }`}
            title={card.clienteNome}
          >
            {card.clienteNome}
          </Link>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {card.temperatura && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_TEMPERATURA[card.temperatura]}`}
            >
              {ROTULO_TEMPERATURA[card.temperatura]}
            </span>
          )}
          {menu}
        </div>
      </div>

      {card.parado && (
        <p className="mt-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <span aria-hidden>⏱</span> Parado há {card.diasNaEtapa} dias
        </p>
      )}

      <p className="mt-2 font-semibold tabular-nums">
        {(() => {
          // Fechada: o valor que importa é o vendido, não a estimativa da
          // qualificação. Aberta/perdida continuam mostrando o estimado.
          const valor = card.etapaTipo === 'ganha' ? card.valorVendido : card.valorEstimado
          if (valor !== null) return formatarMoeda(valor)
          const rotulo = card.etapaTipo === 'ganha' ? 'Sem valor vendido' : 'Sem valor estimado'
          return <span className="font-normal text-zinc-400">{rotulo}</span>
        })()}
      </p>

      <dl className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {card.proximaAcao && <ProximaAcao {...card.proximaAcao} />}
        {card.ultimaAtividade && (
          <div className="flex gap-1">
            <dt className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">Última atividade:</dt>
            <dd className="truncate" title={card.ultimaAtividade.descricao}>
              {formatarData(card.ultimaAtividade.data)} ·{' '}
              {ROTULO_TIPO_ATIVIDADE[card.ultimaAtividade.tipo]}
            </dd>
          </div>
        )}
        {card.responsavel && (
          <div className="flex gap-1">
            <dt className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">Responsável:</dt>
            <dd className="truncate">{card.responsavel}</dd>
          </div>
        )}
      </dl>
    </article>
  )
}

function ProximaAcao({ titulo, data }: { titulo: string; data: string }) {
  const hoje = hojeSaoPaulo()
  const atrasada = data < hoje

  return (
    <div className="flex gap-1">
      <dt className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">Próxima ação:</dt>
      <dd className="truncate" title={titulo}>
        <span
          className={
            atrasada
              ? 'font-medium text-red-600 dark:text-red-400'
              : data === hoje
                ? 'font-medium text-amber-700 dark:text-amber-400'
                : undefined
          }
        >
          {data === hoje ? 'hoje' : formatarDia(data, false)}
        </span>{' '}
        · {titulo}
      </dd>
    </div>
  )
}
