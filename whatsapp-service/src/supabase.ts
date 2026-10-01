import { createClient } from '@supabase/supabase-js'

import { env } from './env.js'

/**
 * Cliente com service_role — ignora RLS de propósito. Só existe neste
 * processo, separado do Next.js (que usa sempre a chave anon). Nunca
 * importar este módulo a partir do CRM.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
