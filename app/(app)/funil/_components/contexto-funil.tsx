import type { RealizadoFunil } from '@/lib/dal/funil-metricas'
import { ticketMedio } from '@/lib/utils/financeiro-periodo'
import { formatarMoeda } from '@/lib/utils/formatacao'

/**
 * "Contexto do funil selecionado" — vendido e ticket médio só DESTE funil,
 * no período de ANÁLISE selecionado (7/15/30/90/hoje/este mês/personalizado
 * — ver `SeletorPeriodoFunil`). Isto é análise de período, não meta: nunca
 * mistura com `MetaMensal` (mês calendário fixo, sempre o atual, nunca
 * proporcional) — são duas perguntas diferentes na mesma página, cada uma
 * com seu próprio bloco visual.
 */
export function ContextoFunilSelecionado({
  realizadoFunil,
  funilNome,
}: {
  realizadoFunil: RealizadoFunil
  funilNome: string
}) {
  const linhas = [
    { chave: 'tcv' as const, titulo: 'TCV', realizado: realizadoFunil.tcv, qtd: realizadoFunil.tcvQtd },
    { chave: 'mrr' as const, titulo: 'MRR', realizado: realizadoFunil.mrr, qtd: realizadoFunil.mrrQtd },
  ]

  return (
    <section className="space-y-2 rounded-lg border border-dashed border-premium-borda p-4">
      <div>
        <h2 className="text-sm font-semibold text-premium-secundario">Contexto do funil selecionado</h2>
        <p className="text-xs text-premium-mudo">
          Funil: <span className="font-medium text-premium-secundario">{funilNome}</span>. No período de análise
          selecionado abaixo — nunca entra no cálculo da meta mensal.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {linhas.map((l) => (
          <CardContextoFunil
            key={l.chave}
            titulo={l.titulo}
            realizadoFunil={l.realizado}
            ticketMedioFunil={ticketMedio(l.realizado, l.qtd)}
          />
        ))}
      </div>
    </section>
  )
}

function CardContextoFunil({
  titulo,
  realizadoFunil,
  ticketMedioFunil,
}: {
  titulo: string
  realizadoFunil: number
  ticketMedioFunil: number | null
}) {
  return (
    <div className="rounded-lg border border-premium-borda bg-premium-card p-4 text-premium-texto">
      <p className="font-semibold">{titulo}</p>
      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-premium-mudo">Vendido neste funil</dt>
        <dd className="text-right tabular-nums">{formatarMoeda(realizadoFunil)}</dd>
        <dt className="text-premium-mudo">Ticket médio deste funil</dt>
        <dd className="text-right tabular-nums">
          {ticketMedioFunil === null ? <span className="text-premium-mudo">—</span> : formatarMoeda(ticketMedioFunil)}
        </dd>
      </dl>
    </div>
  )
}
