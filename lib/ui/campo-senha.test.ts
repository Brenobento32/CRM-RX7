import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CampoSenha, estadoCampoSenha } from '@/components/ui/campo-senha'

describe('botão de olho do campo de senha', () => {
  it('começa oculto: campo password e botão "Mostrar senha"', () => {
    const html = renderToStaticMarkup(createElement(CampoSenha, { id: 'senha', name: 'senha', autoComplete: 'current-password', required: true }))
    expect(html).toMatch(/<input[^>]*type="password"/)
    expect(html).toMatch(/<input[^>]*id="senha"/)
    expect(html).toMatch(/<input[^>]*name="senha"/)
    expect(html).toMatch(/<input[^>]*autoComplete="current-password"/i)
    // Botão de verdade (teclado/Enter), que nunca envia o formulário, com rótulo e alvo para leitor de tela.
    expect(html).toMatch(/<button[^>]*type="button"/)
    expect(html).toMatch(/<button[^>]*aria-label="Mostrar senha"/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"/)
    expect(html).toMatch(/<button[^>]*aria-controls="senha"/)
  })

  it('cada clique alterna mostrar/ocultar, sem trocar o campo (o valor digitado fica)', () => {
    expect(estadoCampoSenha(false)).toEqual({ type: 'password', rotulo: 'Mostrar senha', pressionado: false })
    expect(estadoCampoSenha(true)).toEqual({ type: 'text', rotulo: 'Ocultar senha', pressionado: true })
    expect(estadoCampoSenha(!estadoCampoSenha(true).pressionado)).toEqual(estadoCampoSenha(false))
  })

  it('login e Meu perfil usam o mesmo campo (e o login não mudou o que envia)', () => {
    const raiz = path.resolve(__dirname, '..', '..')
    const login = readFileSync(path.join(raiz, 'app/(auth)/login/_components/login-form.tsx'), 'utf8')
    expect(login).toMatch(/<CampoSenha\s+id="senha"\s+name="senha"\s+autoComplete="current-password"/)
    expect(login).not.toMatch(/type="password"/)
    const perfil = readFileSync(path.join(raiz, 'app/(app)/perfil/_components/senha-form.tsx'), 'utf8')
    for (const campo of ['senha_atual', 'nova_senha', 'confirmar_senha']) expect(perfil).toContain(`name="${campo}"`)
    expect(perfil.match(/<CampoSenha/g)?.length).toBe(3)
  })
})
