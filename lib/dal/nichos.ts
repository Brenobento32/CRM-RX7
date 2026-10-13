import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

type Enums = Database['public']['Enums']

export type Nicho = { id: string; nome: string; cor: Enums['cor_etapa'] }

/**
 * Nichos ativos para o seletor da ficha (item 3 do refinamento) — nunca
 * texto livre: o usuário só escolhe entre o que está cadastrado no banco.
 * "Outros" não é uma linha aqui: é a ausência de `nicho_id` (null), montada
 * pela própria UI do seletor.
 */
export async function listarNichosAtivos(): Promise<Nicho[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('nichos')
    .select('id, nome, cor')
    .eq('ativo', true)
    .order('ordem')
    .order('created_at')

  if (error) throw new Error('Não foi possível carregar os nichos.', { cause: error })
  return data
}
