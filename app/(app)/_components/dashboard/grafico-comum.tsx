import { theadClass, tbodyClass } from '@/components/ui/estilos'

/** Peças compartilhadas pelos gráficos do dashboard. */

export function CaixaTooltip({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-premium-borda bg-premium-card px-3 py-2 text-sm shadow-md">
      <p className="mb-0.5 text-xs text-premium-mudo">{titulo}</p>
      {children}
    </div>
  )
}

/**
 * Os mesmos números do gráfico em tabela: para leitor de tela, para quem
 * não distingue a barra e para copiar um valor exato.
 */
export function TabelaDados({ colunas, linhas }: { colunas: string[]; linhas: string[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs text-premium-mudo hover:text-premium-texto">
        Ver dados em tabela
      </summary>
      <table className="mt-2 w-full text-left">
        <thead className={theadClass}>
          <tr>
            {colunas.map((c, i) => (
              <th key={c} className={`py-1 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tbodyClass}>
          {linhas.map((linha) => (
            <tr key={linha[0]}>
              {linha.map((valor, i) => (
                <td key={i} className={`py-1 ${i > 0 ? 'text-right tabular-nums' : ''}`}>
                  {valor}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
