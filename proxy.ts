import { NextResponse, type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

/** Rotas acessíveis sem sessão — redirecionam para a área interna se já houver uma. */
const ROTAS_PUBLICAS = ['/login']

/**
 * Rotas que qualquer um pode ver, logado ou não — nunca redirecionam nos dois
 * sentidos. `/esqueci-senha`: quem já está logado também pode querer
 * redefinir a senha. `/auth/callback`: troca o código do e-mail de
 * recuperação por uma sessão (`app/auth/callback/route.ts`) — precisa
 * executar tanto para quem não tem sessão nenhuma (o caso normal) quanto
 * para quem já está logado em outra aba (senão a regra de "claims && pública
 * -> redireciona pra área interna" impediria a troca do código antes mesmo
 * de o Route Handler rodar).
 */
const ROTAS_LIVRES = ['/sem-acesso', '/esqueci-senha', '/auth/callback']

function corresponde(pathname: string, rotas: string[]) {
  return rotas.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))
}

/**
 * Renova a sessão e faz o redirect otimista:
 * - sem sessão fora das rotas públicas → /login (guardando o destino em `next`)
 * - com sessão na tela de login → área interna
 *
 * A checagem definitiva fica na DAL (`verifySession`) e na RLS.
 */
export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request)
  const { pathname, search } = request.nextUrl

  if (corresponde(pathname, ROTAS_LIVRES)) {
    return response
  }

  const publica = corresponde(pathname, ROTAS_PUBLICAS)

  if (!claims && !publica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (pathname !== '/') {
      url.searchParams.set('next', `${pathname}${search}`)
    }
    return redirecionar(url, response)
  }

  if (claims && publica) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return redirecionar(url, response)
  }

  return response
}

/**
 * Redireciona preservando os cookies que `updateSession` possa ter renovado —
 * sem isso, um refresh de token feito neste request seria descartado.
 */
function redirecionar(url: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(url)
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie)
  }
  return redirect
}

export const config = {
  matcher: [
    // Tudo, exceto assets estáticos e arquivos de imagem.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
