import type { Kpis } from '@/lib/dal/dashboard'
import {
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
} from '@/lib/utils/formatacao'

/** Stat tiles. Os números vêm prontos do DAL; aqui só formatação. */
export function CardsKpi({ kpis }: { kpis: Kpis }) {
  const encerradas = kpis.ganhos + kpis.perdidos

  const cards: { rotulo: string; valor: string; titulo?: string; detalhe: string }[] = [
    {
      rotulo: 'Valor em pipeline',
      valor: formatarMoedaCompacta(kpis.pipelineValor),
      titulo: formatarMoeda(kpis.pipelineValor),
      detalhe: 'Estimado das negociações abertas',
    },
    {
      rotulo: 'Vendido no período',
      valor: formatarMoedaCompacta(kpis.vendidoValor),
      titulo: formatarMoeda(kpis.vendidoValor),
      detalhe: `${kpis.ganhos} ${kpis.ganhos === 1 ? 'negócio fechado' : 'negócios fechados'}`,
    },
    {
      rotulo: 'Negociações abertas',
      valor: String(kpis.abertas),
      detalhe: 'Da reunião agendada à negociação',
    },
    {
      rotulo: 'Reuniões próximas',
      valor: String(kpis.reunioesProximas),
      detalhe: 'Reuniões e apresentações nos próximos 7 dias',
    },
    {
      rotulo: 'Taxa de conversão',
      valor: kpis.conversao === null ? '—' : formatarPercentual(kpis.conversao),
      detalhe:
        encerradas === 0
          ? 'Nenhuma negociação encerrada no período'
          : `${kpis.ganhos} de ${encerradas} encerradas no período`,
    },
  ]

  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <div
          key={c.rotulo}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">{c.rotulo}</dt>
          <dd className="mt-1 text-2xl font-semibold" title={c.titulo}>
            {c.valor}
          </dd>
          <dd className="mt-1 text-xs text-zinc-500">{c.detalhe}</dd>
        </div>
      ))}
    </dl>
  )
}
