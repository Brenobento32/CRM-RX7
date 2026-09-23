import { NextResponse, type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

/** Rotas acessíveis sem sessão. */
const ROTAS_PUBLICAS = ['/login']

/** Rotas que qualquer um pode ver, logado ou não. */
const ROTAS_LIVRES = ['/sem-acesso']

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
