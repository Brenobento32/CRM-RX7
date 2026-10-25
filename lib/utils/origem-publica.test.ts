import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destinoPublico } from './origem-publica'

/**
 * Regressão do link de recuperação de senha que terminava em
 * `https://0.0.0.0:3000/redefinir-senha`: na Hostinger o Node recebe a
 * requisição internamente, e o redirect do `/auth/callback` usava essa origem.
 */

const PUBLICO = 'https://avante.riox7comunicacao.com.br'
const INTERNO = 'https://0.0.0.0:3000/auth/callback?code=CODIGO-FICTICIO&next=%2Fredefinir-senha'

describe('destinoPublico', () => {
  it('usa o domínio público configurado', () => {
    expect(destinoPublico('/redefinir-senha', PUBLICO, true)).toBe(`${PUBLICO}/redefinir-senha`)
    expect(destinoPublico('/redefinir-senha', `${PUBLICO}/qualquer/coisa/`, true)).toBe(`${PUBLICO}/redefinir-senha`)
  })

  it('mantém a query do caminho', () => {
    expect(destinoPublico('/esqueci-senha?erro=x', PUBLICO, true)).toBe(`${PUBLICO}/esqueci-senha?erro=x`)
  })

  it('em produção, host local ou interno nunca vira destino (fica relativo)', () => {
    for (const ruim of ['http://localhost:3000', 'https://0.0.0.0:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(destinoPublico('/redefinir-senha', ruim, true)).toBe('/redefinir-senha')
    }
  })

  it('variável ausente ou inválida fica relativa (o navegador resolve no próprio domínio)', () => {
    for (const ruim of [undefined, '', 'avante.riox7comunicacao.com.br', 'javascript:alert(1)', 'ftp://exemplo.test']) {
      expect(destinoPublico('/redefinir-senha', ruim, true)).toBe('/redefinir-senha')
    }
  })

  it('em desenvolvimento, localhost configurado é aceito', () => {
    expect(destinoPublico('/redefinir-senha', 'http://localhost:3000', false)).toBe('http://localhost:3000/redefinir-senha')
  })

  it('caminho que não é interno vira "/" (defesa extra contra redirect externo)', () => {
    expect(destinoPublico('//site-falso.example', PUBLICO, true)).toBe(`${PUBLICO}/`)
    expect(destinoPublico('https://site-falso.example', PUBLICO, true)).toBe(`${PUBLICO}/`)
    expect(destinoPublico('//site-falso.example', undefined, true)).toBe('/')
  })
})

// --- Route Handler real do /auth/callback -----------------------------------

const troca = vi.fn<(code: string) => Promise<{ error: null | { message: string } }>>()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: troca } }),
}))

async function chamar(url: string) {
  const { GET } = await import('@/app/auth/callback/route')
  return GET(new Request(url))
}

describe('/auth/callback na Hostinger (requisição interna em 0.0.0.0:3000)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', PUBLICO)
    vi.stubEnv('NODE_ENV', 'production')
    troca.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('código válido: redireciona para /redefinir-senha no domínio público', async () => {
    troca.mockResolvedValue({ error: null })
    const resposta = await chamar(INTERNO)
    expect(troca).toHaveBeenCalledTimes(1)
    expect(resposta.status).toBe(307)
    expect(resposta.headers.get('location')).toBe(`${PUBLICO}/redefinir-senha`)
  })

  it('código inválido: volta para /esqueci-senha no domínio público, com aviso', async () => {
    troca.mockResolvedValue({ error: { message: 'invalid' } })
    const destino = new URL((await chamar(INTERNO)).headers.get('location') ?? '')
    expect(destino.origin).toBe(PUBLICO)
    expect(destino.pathname).toBe('/esqueci-senha')
    expect(destino.searchParams.get('erro')).toBeTruthy()
  })

  it('next forjado para outro site continua bloqueado (cai em /)', async () => {
    troca.mockResolvedValue({ error: null })
    for (const next of ['https://site-falso.example', '//site-falso.example', '/\\site-falso.example']) {
      const url = `https://0.0.0.0:3000/auth/callback?code=CODIGO-FICTICIO&next=${encodeURIComponent(next)}`
      expect((await chamar(url)).headers.get('location')).toBe(`${PUBLICO}/`)
    }
  })

  it('sem código: não chama o Supabase e volta para /esqueci-senha no domínio público', async () => {
    const destino = new URL((await chamar('https://0.0.0.0:3000/auth/callback')).headers.get('location') ?? '')
    expect(troca).not.toHaveBeenCalled()
    expect(destino.origin).toBe(PUBLICO)
    expect(destino.pathname).toBe('/esqueci-senha')
  })

  it('configuração ausente ou local em produção: redirect RELATIVO, nunca 0.0.0.0/localhost', async () => {
    troca.mockResolvedValue({ error: null })
    for (const valor of ['', 'http://localhost:3000', 'https://0.0.0.0:3000', 'invalido']) {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', valor)
      const local = (await chamar(INTERNO)).headers.get('location') ?? ''
      expect(local).toBe('/redefinir-senha')
      expect(local).not.toMatch(/0\.0\.0\.0|localhost|127\.0\.0\.1/)
    }
  })
})
