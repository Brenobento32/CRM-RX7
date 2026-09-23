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

export function CardArrastavel({
  card,
  etapas,
  onMover,
}: {
  card: CardFunil
  etapas: EtapaKanban[]
  onMover: (id: string, etapaId: string) => void
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
}: {
  card: CardFunil
  flutuando?: boolean
  /** Menu "Mover para"; ausente na cópia flutuante do arraste. */
  menu?: React.ReactNode
}) {
  return (
    <article
      className={`cursor-grab touch-none rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950 ${
        flutuando ? 'cursor-grabbing shadow-lg ring-2 ring-zinc-900/10' : 'shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/clientes/${card.clienteId}`}
            className="block truncate font-medium hover:underline"
            title={card.clienteNome}
          >
            {card.clienteNome}
          </Link>
          {card.clienteEmpresa && (
            <p className="truncate text-xs text-zinc-500" title={card.clienteEmpresa}>
              {card.clienteEmpresa}
            </p>
          )}
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

      <p className="mt-2 font-semibold tabular-nums">
        {card.valorEstimado !== null ? (
          formatarMoeda(card.valorEstimado)
        ) : (
          <span className="font-normal text-zinc-400">Sem valor estimado</span>
        )}
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
