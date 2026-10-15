/**
 * Resumo de origem pra lista de Clientes. Origem pertence à NEGOCIAÇÃO
 * (`negociacoes.origem`), nunca ao cliente — esta função só resume o que já
 * existe (um cliente pode ter negociações de origens diferentes), nunca
 * decide nem sobrescreve a origem de nenhuma negociação individual.
 */
export function resumoOrigensCliente<T extends string>(
  origens: T[],
  rotulos: Record<T, string>,
): string {
  const distintas = [...new Set(origens)]

  if (distintas.length === 0) return '—'
  if (distintas.length > 1) return 'Múltiplas origens'
  return rotulos[distintas[0]]
}
