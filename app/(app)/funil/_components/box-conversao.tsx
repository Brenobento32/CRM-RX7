import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { Etapa } from '@/lib/dal/etapas'
import type { ConversaoEtapa } from '@/lib/dal/funil-conversao'

function formatarPercentual(taxa: number | null): string {
  return taxa === null ? '—' : `${Math.round(taxa * 100)}%`
}

/** Cartões de conversão do pipeline, acima do Kanban. Some se não há etapas de pipeline. */
export function BoxConversao({ etapas, conversao }: { etapas: Etapa[]; conversao: ConversaoEtapa[] }) {
  if (conversao.length === 0) return null

  const porId = new Map(etapas.map((e) => [e.id, e]))

  return (
    <section
      aria-label="Conversão do funil"
      className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      {conversao.map((c) => {
        const etapa = porId.get(c.etapaId)
        if (!etapa) return null

        return (
          <div
            key={c.etapaId}
            className="min-w-40 flex-1 space-y-1.5 border-l-2 border-zinc-100 pl-3 text-sm first:border-l-0 first:pl-0 dark:border-zinc-800"
          >
            <p className="flex min-w-0 items-center gap-2 font-medium">
              <PontoEtapa cor={etapa.cor} />
              <span className="truncate" title={etapa.nome}>
                {etapa.nome}
              </span>
            </p>
            <p className="text-xs text-zinc-500">{c.entradas} entradas</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Próxima etapa:{' '}
              <span className="font-medium tabular-nums">{formatarPercentual(c.taxaProximaEtapa)}</span>
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Até Fechado: <span className="font-medium tabular-nums">{formatarPercentual(c.taxaFechado)}</span>
            </p>
          </div>
        )
      })}
    </section>
  )
}
