import { redirect } from 'next/navigation'

/**
 * Compatibilidade: a listagem de arquivados virou a aba "Arquivados" de
 * `/funil/leads` (item 2 do refinamento — uma tela só pra Ativos/Arquivados,
 * nunca duas fazendo a mesma coisa). Links/favoritos antigos continuam
 * funcionando via este redirect.
 */
export default function FunilArquivadosRedirect() {
  redirect('/funil/leads?aba=arquivados')
}
