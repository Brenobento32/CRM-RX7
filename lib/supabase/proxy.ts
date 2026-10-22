import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { publicEnv } from '@/lib/env/public'
import type { Database } from '@/lib/types/database'

/**
 * Renova a sessão do Supabase no `proxy.ts` da raiz.
 *
 * O access token do Supabase expira em cerca de uma hora. Server Components
 * não conseguem escrever cookies, então sem este passo o refresh nunca seria
 * gravado e o usuário cairia para a tela de login no meio do expediente.
 *
 * Duas regras que não devem ser afrouxadas aqui:
 *
 * 1. Nada de consulta ao banco. O proxy roda em toda navegação, inclusive nos
 *    prefetches do `<Link>`. Autorização de verdade fica na DAL e na RLS.
 * 2. As `claims` devolvidas servem só para checagem otimista (redirecionar
 *    quem não está logado). Elas vêm de um JWT validado, mas o papel de
 *    gerente/closer deve ser relido do banco antes de qualquer escrita.
 *
 * `cabecalhos`: os headers que seguem para o app (o `proxy.ts` remove o
 * header interno de empresa vindo do browser e põe o da URL).
 */
export async function updateSession(request: NextRequest, cabecalhos: Headers = request.headers) {
  let response = NextResponse.next({
    request: { headers: cabecalhos },
  })

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }

          response = NextResponse.next({
            request: { headers: cabecalhos },
          })

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }

          // Impede que um CDN ou proxy reverso guarde em cache uma resposta
          // que carrega `Set-Cookie` de sessão — sem isso, o token de um
          // usuário pode ser entregue a outro.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value)
          }
        },
      },
    },
  )

  // Precisa ser aguardado antes de a resposta ser finalizada, senão um refresh
  // concluído tarde demais é perdido e o request seguinte refaz tudo.
  const { data } = await supabase.auth.getClaims()

  return { response, claims: data?.claims ?? null }
}
