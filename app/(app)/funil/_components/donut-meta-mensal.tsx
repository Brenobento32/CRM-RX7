'use client'

import { useState } from 'react'

import type { ProgressoEmpresa } from '@/lib/dal/metas'
import { ticketMedio } from '@/lib/utils/financeiro-periodo'
import { formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '@/lib/utils/formatacao'
import { fracaoDonut } from '@/lib/utils/painel-metricas'
import { rotuloMes } from '@/lib/utils/periodo'

import { IconeAlvo } from './icones-metricas'

const RAIO = 96
const ESPESSURA = 18
const CIRCUNFERENCIA = 2 * Math.PI * RAIO

const CORES: Record<'tcv' | 'mrr', { trilho: string; preenchimento: string; texto: string }> = {
  tcv: { trilho: 'stroke-premium-borda', preenchimento: 'stroke-emerald-400', texto: 'text-emerald-700 dark:text-emerald-400' },
  mrr: { trilho: 'stroke-premium-borda', preenchimento: 'stroke-sky-400', texto: 'text-sky-700 dark:text-sky-400' },
}

/**
 * Painel "Meta de faturamento" — círculo de progresso com alternância TCV/MRR
 * (estado só de cliente, local, nunca na URL: trocar a aba não recarrega a
 * página nem muda nenhum outro filtro). TCV e MRR NUNCA são somados num
 * percentual único — a troca mostra um dos dois de cada vez, cada um com sua
 * própria meta/realizado/percentual.
 *
 * SEMPRE a meta GERAL da empresa (`progresso` vem de `obterProgressoMetas`,
 * RPC `metas_progresso`) — não existe meta por funil hoje (a rodada que
 * tentou vincular este painel ao funil selecionado foi revertida por
 * decisão de produto). Cabeçalho mostra só o mês — nunca o nome de um funil,
 * que daria a entender (errado) que a meta é por funil.
 *
 * Sem meta: círculo mostra "—" (nunca 0%, que pareceria "meta batida em
 * 0"), mesma distinção que `TextoPercentual`/`BarraProgresso` já fazem.
 */
export function DonutMetaMensal({ progresso, mes }: { progresso: ProgressoEmpresa | null; mes: string }) {
  const [aba, setAba] = useState<'tcv' | 'mrr'>('tcv')

  if (!progresso) {
    return (
      <section className="flex min-h-[460px] flex-col items-center justify-center gap-2 rounded-2xl border border-premium-borda bg-premium-card p-5 text-center">
        <h2 className="text-base font-semibold text-premium-texto">Meta de faturamento</h2>
        <p className="text-sm text-premium-mudo">Nenhuma meta da empresa visível para o seu papel.</p>
      </section>
    )
  }

  const dados = progresso[aba]
  const cor = CORES[aba]
  const ticket = ticketMedio(dados.realizado, dados.quantidade)

  return (
    <section className="flex min-h-[460px] flex-col items-center gap-4 rounded-2xl border border-premium-borda bg-premium-card p-5">
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-premium-texto">
          <IconeAlvo className="size-4 text-premium-acento" />
          Meta de faturamento
        </h2>
        <span className="shrink-0 rounded-full border border-premium-borda bg-premium-bg/60 px-2.5 py-1 text-xs font-medium text-premium-secundario">
          {rotuloMes(mes)}
        </span>
      </div>

      <div role="tablist" aria-label="TCV ou MRR" className="inline-flex rounded-md border border-premium-borda bg-premium-bg/60 p-0.5">
        {(['tcv', 'mrr'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={aba === t}
            onClick={() => setAba(t)}
            className={`rounded px-4 py-1.5 text-xs font-medium uppercase transition ${
              aba === t ? 'bg-premium-acento text-premium-acento-texto' : 'text-premium-mudo hover:bg-premium-borda/60 hover:text-premium-texto'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <AneDeProgresso percentual={dados.percentual} realizado={dados.realizado} cor={cor} aba={aba} />

      <div className="w-full space-y-3">
        <dl className="grid grid-cols-2 gap-x-3 text-sm">
          <div>
            <dt className="text-xs text-premium-mudo">Meta mensal</dt>
            <dd className="text-base font-semibold tabular-nums text-premium-texto">
              {dados.valorMeta === null ? <span className="text-premium-mudo">Não definida</span> : formatarMoeda(dados.valorMeta)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-premium-mudo">Realizado no mês</dt>
            <dd className={`text-base font-semibold tabular-nums ${cor.texto}`}>{formatarMoeda(dados.realizado)}</dd>
          </div>
        </dl>
        <dl className="grid grid-cols-2 gap-x-3 border-t border-premium-borda pt-3 text-sm">
          <div>
            <dt className="text-xs text-premium-mudo">Ticket médio</dt>
            <dd className="text-base font-semibold tabular-nums text-premium-texto">
              {ticket === null ? <span className="text-premium-mudo">—</span> : formatarMoeda(ticket)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-premium-mudo">Quantidade</dt>
            <dd className="text-base font-semibold tabular-nums text-premium-texto">{dados.quantidade}</dd>
          </div>
        </dl>
      </div>
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
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
        <span className="text-2xl font-bold tabular-nums text-premium-texto" title={formatarMoeda(realizado)}>
          {formatarMoedaCompacta(realizado)}
        </span>
        <span className={`text-xl font-bold tabular-nums ${cor.texto}`}>
          {percentual === null ? '—' : formatarPercentual(percentual)}
        </span>
        <span className="text-xs text-premium-mudo">da meta mensal</span>
      </div>
    </div>
  )
}
