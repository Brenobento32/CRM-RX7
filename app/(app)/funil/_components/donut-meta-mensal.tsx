'use client'

import { useState } from 'react'

import type { ProgressoEmpresa } from '@/lib/dal/metas'
import { ticketMedio } from '@/lib/utils/financeiro-periodo'
import { formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '@/lib/utils/formatacao'
import { fracaoDonut } from '@/lib/utils/painel-metricas'

const RAIO = 60
const ESPESSURA = 14
const CIRCUNFERENCIA = 2 * Math.PI * RAIO

const CORES: Record<'tcv' | 'mrr', { trilho: string; preenchimento: string; texto: string }> = {
  tcv: { trilho: 'stroke-zinc-100 dark:stroke-zinc-800', preenchimento: 'stroke-emerald-500 dark:stroke-emerald-400', texto: 'text-emerald-700 dark:text-emerald-400' },
  mrr: { trilho: 'stroke-zinc-100 dark:stroke-zinc-800', preenchimento: 'stroke-sky-500 dark:stroke-sky-400', texto: 'text-sky-700 dark:text-sky-400' },
}

/**
 * Painel central "Meta mensal" — círculo de progresso com alternância
 * TCV/MRR (estado só de cliente, local, nunca na URL: trocar a aba não
 * recarrega a página nem muda nenhum outro filtro). TCV e MRR NUNCA são
 * somados num percentual único — a troca mostra um dos dois de cada vez,
 * cada um com sua própria meta/realizado/percentual, exatamente como vêm
 * de `obterProgressoMetas` (RPC `metas_progresso`); nenhuma matemática nova
 * aqui além de `ticketMedio` (pura, já existente, `realizado ÷ quantidade`).
 *
 * Sem meta: círculo mostra "—" (nunca 0%, que pareceria "meta batida em
 * 0"), mesma distinção que `TextoPercentual`/`BarraProgresso` já fazem.
 */
export function DonutMetaMensal({ progresso }: { progresso: ProgressoEmpresa | null }) {
  const [aba, setAba] = useState<'tcv' | 'mrr'>('tcv')

  if (!progresso) {
    return (
      <section className="flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Meta mensal</h2>
        <p className="text-sm text-zinc-500">Nenhuma meta da empresa visível para o seu papel.</p>
      </section>
    )
  }

  const dados = progresso[aba]
  const cor = CORES[aba]
  const ticket = ticketMedio(dados.realizado, dados.quantidade)

  return (
    <section className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex w-full items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Meta mensal</h2>
        <div role="tablist" aria-label="TCV ou MRR" className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
          {(['tcv', 'mrr'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={aba === t}
              onClick={() => setAba(t)}
              className={`rounded px-2.5 py-1 text-xs font-medium uppercase transition ${
                aba === t
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <AneDeProgresso percentual={dados.percentual} realizado={dados.realizado} cor={cor} aba={aba} />

      <dl className="grid w-full grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Meta mensal</dt>
          <dd className="font-medium tabular-nums">
            {dados.valorMeta === null ? <span className="text-zinc-400">Não definida</span> : formatarMoeda(dados.valorMeta)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Realizado no mês</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(dados.realizado)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Ticket médio</dt>
          <dd className="font-medium tabular-nums">{ticket === null ? <span className="text-zinc-400">—</span> : formatarMoeda(ticket)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Quantidade de vendas</dt>
          <dd className="font-medium tabular-nums">{dados.quantidade}</dd>
        </div>
      </dl>
    </section>
  )
}

function AneDeProgresso({
  percentual,
  realizado,
  cor,
  aba,
}: {
  percentual: number | null
  realizado: number
  cor: { trilho: string; preenchimento: string; texto: string }
  aba: 'tcv' | 'mrr'
}) {
  const fracaoVisual = fracaoDonut(percentual)
  const tamanho = (RAIO + ESPESSURA) * 2

  return (
    <div className="relative" style={{ width: tamanho, height: tamanho }}>
      <svg
        viewBox={`0 0 ${tamanho} ${tamanho}`}
        className="-rotate-90"
        role="img"
        aria-label={`Progresso da meta mensal de ${aba.toUpperCase()}: ${percentual === null ? 'sem meta definida' : formatarPercentual(percentual)}`}
      >
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={RAIO}
          fill="none"
          strokeWidth={ESPESSURA}
          className={cor.trilho}
        />
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={RAIO}
          fill="none"
          strokeWidth={ESPESSURA}
          strokeLinecap="round"
          strokeDasharray={CIRCUNFERENCIA}
          strokeDashoffset={CIRCUNFERENCIA * (1 - fracaoVisual)}
          className={`transition-[stroke-dashoffset] ${cor.preenchimento}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
        <span className="text-lg font-semibold tabular-nums" title={formatarMoeda(realizado)}>
          {formatarMoedaCompacta(realizado)}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${cor.texto}`}>
          {percentual === null ? '—' : formatarPercentual(percentual)}
        </span>
        <span className="text-[11px] text-zinc-500">da meta mensal</span>
      </div>
    </div>
  )
}
