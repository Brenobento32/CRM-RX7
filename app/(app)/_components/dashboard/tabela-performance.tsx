import { EstadoVazio } from '@/components/ui/estado-vazio'
import { linhaClass, tabelaClass, theadClass, thClass } from '@/components/ui/estilos'
import type { PerformanceUsuario } from '@/lib/dal/dashboard'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/** Visão do gerente: uma linha por closer, ordenada pelo valor vendido. */
export function TabelaPerformance({ pessoas }: { pessoas: PerformanceUsuario[] }) {
  if (pessoas.length === 0) {
    return <EstadoVazio compacto titulo="Nenhuma pessoa com vendas ativa" descricao="Cadastre closers ou vendedores em Configurações → Usuários." />
  }

  const colunasNumericas = [
    'Pipeline',
    'Abertas',
    'Vendido',
    'Ganhos',
    'Perdidos',
    'Em recuperação',
    'Conversão',
    'Reuniões feitas',
    'Próx. reuniões',
    'Atividades',
  ]

  return (
    <div className="overflow-x-auto">
      <table className={tabelaClass}>
        <thead className={theadClass}>
          <tr>
            <th className={`${thClass} text-left`}>Pessoa</th>
            {colunasNumericas.map((c) => (
              <th key={c} className={`${thClass} text-right`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {pessoas.map((p) => (
            <tr key={p.usuarioId} className={linhaClass}>
              <td className="px-4 py-3 font-medium whitespace-nowrap text-premium-texto">
                {p.nome}
                {p.role === 'gerente' && <span className="ml-1 text-xs text-premium-mudo">(gerente)</span>}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">{formatarMoeda(p.pipelineValor)}</td>
              <td className="px-4 py-3 text-right">{p.abertas}</td>
              <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                {formatarMoeda(p.vendidoValor)}
              </td>
              <td className="px-4 py-3 text-right">{p.ganhos}</td>
              <td className="px-4 py-3 text-right">{p.perdidos}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {p.emRecuperacaoQtd > 0 ? (
                  <>
                    {p.emRecuperacaoQtd}{' '}
                    <span className="text-xs text-premium-mudo">({formatarMoeda(p.emRecuperacaoValor)})</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
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
