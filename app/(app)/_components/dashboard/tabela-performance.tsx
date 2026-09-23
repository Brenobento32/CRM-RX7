import type { PerformanceUsuario } from '@/lib/dal/dashboard'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/** Visão do gerente: uma linha por closer, ordenada pelo valor vendido. */
export function TabelaPerformance({ pessoas }: { pessoas: PerformanceUsuario[] }) {
  if (pessoas.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhum closer ativo.</p>
  }

  const colunasNumericas = [
    'Pipeline',
    'Abertas',
    'Vendido',
    'Ganhos',
    'Perdidos',
    'Conversão',
    'Reuniões feitas',
    'Próx. reuniões',
    'Atividades',
  ]

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Closer</th>
            {colunasNumericas.map((c) => (
              <th key={c} className="px-4 py-3 text-right font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
          {pessoas.map((p) => (
            <tr key={p.usuarioId}>
              <td className="px-4 py-3 whitespace-nowrap">
                {p.nome}
                {p.role === 'gerente' && <span className="ml-1 text-xs text-zinc-500">(gerente)</span>}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">{formatarMoeda(p.pipelineValor)}</td>
              <td className="px-4 py-3 text-right">{p.abertas}</td>
              <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                {formatarMoeda(p.vendidoValor)}
              </td>
              <td className="px-4 py-3 text-right">{p.ganhos}</td>
              <td className="px-4 py-3 text-right">{p.perdidos}</td>
              <td className="px-4 py-3 text-right">
                {p.conversao === null ? '—' : formatarPercentual(p.conversao)}
              </td>
              <td className="px-4 py-3 text-right">{p.reunioesRealizadas}</td>
              <td className="px-4 py-3 text-right">{p.reunioesProximas}</td>
              <td className="px-4 py-3 text-right">{p.atividades}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
