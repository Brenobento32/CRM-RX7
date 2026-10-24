import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regressão do erro de "primeira visita depois de inatividade": quando o
 * access token vence, o `proxy` renova a sessão (setAll do @supabase/ssr) e as
 * páginas precisam receber, NA MESMA requisição, os cookies renovados — e não
 * a cópia dos cabeçalhos feita antes do refresh, com o token velho.
 *
 * O Supabase é simulado: `getClaims()` dispara um refresh (como faz com um
 * token vencido) e devolve claims válidas. Next real (NextRequest/NextResponse):
 * o que segue para as páginas aparece em `x-middleware-request-<header>`.
 */

const COOKIE_SESSAO = 'sb-ybgzlxgeoiggmfdxarqx-auth-token'
const ANTI_CACHE = { 'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0', expires: '0', pragma: 'no-cache' }

let renovar = true

vi.mock('@/lib/env/public', () => ({
  publicEnv: { supabaseUrl: 'https://exemplo.supabase.co', supabaseAnonKey: 'chave-publica-de-teste' },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opcoes: {
    cookies: {
      getAll: () => { name: string; value: string }[]
      setAll: (c: { name: string; value: string; options: Record<string, unknown> }[], h: Record<string, string>) => void
    }
  }) => ({
    auth: {
      async getClaims() {
        if (renovar) {
          opcoes.cookies.setAll(
            [{ name: COOKIE_SESSAO, value: 'TOKEN-NOVO', options: { path: '/', sameSite: 'lax', httpOnly: false } }],
            ANTI_CACHE,
          )
        }
        const atual = opcoes.cookies.getAll().find((c) => c.name === COOKIE_SESSAO)?.value
        return { data: atual ? { claims: { sub: 'usuario-de-teste' } } : null }
      },
    },
  }),
}))

const { proxy } = await import('@/proxy')

function pedido(caminho: string, cabecalhos: Record<string, string> = {}) {
  return new NextRequest(`https://avante.exemplo.test${caminho}`, {
    headers: { cookie: `${COOKIE_SESSAO}=TOKEN-VELHO; rx7_empresa=teste-avante-b`, ...cabecalhos },
  })
}

/** Cookie que as páginas (Server Components) vão ler nesta requisição. */
function cookieRepassado(resposta: Response) {
  return resposta.headers.get('x-middleware-request-cookie') ?? ''
}

describe('proxy: sessão renovada chega às páginas na mesma requisição', () => {
  beforeEach(() => {
    renovar = true
  })

  it('rota sem empresa (/empresas) repassa o token NOVO, não o vencido', async () => {
    const resposta = await proxy(pedido('/empresas'))
    expect(cookieRepassado(resposta)).toContain(`${COOKIE_SESSAO}=TOKEN-NOVO`)
    expect(cookieRepassado(resposta)).not.toContain('TOKEN-VELHO')
    // Outros cookies do pedido continuam lá.
    expect(cookieRepassado(resposta)).toContain('rx7_empresa=teste-avante-b')
  })

  it('rota de empresa (/e/<slug>/...) reescrita repassa o token NOVO e o slug da URL', async () => {
    const resposta = await proxy(pedido('/e/teste-avante-b/clientes'))
    expect(resposta.headers.get('x-middleware-rewrite')).toContain('/clientes')
    expect(cookieRepassado(resposta)).toContain(`${COOKIE_SESSAO}=TOKEN-NOVO`)
    expect(cookieRepassado(resposta)).not.toContain('TOKEN-VELHO')
    expect(resposta.headers.get('x-middleware-request-x-rx7-empresa')).toBe('teste-avante-b')
  })

  it('o navegador recebe o cookie renovado e a resposta não pode ir para cache compartilhado', async () => {
    for (const caminho of ['/empresas', '/e/teste-avante-b/clientes']) {
      const resposta = await proxy(pedido(caminho))
      expect(resposta.headers.get('set-cookie') ?? '').toContain(`${COOKIE_SESSAO}=TOKEN-NOVO`)
      expect(resposta.headers.get('cache-control')).toBe(ANTI_CACHE['cache-control'])
    }
  })

  it('header interno de empresa vindo do navegador nunca é repassado', async () => {
    const resposta = await proxy(pedido('/empresas', { 'x-rx7-empresa': 'teste-avante-a' }))
    expect(resposta.headers.get('x-middleware-request-x-rx7-empresa')).toBeNull()
  })

  it('sem renovação, o cookie original segue igual (nada muda para quem tem token válido)', async () => {
    renovar = false
    const resposta = await proxy(pedido('/empresas'))
    const repassado = cookieRepassado(resposta)
    // Sem refresh o Next pode nem reescrever o cookie; se reescrever, é o mesmo.
    if (repassado) expect(repassado).toContain(`${COOKIE_SESSAO}=TOKEN-VELHO`)
    expect(resposta.headers.get('set-cookie')).toBeNull()
  })
})
