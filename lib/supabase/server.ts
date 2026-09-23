import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { publicEnv } from '@/lib/env/public'
import type { Database } from '@/lib/types/database'

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * Sempre crie um cliente novo por request — nunca guarde o retorno em uma
 * variável de módulo. O cliente carrega os cookies de sessão daquele request
 * específico; compartilhá-lo entre requests serviria a sessão de um usuário
 * para outro.
 *
 * A chave usada é a `anon`, e não a `service_role`: é o JWT do usuário que
 * viaja na requisição, então o Postgres aplica as policies de RLS. É isso que
 * garante que um closer só enxergue a própria carteira mesmo que alguma query
 * esqueça o filtro por `owner_id`.
 *
 * No Next.js 16 `cookies()` é assíncrono, por isso esta função é `async`.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Server Components não podem escrever cookies. O refresh do token
            // é feito no `proxy.ts`, então ignorar aqui é seguro.
          }
        },
      },
    },
  )
}
