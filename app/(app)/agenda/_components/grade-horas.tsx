import Link from 'next/link'

import type { Evento } from '@/lib/dal/eventos'
import { ALTURA_HORA_PX, minutosAgora, type LinkAgenda, type ParametrosAgenda } from '@/lib/utils/calendario'
import { formatarDia } from '@/lib/utils/formatacao'
import { diaDaSemanaIso, DIAS_SEMANA } from '@/lib/utils/recorrencia'

import { GradeCorpoArrastavel } from './grade-corpo-arrastavel'
import { GradeScroll } from './grade-scroll'

/** Hora em que a grade abre visualmente (rola até aqui, mas os eventos fora
 * desse intervalo continuam existindo e acessíveis rolando). */
const HORA_INICIAL_VISIVEL = 8

const HORAS = Array.from({ length: 24 }, (_, h) => h)

function nomeCurtoDia(dia: string) {
  return DIAS_SEMANA[diaDaSemanaIso(dia) - 1].curto
}

/**
 * Grade de horários compartilhada pelas visões Dia e Semana, no estilo do
 * Google Agenda: cada hora tem a mesma altura (`ALTURA_HORA_PX`, 1 px por
 * minuto), linha forte em cada hora, tracejada na meia hora, e uma linha
 * vertical entre os dias. O cabeçalho dos dias fica DENTRO da área com
 * rolagem (fixo no topo), para as colunas do cabeçalho e do corpo terem
 * sempre a mesma largura — com ou sem barra de rolagem.
 *
 * Cabeçalho e coluna de horas são Server Component; os dias com os eventos
 * (arrastáveis) vêm do `GradeCorpoArrastavel`, Client Component (dnd-kit).
 */
export function GradeHoras({
  dias,
  eventos,
  hoje,
  gerente,
  link,
  base,
}: {
  dias: string[]
  eventos: Evento[]
  hoje: string
  gerente: boolean
  link: LinkAgenda
  base: Omit<ParametrosAgenda, 'evento'>
}) {
  const colunas = `3.5rem repeat(${dias.length}, minmax(0, 1fr))`

  return (
    <div className="overflow-hidden rounded-lg border border-premium-borda bg-premium-card">
      <GradeScroll topoPx={HORA_INICIAL_VISIVEL * ALTURA_HORA_PX}>
        <div
          className="sticky top-0 z-30 grid border-b border-premium-borda bg-premium-card"
          style={{ gridTemplateColumns: colunas }}
        >
          <div aria-hidden className="border-r border-premium-borda" />
          {dias.map((d, i) => (
            <Link
              key={d}
              href={link({ visao: 'dia', dia: d })}
              className={`min-w-0 px-1 py-2 text-center text-xs transition ${i > 0 ? 'border-l border-premium-borda' : ''} ${
                d === hoje
                  ? 'bg-premium-acento-suave font-semibold text-premium-acento'
                  : 'text-premium-secundario hover:bg-premium-bg'
              }`}
            >
              <p className="uppercase tracking-wide">{nomeCurtoDia(d)}</p>
              <p className={`text-sm tabular-nums ${d === hoje ? '' : 'text-premium-texto'}`}>
                {/* No celular só o número do dia cabe na coluna. */}
                <span className="sm:hidden">{Number(d.slice(8, 10))}</span>
                <span className="hidden sm:inline">{formatarDia(d, false)}</span>
              </p>
            </Link>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: colunas }}>
          <div className="relative border-r border-premium-borda" style={{ height: 24 * ALTURA_HORA_PX }}>
            {HORAS.slice(1).map((h) => (
              <div key={h} aria-hidden className="absolute inset-x-0" style={{ top: h * ALTURA_HORA_PX }}>
                <p className="absolute right-2.5 -translate-y-1/2 bg-premium-card px-0.5 text-[11px] leading-none text-premium-mudo tabular-nums">
                  {String(h).padStart(2, '0')}:00
                </p>
                {/* Traço curto da hora, emendando com a linha da grade. */}
                <span className="absolute right-0 h-px w-1.5 bg-premium-borda" />
              </div>
            ))}
          </div>

          <GradeCorpoArrastavel
            dias={dias}
            eventos={eventos}
            hoje={hoje}
            minutoAgoraInicial={minutosAgora()}
            gerente={gerente}
            base={base}
            alturaHoraPx={ALTURA_HORA_PX}
          />
        </div>
      </GradeScroll>
    </div>
  )
}
