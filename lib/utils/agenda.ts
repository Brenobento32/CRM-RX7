/**
 * Regras da agenda compartilhadas entre servidor e formulário.
 */

type Pessoa = { id: string; role: 'gerente' | 'closer' }

/**
 * Quem pode ser responsável por um evento do cliente: o dono da carteira e
 * os gerentes. O banco confere a mesma regra (`agenda_valida_responsavel`).
 */
export function responsaveisElegiveis<T extends Pessoa>(responsaveis: T[], ownerId: string | undefined): T[] {
  return responsaveis.filter((r) => r.role === 'gerente' || r.id === ownerId)
}

/** Duração que o formulário mostra para um evento existente (minutos). */
export function duracaoDoFormulario(minutos: number): '15' | '30' | '60' | 'personalizado' {
  return minutos === 15 ? '15' : minutos === 30 ? '30' : minutos === 60 ? '60' : 'personalizado'
}
