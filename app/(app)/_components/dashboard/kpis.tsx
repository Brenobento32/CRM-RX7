import { Indicador } from '@/components/ui/indicador'
import type { Kpis } from '@/lib/dal/dashboard'
import { formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '@/lib/utils/formatacao'

const icone = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
    <path d={d} />
  </svg>
)

/**
 * Indicadores do período. "Vendido" é o destaque (o resultado); os demais
 * dão contexto. Cada cartão leva à tela onde o número é trabalhado.
 */
export function CardsKpi({ kpis }: { kpis: Kpis }) {
  const encerradas = kpis.ganhos + kpis.perdidos

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Indicador
        destaque
        rotulo="Vendido no período"
        valor={<span title={formatarMoeda(kpis.vendidoValor)}>{formatarMoedaCompacta(kpis.vendidoValor)}</span>}
        detalhe={`${kpis.ganhos} ${kpis.ganhos === 1 ? 'negócio fechado' : 'negócios fechados'}`}
        icone={icone('M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6')}
      />
      <Indicador
        rotulo="Valor em pipeline"
        valor={<span title={formatarMoeda(kpis.pipelineValor)}>{formatarMoedaCompacta(kpis.pipelineValor)}</span>}
        detalhe="Estimado das negociações abertas"
        icone={icone('M3 5h18l-7 8v5l-4 2v-7z')}
        href="/funil"
      />
      <Indicador
        rotulo="Negociações abertas"
        valor={kpis.abertas}
        detalhe="Da reunião agendada à negociação"
        icone={icone('M4 6h16M4 12h16M4 18h10')}
        href="/funil"
      />
      <Indicador
        rotulo="Reuniões próximas"
        valor={kpis.reunioesProximas}
        detalhe="Nos próximos 7 dias"
        icone={icone('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z')}
        href="/agenda"
      />
      <Indicador
        rotulo="Taxa de conversão"
        valor={kpis.conversao === null ? '—' : formatarPercentual(kpis.conversao)}
        detalhe={encerradas === 0 ? 'Nenhuma negociação encerrada no período' : `${kpis.ganhos} de ${encerradas} encerradas`}
        icone={icone('M3 17l6-6 4 4 8-8M15 7h6v6')}
      />
    </div>
  )
}
