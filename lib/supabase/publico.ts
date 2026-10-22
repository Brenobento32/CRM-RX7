import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { publicEnv } from '@/lib/env/public'
import type { Database } from '@/lib/types/database'

/**
 * Cliente Supabase PÚBLICO para as páginas abertas (Formulário AVANTE em `/f/<id>`).
 *
 * Sem cookies, sem sessão e sem cabeçalho de empresa: a chamada sempre chega
 * ao banco como visitante anônimo (chave pública + RLS), mesmo que quem
 * preenche o formulário esteja logado no CRM. Assim o envio de um visitante e
 * o de um usuário logado seguem exatamente o mesmo caminho — a empresa, o
 * funil e a etapa vêm da fonte no banco, nunca da sessão.
 *
 * Crie um por chamada; ele não guarda estado de usuário.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
