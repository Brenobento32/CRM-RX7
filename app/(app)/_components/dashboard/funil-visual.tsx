import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { EtapaResumo } from '@/lib/dal/dashboard'

/**
 * Quantidade por etapa. Barras num único tom (magnitude); a cor da etapa
 * aparece só no marcador ao lado do nome, a mesma identidade do Kanban.
 * O número fica ao lado da barra — nunca dentro, para não ser cortado.
 */
export function FunilVisual({ etapas }: { etapas: EtapaResumo[] }) {
  const maior = Math.max(1, ...etapas.map((e) => e.quantidade))

  return (
    <ol className="space-y-3">
      {etapas.map((e) => (
        <li key={e.etapaId} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="flex items-center gap-2 truncate">
            <PontoEtapa cor={e.cor} />
            <span className="truncate" title={e.nome}>{e.nome}</span>
          </span>
          <span className="h-3 rounded-r bg-chart-trilha/60" aria-hidden>
            <span
              className="block h-full rounded-r bg-chart-serie"
              style={{ width: `${(e.quantidade / maior) * 100}%` }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{e.quantidade}</span>
        </li>
      ))}
    </ol>
  )
}
