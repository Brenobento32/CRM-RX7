import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'

import { HEADER_EMPRESA, HEADER_TENANT_BANCO, slugValido } from '@/lib/empresa/rota'
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
 * Empresa: o slug da URL (`/<slug>`, repassado pelo `proxy.ts`) vai em
 * `x-rx7-tenant` em toda chamada. O banco só aceita se o usuário tiver vínculo
 * ativo nela (`tenant_atual()`); sem empresa, nenhum dado comercial aparece.
 *
 * No Next.js 16 `cookies()` e `headers()` são assíncronos, por isso esta
 * função é `async`.
 */
export async function createClient() {
  const [cookieStore, cabecalhos] = await Promise.all([cookies(), headers()])
  const empresa = cabecalhos.get(HEADER_EMPRESA)

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      global: {
        headers: slugValido(empresa) ? { [HEADER_TENANT_BANCO]: empresa } : {},
      },
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
