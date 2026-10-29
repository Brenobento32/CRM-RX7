import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { caminhoDaEmpresa, SLUGS_RESERVADOS, separarPrefixo, slugDeEmpresa, slugValido } from './rota'

describe('separarPrefixo', () => {
  it('formato atual /<slug>/...', () => {
    expect(separarPrefixo('/rio-x7/funil')).toEqual({ slug: 'rio-x7', resto: '/funil', legado: false })
    expect(separarPrefixo('/empresa-a/clientes/123')).toEqual({ slug: 'empresa-a', resto: '/clientes/123', legado: false })
    expect(separarPrefixo('/rio-x7')).toEqual({ slug: 'rio-x7', resto: '/', legado: false })
    expect(separarPrefixo('/rio-x7/')).toEqual({ slug: 'rio-x7', resto: '/', legado: false })
  })

  it('formato antigo /e/<slug>/... é reconhecido como legado', () => {
    expect(separarPrefixo('/e/rio-x7/funil')).toEqual({ slug: 'rio-x7', resto: '/funil', legado: true })
    expect(separarPrefixo('/e/rio-x7')).toEqual({ slug: 'rio-x7', resto: '/', legado: true })
  })

  it('rotas internas e públicas nunca viram empresa', () => {
    for (const rota of ['/funil', '/agenda', '/clientes/1', '/login', '/admin/empresas', '/f/123', '/auth/callback', '/empresas', '/relatorios/vendas', '/perfil', '/e', '/e/']) {
      expect(separarPrefixo(rota)).toBeNull()
    }
  })

  it('recusa slug inválido e tentativas de escapar do caminho', () => {
    for (const rota of ['/', '/Rio-X7/funil', '/rio_x7/funil', '/..%2f/funil', '/e/..%2f/funil', '/e/Rio-X7/funil', '//evil.com', '/e//evil.com', '/robots.txt', '/a--b']) {
      expect(separarPrefixo(rota)).toBeNull()
    }
  })

  it('slug reservado não vale nem no formato antigo', () => {
    expect(separarPrefixo('/e/agenda/funil')).toBeNull()
    expect(separarPrefixo('/e/admin')).toBeNull()
  })
})

describe('slugValido / slugDeEmpresa', () => {
  it('formato do banco', () => {
    expect(slugValido('arquivo-legado')).toBe(true)
    expect(slugValido('a')).toBe(true)
    expect(slugValido('-a')).toBe(false)
    expect(slugValido('a--b')).toBe(false)
    expect(slugValido('a'.repeat(64))).toBe(false)
    expect(slugValido(null)).toBe(false)
  })

  it('reservados são válidos no formato mas não são empresa', () => {
    expect(slugValido('agenda')).toBe(true)
    expect(slugDeEmpresa('agenda')).toBe(false)
    expect(slugDeEmpresa('teste-avante-b')).toBe(true)
  })
})

describe('caminhoDaEmpresa', () => {
  it('monta a URL da empresa no formato atual', () => {
    expect(caminhoDaEmpresa('rio-x7')).toBe('/rio-x7')
    expect(caminhoDaEmpresa('rio-x7', '/')).toBe('/rio-x7')
    expect(caminhoDaEmpresa('rio-x7', '/funil?funil=1')).toBe('/rio-x7/funil?funil=1')
    expect(caminhoDaEmpresa('rio-x7', 'clientes')).toBe('/rio-x7/clientes')
  })

  it('ida e volta: o caminho montado é reconhecido com a mesma empresa e rota', () => {
    expect(separarPrefixo(caminhoDaEmpresa('empresa-a', '/agenda'))).toEqual({ slug: 'empresa-a', resto: '/agenda', legado: false })
  })
})

describe('lista de reservados', () => {
  const raiz = join(__dirname, '..', '..')

  it('é igual à de public.slug_reservado() no SQL', () => {
    const pastas = ['supabase/migrations', 'supabase/propostas']
    const sql = pastas
      .flatMap((p) => {
        try {
          return readdirSync(join(raiz, p))
            .sort()
            .map((f) => readFileSync(join(raiz, p, f), 'utf8'))
        } catch {
          return []
        }
      })
      .filter((t) => t.includes('function public.slug_reservado'))
      // a definição em vigor é a da migration mais recente (create or replace)
      .at(-1)
    expect(sql, 'definição de slug_reservado não encontrada').toBeTruthy()
    const corpo = sql!.slice(sql!.indexOf('function public.slug_reservado'))
    const lista = corpo.slice(corpo.indexOf('array['), corpo.indexOf(']'))
    const doBanco = new Set([...lista.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]))
    expect([...doBanco].sort()).toEqual([...SLUGS_RESERVADOS].sort())
  })

  it('contém toda pasta de rota de primeiro nível do app/', () => {
    const app = join(raiz, 'app')
    const rotas = new Set<string>()
    const visitar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome)
        if (!statSync(caminho).isDirectory() || nome.startsWith('_') || nome.startsWith('[')) continue
        if (nome.startsWith('(') && nome.endsWith(')')) visitar(caminho) // grupo: não entra na URL
        else rotas.add(nome)
      }
    }
    visitar(app)
    // Seções servidas pelo catch-all `app/(app)/[...secao]`.
    rotas.add('relatorios')
    const faltando = [...rotas].filter((r) => !SLUGS_RESERVADOS.has(r))
    expect(faltando, `rotas que precisam entrar em SLUGS_RESERVADOS e em slug_reservado(): ${faltando.join(', ')}`).toEqual([])
  })
})
