'use client'

import { createBrowserClient } from '@supabase/ssr'

import { publicEnv } from '@/lib/env/public'
import type { Database } from '@/lib/types/database'

/**
 * Cliente Supabase para o browser.
 *
 * Use apenas onde o servidor não resolve o problema: Realtime no Kanban,
 * upload direto para o Storage e o formulário de login. Toda leitura e
 * escrita de dados do CRM deve passar pela DAL (`lib/dal`) no servidor.
 *
 * `createBrowserClient` é singleton por padrão, então chamar esta função
 * várias vezes reaproveita a mesma instância e o mesmo canal de auth.
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
  )
}
