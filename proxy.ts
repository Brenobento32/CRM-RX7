import { NextResponse, type NextRequest } from 'next/server'

import {
  COOKIE_EMPRESA,
  HEADER_EMPRESA,
  HEADER_ROTA,
  caminhoDaEmpresa,
  separarPrefixo,
  slugValido,
} from '@/lib/empresa/rota'
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
// `/f/<id>`: formulário público de captação (Formulário AVANTE), sem login.
const ROTAS_LIVRES = ['/sem-acesso', '/esqueci-senha', '/auth/callback', '/f']

/** Logadas, mas fora de qualquer empresa. */
const ROTAS_SEM_EMPRESA = ['/empresas', '/redefinir-senha', '/admin']

function corresponde(pathname: string, rotas: string[]) {
  return rotas.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))
}

/**
 * Renova a sessão, resolve a empresa da URL e faz o redirect otimista:
 * - `/<slug>/x` → reescreve para `/x` com o slug num header interno
 *   (`/e/<slug>/x`, o formato antigo, redireciona para `/<slug>/x`);
 * - área interna sem prefixo → completa com a empresa da aba de origem
 *   (Referer do mesmo site) ou, numa aba nova, com a última usada;
 * - sem sessão fora das rotas públicas → /login (guardando o destino em `next`)
 * - com sessão na tela de login → área interna
 *
 * Nada aqui autoriza: a checagem definitiva fica na DAL e no banco
 * (`tenant_atual()` + RLS).
 */
export async function proxy(request: NextRequest) {
  // O header interno nunca pode vir do browser.
  const cabecalhos = new Headers(request.headers)
  cabecalhos.delete(HEADER_EMPRESA)
  cabecalhos.delete(HEADER_ROTA)

  const { pathname, search } = request.nextUrl
  const prefixo = separarPrefixo(pathname)

  // Formato antigo `/e/<slug>/x` → `/<slug>/x` (308: mantém método e corpo).
  // Nada é lido nem autorizado aqui; a próxima requisição segue o fluxo normal.
  if (prefixo?.legado) {
    return NextResponse.redirect(urlCom(request, caminhoDaEmpresa(prefixo.slug, prefixo.resto), search), 308)
  }
  if (prefixo) {
    cabecalhos.set(HEADER_EMPRESA, prefixo.slug)
    cabecalhos.set(HEADER_ROTA, `${prefixo.resto}${search}`)
  }

  const { response, claims } = await updateSession(request, cabecalhos)
  const rota = prefixo ? prefixo.resto : pathname

  if (prefixo && (corresponde(rota, ROTAS_LIVRES) || corresponde(rota, ROTAS_PUBLICAS) || corresponde(rota, ROTAS_SEM_EMPRESA))) {
    return redirecionar(urlCom(request, rota, search), response)
  }

  if (corresponde(rota, ROTAS_LIVRES)) {
    return response
  }

  const publica = corresponde(rota, ROTAS_PUBLICAS)

  if (!claims && !publica) {
    const url = urlCom(request, '/login', '')
    if (pathname !== '/') {
      url.searchParams.set('next', `${pathname}${search}`)
    }
    return redirecionar(url, response)
  }

  if (claims && publica) {
    return redirecionar(urlCom(request, '/', ''), response)
  }

  if (publica || corresponde(rota, ROTAS_SEM_EMPRESA)) {
    return response
  }

  if (prefixo) {
    const reescrita = NextResponse.rewrite(urlCom(request, rota, search), {
      request: { headers: cabecalhos },
    })
    copiarSessao(response, reescrita)
    reescrita.cookies.set(COOKIE_EMPRESA, prefixo.slug, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    })
    return reescrita
  }

  // Área interna sem prefixo (links e redirects internos): mesma empresa da aba.
  const slug = empresaDaAbaDeOrigem(request) ?? cookieEmpresa(request)
  if (slug) {
    return redirecionar(urlCom(request, caminhoDaEmpresa(slug, rota), search), response)
  }

  const escolher = urlCom(request, '/empresas', '')
  if (rota !== '/') escolher.searchParams.set('next', `${rota}${search}`)
  return redirecionar(escolher, response)
}

/** Empresa do Referer, só se for deste mesmo site. */
function empresaDaAbaDeOrigem(request: NextRequest): string | null {
  const referer = request.headers.get('referer')
  if (!referer) return null
  try {
    const origem = new URL(referer)
    if (origem.origin !== request.nextUrl.origin) return null
    return separarPrefixo(origem.pathname)?.slug ?? null
  } catch {
    return null
  }
}

function cookieEmpresa(request: NextRequest): string | null {
  const valor = request.cookies.get(COOKIE_EMPRESA)?.value
  return slugValido(valor) ? valor : null
}

function urlCom(request: NextRequest, pathname: string, search: string) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = search
  return url
}

/**
 * Redireciona preservando os cookies que `updateSession` possa ter renovado —
 * sem isso, um refresh de token feito neste request seria descartado.
 */
function redirecionar(url: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(url)
  copiarSessao(response, redirect)
  return redirect
}

function copiarSessao(de: NextResponse, para: NextResponse) {
  for (const cookie of de.cookies.getAll()) {
    para.cookies.set(cookie)
  }
  // Anti-cache que `updateSession` põe quando renova a sessão.
  for (const nome of ['cache-control', 'expires', 'pragma']) {
    const valor = de.headers.get(nome)
    if (valor) para.headers.set(nome, valor)
  }
}

export const config = {
  matcher: [
    // Tudo, exceto assets estáticos e arquivos de imagem.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
