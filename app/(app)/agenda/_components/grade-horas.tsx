import Link from 'next/link'

import type { Evento } from '@/lib/dal/eventos'
import { minutosAgora, type LinkAgenda, type ParametrosAgenda } from '@/lib/utils/calendario'
import { formatarDia } from '@/lib/utils/formatacao'
import { diaDaSemanaIso, DIAS_SEMANA } from '@/lib/utils/recorrencia'

import { GradeCorpoArrastavel } from './grade-corpo-arrastavel'
import { GradeScroll } from './grade-scroll'

const ALTURA_HORA_PX = 48
/** Hora em que a grade abre visualmente (rola até aqui, mas os eventos fora
 * desse intervalo continuam existindo e acessíveis rolando). */
const HORA_INICIAL_VISIVEL = 8

const HORAS = Array.from({ length: 24 }, (_, h) => h)

function nomeCurtoDia(dia: string) {
  return DIAS_SEMANA[diaDaSemanaIso(dia) - 1].curto
}

/**
 * Grade de horários compartilhada pelas visões Dia e Semana. O cabeçalho e a
 * coluna de horas são Server Component; os dias com os eventos (arrastáveis)
 * vêm do `GradeCorpoArrastavel`, Client Component por causa do dnd-kit.
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
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={{ gridTemplateColumns: colunas }}>
        <div aria-hidden />
        {dias.map((d) => (
          <Link
            key={d}
            href={link({ visao: 'dia', dia: d })}
            className={`border-l border-zinc-100 px-1 py-2 text-center text-xs dark:border-zinc-800 ${
              d === hoje
                ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
            }`}
          >
            <p className="uppercase text-zinc-500">{nomeCurtoDia(d)}</p>
            <p className="text-sm">{formatarDia(d, false)}</p>
          </Link>
        ))}
      </div>

      <GradeScroll topoPx={HORA_INICIAL_VISIVEL * ALTURA_HORA_PX}>
        <div className="grid" style={{ gridTemplateColumns: colunas }}>
          <div className="relative" style={{ height: 24 * ALTURA_HORA_PX }}>
            {HORAS.slice(1).map((h) => (
              <p
                key={h}
                aria-hidden
                className="absolute right-1.5 -translate-y-1/2 text-xs text-zinc-400"
                style={{ top: h * ALTURA_HORA_PX }}
              >
                {String(h).padStart(2, '0')}:00
              </p>
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
