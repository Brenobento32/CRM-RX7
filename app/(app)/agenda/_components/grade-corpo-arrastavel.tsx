'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition } from 'react'

import { COR_STATUS } from '@/components/agenda/evento-item'
import { reagendarEventoAction } from '@/lib/actions/eventos'
import type { Evento } from '@/lib/dal/eventos'
import {
  hrefAgenda,
  minutosNoDia,
  minutosParaHora,
  novoInicioAoArrastar,
  organizarSobrepostos,
  VISAO_PADRAO,
  type ParametrosAgenda,
} from '@/lib/utils/calendario'
import { diaEmSaoPaulo, formatarHora, instanteSaoPaulo } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_EVENTO, statusEmAberto } from '@/lib/validations/evento'

import { classeTextoSobreCor, corDoResponsavel, rotuloAcessivel, semCorDefinida } from './evento-bloco'
import { LinhaAgora } from './linha-agora'

const ALTURA_MIN_PX = 18
/** Granularidade do clique num horário vazio (minutos). */
const PASSO_SLOT_MIN = 30
/** Depois de soltar um arraste, o clique que o navegador dispara não abre nada. */
const JANELA_POS_ARRASTE_MS = 300

type Sobrescrita = { dia: string; minutoInicio: number }

type EventoPosicionado = {
  evento: Evento
  dia: string
  minutoInicio: number
  duracaoMinutos: number
}

function paraIso(dia: string, minutoInicio: number): string {
  return new Date(instanteSaoPaulo(dia).getTime() + minutoInicio * 60_000).toISOString()
}

function posicionar(eventos: Evento[], sobrescritas: Map<string, Sobrescrita>): EventoPosicionado[] {
  return eventos.map((evento) => {
    const duracaoMinutos = Math.round((Date.parse(evento.fim) - Date.parse(evento.inicio)) / 60_000)
    const sobrescrita = sobrescritas.get(evento.id)
    if (sobrescrita) {
      return { evento, dia: sobrescrita.dia, minutoInicio: sobrescrita.minutoInicio, duracaoMinutos }
    }
    const dia = diaEmSaoPaulo(evento.inicio)
    return { evento, dia, minutoInicio: minutosNoDia(evento.inicio, dia), duracaoMinutos }
  })
}

/**
 * Camada de eventos arrastáveis das visões Dia e Semana: um único
 * `DndContext` cobrindo todas as colunas (arrastar de uma coluna pra outra
 * muda o dia; verticalmente muda o horário — mesmo gesto, dois eixos). O
 * cabeçalho e a coluna de horas continuam vindo do servidor (`GradeHoras`);
 * só quem precisa reagir a gesto de arraste é Client Component.
 *
 * Clique (ou Enter pelo teclado) abre os detalhes da reunião, arrastar move
 * — o dnd-kit só começa o arraste depois de 6 px, e o clique que vem logo
 * após soltar é ignorado. Clique num horário VAZIO abre "Nova reunião" já
 * com o dia e a hora (de 30 em 30 minutos). Pelo teclado, Espaço continua
 * sendo o atalho do dnd-kit pra pegar/soltar o evento (arrastar sem mouse).
 */
export function GradeCorpoArrastavel({
  dias,
  eventos,
  hoje,
  minutoAgoraInicial,
  gerente,
  base,
  alturaHoraPx,
}: {
  dias: string[]
  eventos: Evento[]
  hoje: string
  minutoAgoraInicial: number
  gerente: boolean
  base: Omit<ParametrosAgenda, 'evento'>
  alturaHoraPx: number
}) {
  const [sobrescritas, setSobrescritas] = useState<Map<string, Sobrescrita>>(new Map())
  const [, iniciarTransicao] = useTransition()
  const router = useRouter()
  // Durante o arraste e logo depois dele, o clique que o navegador dispara ao
  // soltar não deve abrir reunião nem "nova reunião" no horário.
  const arrastando = useRef(false)
  // id estável: sem ele o dnd-kit gera ids de acessibilidade diferentes no servidor e no navegador.
  const idDnd = useId()
  const padraoLink = { visao: VISAO_PADRAO, hoje }

  function novaNoHorario(dia: string, minuto: number) {
    router.push(hrefAgenda({ ...base, dia, nova: true, hora: minutosParaHora(minuto) }, padraoLink))
  }
  function podeAbrir() {
    return !arrastando.current
  }
  function marcarFimDoArraste() {
    window.setTimeout(() => {
      arrastando.current = false
    }, JANELA_POS_ARRASTE_MS)
  }

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Só Espaço ativa o arraste pelo teclado — Enter fica livre para abrir
    // os detalhes do evento (ver EventoArrastavel).
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )

  const posicionados = posicionar(eventos, sobrescritas)

  function handleDragEnd({ active, delta, over }: DragEndEvent) {
    marcarFimDoArraste()
    const posicao = posicionados.find((p) => p.evento.id === active.id)
    if (!posicao) return

    const diaDestino = typeof over?.id === 'string' ? over.id : posicao.dia
    const novoMinuto = novoInicioAoArrastar(posicao.minutoInicio, posicao.duracaoMinutos, delta.y, alturaHoraPx)
    if (diaDestino === posicao.dia && novoMinuto === posicao.minutoInicio) return

    const eventoId = posicao.evento.id
    setSobrescritas((atual) => new Map(atual).set(eventoId, { dia: diaDestino, minutoInicio: novoMinuto }))

    iniciarTransicao(async () => {
      const resultado = await reagendarEventoAction(eventoId, diaDestino, minutosParaHora(novoMinuto))
      if (!resultado.ok) {
        // Falha típica: o evento já mudou em outra aba, ou perdeu o status em
        // aberto entre o carregamento e o solta. Desfaz a posição otimista —
        // a revalidação (se a action chegou a rodar) já traz o real.
        console.warn('Reagendar evento:', resultado.mensagem)
        setSobrescritas((atual) => {
          const proxima = new Map(atual)
          proxima.delete(eventoId)
          return proxima
        })
      }
    })
  }

  return (
    <DndContext id={idDnd} sensors={sensores} onDragStart={() => (arrastando.current = true)} onDragEnd={handleDragEnd} onDragCancel={marcarFimDoArraste}>
      {dias.map((dia) => {
        const doDia = posicionados.filter((p) => p.dia === dia).sort((a, b) => a.minutoInicio - b.minutoInicio)
        const leiautePorId = new Map(
          organizarSobrepostos(
            doDia.map((p) => ({
              id: p.evento.id,
              inicio: paraIso(p.dia, p.minutoInicio),
              fim: paraIso(p.dia, p.minutoInicio + p.duracaoMinutos),
            })),
          ).map((l) => [l.id, l]),
        )

        return (
          <ColunaDroppable key={dia} dia={dia} alturaHoraPx={alturaHoraPx} onSlot={(m) => podeAbrir() && novaNoHorario(dia, m)}>
            {dia === hoje && <LinhaAgora minutoInicial={minutoAgoraInicial} alturaHoraPx={alturaHoraPx} />}

            {doDia.map((p) => {
              const l = leiautePorId.get(p.evento.id)!
              const alturaPx = Math.max((p.duracaoMinutos / 60) * alturaHoraPx, ALTURA_MIN_PX)

              return (
                <EventoArrastavel
                  key={p.evento.id}
                  evento={p.evento}
                  mostrarResponsavel={gerente}
                  href={hrefAgenda({ ...base, evento: p.evento.id }, padraoLink)}
                  podeAbrir={podeAbrir}
                  estilo={{
                    top: (p.minutoInicio / 60) * alturaHoraPx,
                    height: alturaPx,
                    left: `calc(${(l.coluna / l.colunas) * 100}% + 2px)`,
                    width: `calc(${100 / l.colunas}% - 4px)`,
                  }}
                />
              )
            })}
          </ColunaDroppable>
        )
      })}
    </DndContext>
  )
}

function ColunaDroppable({
  dia,
  alturaHoraPx,
  onSlot,
  children,
}: {
  dia: string
  alturaHoraPx: number
  /** Clique num horário vazio: minuto do dia, arredondado para baixo no passo. */
  onSlot: (minuto: number) => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dia })

  function clique(e: React.MouseEvent<HTMLDivElement>) {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const minuto = Math.floor(((y / alturaHoraPx) * 60) / PASSO_SLOT_MIN) * PASSO_SLOT_MIN
    onSlot(Math.min(Math.max(minuto, 0), 24 * 60 - PASSO_SLOT_MIN))
  }

  return (
    <div
      ref={setNodeRef}
      onClick={clique}
      title="Clique num horário vazio para agendar"
      className={`relative cursor-cell border-l border-zinc-100 hover:bg-zinc-50/60 dark:border-zinc-800 dark:hover:bg-zinc-800/30 ${isOver ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}`}
      style={{ height: 24 * alturaHoraPx }}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          aria-hidden
          className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800"
          style={{ top: h * alturaHoraPx }}
        />
      ))}
      {children}
    </div>
  )
}

function EventoArrastavel({
  evento,
  mostrarResponsavel,
  href,
  estilo,
  podeAbrir,
}: {
  evento: Evento
  mostrarResponsavel: boolean
  href: string
  estilo: React.CSSProperties
  podeAbrir: () => boolean
}) {
  const router = useRouter()
  const arrastavel = statusEmAberto(evento.status)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: evento.id,
    disabled: !arrastavel,
  })
  const cancelado = evento.status === 'cancelado'

  function abrirDetalhes() {
    router.push(href)
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...estilo,
        backgroundColor: corDoResponsavel(evento),
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm transition-shadow hover:z-10 hover:shadow-md ${classeTextoSobreCor(evento)} ${cancelado ? 'opacity-60' : ''} ${isDragging ? 'z-30 shadow-lg' : ''} ${arrastavel ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${semCorDefinida(evento) ? 'border border-dashed border-white/60' : ''}`}
      onClick={(e) => {
        // Não deixa o clique chegar à coluna (que abriria "Nova reunião").
        e.stopPropagation()
        if (podeAbrir()) abrirDetalhes()
      }}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        // Espaço: dnd-kit trata (pega/solta pelo teclado). Enter: abre os
        // detalhes — os dois convivem no mesmo bloco sem disputa porque o
        // KeyboardSensor foi configurado para só reagir a Espaço.
        listeners?.onKeyDown?.(e)
        if (e.key === 'Enter') {
          e.preventDefault()
          abrirDetalhes()
        }
      }}
    >
      <span className="sr-only">{rotuloAcessivel(evento, mostrarResponsavel)}. Clique ou Enter para abrir os detalhes.</span>
      <p aria-hidden className={`truncate font-medium ${cancelado ? 'line-through' : ''}`}>
        {evento.titulo}
      </p>
      <p aria-hidden className="truncate opacity-90">
        {formatarHora(evento.inicio)}
        {evento.usuario ? ` · ${evento.usuario}` : ''}
      </p>
      <p aria-hidden className="truncate">
        {/* Mesma cor/estilo do badge de status do modal (COR_STATUS) — sem o
            responsável aqui: ele já é a cor de fundo do bloco inteiro. */}
        <span className={`rounded px-1 py-0.5 text-[10px] font-medium uppercase ${COR_STATUS[evento.status]}`}>
          {ROTULO_STATUS_EVENTO[evento.status]}
        </span>
      </p>
    </div>
  )
}
