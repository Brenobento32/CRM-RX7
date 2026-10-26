import Link from 'next/link'

import { janelaDaVisao, navegar, tituloPeriodo, type LinkAgenda } from '@/lib/utils/calendario'
import { DIAS_SEMANA } from '@/lib/utils/recorrencia'

/**
 * Mês pequeno na lateral: cada dia é um link que muda a data de referência
 * (mantendo a visão principal). 100% navegação por `<Link>`, sem JS.
 */
export function MiniCalendario({
  dia,
  hoje,
  diasComEvento,
  link,
}: {
  dia: string
  hoje: string
  diasComEvento: Set<string>
  link: LinkAgenda
}) {
  const janela = janelaDaVisao('mes', dia)
  const mesAtual = dia.slice(0, 7)
  const mesAnterior = navegar('mes', dia, -1)
  const mesProximo = navegar('mes', dia, 1)

  return (
    <div className="rounded-lg border border-premium-borda bg-premium-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <Link href={link({ dia: mesAnterior })} className="rounded p-1 text-sm hover:bg-premium-bg" aria-label="Mês anterior">
          ←
        </Link>
        <p className="text-sm font-medium first-letter:uppercase">{tituloPeriodo('mes', dia, janela)}</p>
        <Link href={link({ dia: mesProximo })} className="rounded p-1 text-sm hover:bg-premium-bg" aria-label="Próximo mês">
          →
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {DIAS_SEMANA.map((d) => (
          <span key={d.valor} aria-hidden className="text-premium-mudo">
            {d.curto}
          </span>
        ))}
        {janela.dias.map((d) => {
          const foraDoMes = d.slice(0, 7) !== mesAtual
          const selecionado = d === dia
          const ehHoje = d === hoje
          return (
            <Link
              key={d}
              href={link({ dia: d })}
              aria-current={selecionado ? 'date' : undefined}
              className={`relative mx-auto flex size-7 items-center justify-center rounded-full ${
                selecionado
                  ? 'bg-premium-texto font-medium text-premium-bg'
                  : ehHoje
                    ? 'font-semibold text-premium-texto ring-1 ring-zinc-300 dark:ring-zinc-700'
                    : 'hover:bg-premium-bg'
              } ${foraDoMes && !selecionado ? 'text-zinc-400 dark:text-zinc-600' : ''}`}
            >
              {Number(d.slice(8, 10))}
              {diasComEvento.has(d) && (
                <span
                  aria-hidden
                  className={`absolute bottom-0.5 size-1 rounded-full ${selecionado ? 'bg-white dark:bg-zinc-900' : 'bg-blue-500'}`}
                />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
