import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { EntradaHistorico } from '@/lib/utils/historico'
import { formatarDuracaoHistorico } from '@/lib/utils/historico'
import { formatarDataHora } from '@/lib/utils/formatacao'

/**
 * Cronologia de todas as movimentações da negociação: etapa, data/hora de
 * entrada e saída, duração (até agora, na etapa atual) e quem moveu.
 * `entradas` já vem calculada (server component) — este componente só exibe.
 */
export function HistoricoFunil({ entradas }: { entradas: EntradaHistorico[] }) {
  if (entradas.length === 0) {
    return <p className="text-sm text-zinc-500">Sem movimentações registradas.</p>
  }

  return (
    <ol className="space-y-3">
      {entradas.map((e) => (
        <li key={e.id} className="flex items-start gap-3 text-sm">
          <PontoEtapa cor={e.etapaCor} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{e.etapaNome}</p>
            <p className="text-zinc-600 dark:text-zinc-400">
              {formatarDataHora(e.entrada)} → {e.saida ? formatarDataHora(e.saida) : 'agora'}
            </p>
            <p className="text-xs text-zinc-500">
              {formatarDuracaoHistorico(e.duracaoMs)}
              {e.usuarioNome && <> · {e.usuarioNome}</>}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
