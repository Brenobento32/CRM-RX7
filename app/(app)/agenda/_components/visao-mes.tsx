import Link from 'next/link'

import type { Evento } from '@/lib/dal/eventos'
import { agruparPorDia, type LinkAgenda } from '@/lib/utils/calendario'
import { DIAS_SEMANA } from '@/lib/utils/recorrencia'

import { EventoChipMes } from './evento-bloco'

/** Quantos eventos aparecem por célula antes do "+N mais". */
const MAX_POR_CELULA = 3

/**
 * Grade de 6 semanas. Célula lotada linka para a visão Dia (`+N mais`) em vez
 * de abrir um popover — mais simples e sem componente novo, como combinado.
 */
export function VisaoMes({
  dias,
  eventos,
  dia,
  hoje,
  gerente,
  link,
}: {
  dias: string[]
  eventos: Evento[]
  dia: string
  hoje: string
  gerente: boolean
  link: LinkAgenda
}) {
  const porDia = agruparPorDia(eventos)
  const mesAtual = dia.slice(0, 7)

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-800">
        {DIAS_SEMANA.map((d) => (
          <p key={d.valor} aria-hidden className="border-l border-zinc-100 px-2 py-2 text-center text-xs text-zinc-500 first:border-l-0 dark:border-zinc-800">
            {d.nome}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {dias.map((d) => {
          const doDia = (porDia.get(d) ?? []).slice().sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
          const foraDoMes = d.slice(0, 7) !== mesAtual
          const ehHoje = d === hoje
          const visiveis = doDia.slice(0, MAX_POR_CELULA)
          const resto = doDia.length - visiveis.length

          return (
            <div
              key={d}
              className={`min-h-28 border-l border-t border-zinc-100 p-1 first:border-l-0 dark:border-zinc-800 ${foraDoMes ? 'bg-zinc-50/50 dark:bg-zinc-900/40' : ''}`}
            >
              <Link
                href={link({ visao: 'dia', dia: d })}
                className={`mb-1 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs ${
                  ehHoje
                    ? 'bg-zinc-900 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : foraDoMes
                      ? 'text-zinc-400 dark:text-zinc-600'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {rotuloDia(d)}
              </Link>

              <ul className="space-y-0.5">
                {visiveis.map((e) => (
                  <li key={e.id}>
                    <EventoChipMes evento={e} mostrarResponsavel={gerente} href={link({ evento: e.id })} />
                  </li>
                ))}
              </ul>

              {resto > 0 && (
                <Link
                  href={link({ visao: 'dia', dia: d })}
                  className="mt-0.5 block text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                >
                  +{resto} mais
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

/** Número do dia; no dia 1 de cada mês mostra o mês também, para não perder a virada. */
function rotuloDia(dia: string) {
  const numero = Number(dia.slice(8, 10))
  if (numero !== 1) return numero
  return `${numero} ${MESES_CURTOS[Number(dia.slice(5, 7)) - 1]}`
}
