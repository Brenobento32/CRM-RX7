import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Nome de exibição dos usuários, via `public.nomes_de_usuarios`: a RLS de
 * profiles não deixa um closer ler o perfil de outra pessoa, mas timeline e
 * agenda precisam mostrar quem registrou ou é dono do compromisso.
 *
 * Quem chama já passou por `getUsuarioAtual()`.
 */
export async function nomesDeUsuarios(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('nomes_de_usuarios', { p_ids: unicos })

  if (error) {
    throw new Error('Não foi possível carregar os usuários.', { cause: error })
  }
  return new Map(data.map((u) => [u.id, u.nome]))
}
