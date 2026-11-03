import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import { normalizarRegraEtapa, type RegrasEtapas } from '@/lib/utils/regras-etapas'

/**
 * Exigências das etapas da empresa da requisição (tabela `etapa_regras`; a
 * RLS mostra só as da própria empresa). Uma consulta por requisição.
 * Sem a migration 20261109090200 no banco (ou em erro), nenhuma exigência:
 * o site funciona como antes, e a trava, quando existir, é do banco.
 */
export const obterRegrasEtapas = cache(async (): Promise<RegrasEtapas> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from('etapa_regras').select('etapa_id, campos, checklist')
  if (error || !data) return {}
  return Object.fromEntries(data.map((r) => [r.etapa_id, normalizarRegraEtapa(r.campos, r.checklist)]))
})

/** Itens do checklist da etapa que esta negociação já confirmou (de uma entrada anterior). */
export async function itensJaConfirmados(negociacaoId: string, etapaId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('negociacao_confirmacoes_etapa')
    .select('item_id')
    .eq('negociacao_id', negociacaoId)
    .eq('etapa_id', etapaId)
  if (error || !data) return []
  return data.map((r) => r.item_id)
}
