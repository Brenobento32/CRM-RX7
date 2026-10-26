import { describe, expect, it } from 'vitest'

import { destinoAdminSeguro, destinoClienteSeguro, ehRotaAdmin, entradaDoPortal, portalValido } from '@/lib/auth/portal'

describe('portais: rota do painel', () => {
  it.each([
    ['/admin', true],
    ['/admin/planos', true],
    ['/admin/empresas/123?ok=1', true],
    ['/admin?next=/admin/planos', true],
    ['/administracao', false],
    ['/admin-falso', false],
    ['/teste-avante-a/admin', false],
    ['/', false],
  ])('%s → %s', (caminho, esperado) => {
    expect(ehRotaAdmin(caminho)).toBe(esperado)
  })
})

describe('portais: destino depois do login administrativo', () => {
  it('aceita só caminhos do painel', () => {
    expect(destinoAdminSeguro('/admin/planos')).toBe('/admin/planos')
    expect(destinoAdminSeguro('/admin/empresas/abc?ok=1')).toBe('/admin/empresas/abc?ok=1')
  })

  it.each([
    [undefined],
    [''],
    ['/'],
    ['/teste-avante-a/funil'],
    ['https://site-falso.com/admin'],
    ['//site-falso.com/admin'],
    ['/\\site-falso.com'],
    ['/administracao'],
    [42],
  ])('qualquer outra coisa vira /admin: %s', (next) => {
    expect(destinoAdminSeguro(next)).toBe('/admin')
  })

  it('lista de valores (?next= repetido) usa só o primeiro', () => {
    expect(destinoAdminSeguro(['/admin/auditoria', 'https://x.test'])).toBe('/admin/auditoria')
  })
})

describe('portais: destino depois do login de clientes', () => {
  it('mantém caminhos internos da empresa', () => {
    expect(destinoClienteSeguro('/teste-avante-a/agenda')).toBe('/teste-avante-a/agenda')
    expect(destinoClienteSeguro(undefined)).toBe('/')
  })

  it.each([['/admin'], ['/admin/planos'], ['https://site-falso.com'], ['//site-falso.com'], ['/\\site-falso.com']])(
    'nunca leva ao painel nem para fora: %s → /',
    (next) => {
      expect(destinoClienteSeguro(next)).toBe('/')
    },
  )
})

describe('portais: origem da recuperação e entrada de cada portal', () => {
  it('só "admin" vale como portal administrativo', () => {
    expect(portalValido('admin')).toBe('admin')
    expect(portalValido(['admin'])).toBe('admin')
    expect(portalValido('Admin')).toBe('clientes')
    expect(portalValido(undefined)).toBe('clientes')
    expect(portalValido('qualquer')).toBe('clientes')
  })

  it('logout e senha redefinida voltam para a entrada do próprio portal', () => {
    expect(entradaDoPortal('admin')).toBe('/admin')
    expect(entradaDoPortal('clientes')).toBe('/login')
  })
})
