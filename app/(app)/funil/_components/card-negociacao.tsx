'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Link from 'next/link'

import type { CardFunil } from '@/lib/dal/funil'
import { formatarTelefone } from '@/lib/utils/documentos'
import { corDeNicho, type EtapaKanban } from '@/lib/utils/etapas'
import { amanhaSaoPaulo, formatarDataRelativaHora, formatarDia, formatarMoeda, hojeSaoPaulo } from '@/lib/utils/formatacao'
import { ROTULO_ORIGEM } from '@/lib/validations/funil'
import { ROTULO_TEMPERATURA } from '@/lib/validations/negociacao'

import { MenuMoverPara } from './menu-mover'

/** Fixo pelo sistema — o usuário só edita o VALOR da temperatura na ficha, nunca o emoji (item 1.4). */
const EMOJI_TEMPERATURA: Record<NonNullable<CardFunil['temperatura']>, string> = {
  quente: '🔥',
  morno: '🌤️',
  frio: '❄️',
}

/** Pill da origem — nunca substitui a cor da borda (que é do nicho). */
const PILL_ORIGEM: Record<CardFunil['origem'], string> = {
  formulario: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  manual: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

/** Resumo de campanha pro card: só o nome (ou o id, sem nome) — nunca os outros IDs técnicos aqui (item 8). */
function resumoCampanha(atribuicao: CardFunil['atribuicao']): string | null {
  if (!atribuicao) return null
  return atribuicao.campaign_name || atribuicao.campaign_id || null
}

/** "Parado hoje" / "Parado há 1 dia" / "Parado há N dias" — item 1.5, mesmo `diasNaEtapa` do resto do CRM. */
function textoParado(dias: number): string {
  if (dias <= 0) return 'Parado hoje'
  if (dias === 1) return 'Parado há 1 dia'
  return `Parado há ${dias} dias`
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
  /** Abre a edição rápida da proposta; ausente na cópia flutuante do arraste. */
  onEditar?: (card: CardFunil) => void
  /** Abre o painel lateral (ficha/drawer); ausente na cópia flutuante do arraste. */
  onAbrirDrawer?: (card: CardFunil) => void
}) {
  const campanha = resumoCampanha(card.atribuicao)
  // Proposta: o valor vendido manda quando a etapa é ganha, senão o estimado
  // — mesma regra de sempre, só o rótulo mudou para "Proposta" (item 1.7).
  const proposta = card.etapaTipo === 'ganha' ? card.valorVendido : card.valorEstimado

  return (
    <article
      onClick={() => onAbrirDrawer?.(card)}
      // A borda representa o NICHO (item 2) — sempre colorida, "Outros" (sem
      // nicho) usa o cinza da paleta em vez de ficar sem cor. A pill de
      // origem (abaixo) nunca substitui isso.
      style={{ borderLeftColor: corDeNicho(card.nichoCor), borderLeftWidth: 3 }}
      title={card.nichoNome ?? 'Outros'}
      className={`relative cursor-grab touch-none rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950 ${
        flutuando ? 'cursor-grabbing shadow-lg ring-2 ring-zinc-900/10' : 'shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      {/* 1/2: instituição (ou o nome, se não houver empresa) + pessoa; o menu
          "Mover" ocupa o canto superior direito na mesma linha. */}
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
        <div className="shrink-0">{menu}</div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onEditar?.(card)
        }}
        aria-label={`Editar proposta de ${card.clienteNome}`}
        title="Editar proposta"
        className="absolute top-2 left-2 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        {...pararArraste}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <path d="M16.862 4.487a1.875 1.875 0 1 1 2.652 2.652L7.5 19.153l-4.243 1.06 1.06-4.242 12.545-12.484Z" />
        </svg>
      </button>

      {/* 3: nicho — negrito, na cor do próprio nicho (mesma fonte de verdade
          da borda); "Outros" usa o cinza da paleta, nunca sem cor. */}
      <p className="mt-2 truncate text-xs font-semibold" style={{ color: corDeNicho(card.nichoCor) }}>
        {card.nichoNome ?? 'Outros'}
      </p>

      {/* 4: origem (pill) + temperatura (texto + emoji fixo) na mesma linha (item 1.4). */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PILL_ORIGEM[card.origem]}`}>
          {ROTULO_ORIGEM[card.origem]}
        </span>
        {card.temperatura && (
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {EMOJI_TEMPERATURA[card.temperatura]} {ROTULO_TEMPERATURA[card.temperatura]}
          </span>
        )}
      </div>

      {/* 5: tempo parado — sempre visível, mesmo `diasNaEtapa` do resto do CRM (item 1.5). */}
      <p
        className={`mt-2 flex items-center gap-1 text-xs ${
          card.parado ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'
        }`}
      >
        <span aria-hidden>⏱</span> {textoParado(card.diasNaEtapa)}
      </p>

      {/* 6: telefone — só quando existir (item 1.6). */}
      {card.clienteTelefone && (
        <p className="mt-1.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
          <span aria-hidden>☎</span> {formatarTelefone(card.clienteTelefone)}
        </p>
      )}

      {/* 7: proposta — só quando existir, nunca "adivinhada" (item 1.7). */}
      {proposta !== null && <p className="mt-1.5 font-semibold tabular-nums">Proposta: {formatarMoeda(proposta)}</p>}

      {/* 8/9: última atividade, depois próxima ação — só quando existirem (itens 1.8/1.9). */}
      {(card.ultimaAtividade || card.proximaAcao) && (
        <dl className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {card.ultimaAtividade && (
            <div className="flex gap-1">
              <dt className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">Última atividade:</dt>
              <dd className="truncate">{formatarDataRelativaHora(card.ultimaAtividade.data)}</dd>
            </div>
          )}
          {card.proximaAcao && <ProximaAcao {...card.proximaAcao} />}
        </dl>
      )}

      {/* Campanha (item 8/9 — atribuição) — só quando houver; nunca IDs técnicos aqui. */}
      {campanha && (
        <p className="mt-2 truncate text-xs text-zinc-500" title={campanha}>
          Campanha: {campanha}
        </p>
      )}
    </article>
  )
}

function ProximaAcao({ titulo, data }: { titulo: string; data: string }) {
  const hoje = hojeSaoPaulo()
  const amanha = amanhaSaoPaulo()
  const atrasada = data < hoje

  const quando = data === hoje ? 'hoje' : data === amanha ? 'amanhã' : formatarDia(data, false)

  return (
    <div className="flex gap-1">
      <dt className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">Próxima ação:</dt>
      <dd className="truncate" title={titulo}>
        {titulo}{' '}
        <span
          className={
            atrasada
              ? 'font-medium text-red-600 dark:text-red-400'
              : data === hoje
                ? 'font-medium text-amber-700 dark:text-amber-400'
                : undefined
          }
        >
          {quando}
        </span>
      </dd>
    </div>
  )
}
