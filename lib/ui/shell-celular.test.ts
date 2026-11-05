import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Celular (< 640 px): o menu lateral não pode espremer o conteúdo. A regra é
 * CSS (vale desde o primeiro desenho do servidor, sem esperar o JavaScript):
 * menu fora da tela e conteúdo sem recuo; o botão "Abrir menu" do topo o abre
 * por cima. Tablet e computador seguem as classes de antes.
 */
const raiz = path.resolve(__dirname, '..', '..')
const ler = (f: string) => readFileSync(path.join(raiz, f), 'utf8')

describe('casca do app no celular', () => {
  const shell = ler('components/layout/shell-app.tsx')

  it('menu lateral fora da tela (e fora do Tab) no celular, visível quando aberto por cima', () => {
    expect(shell).toContain('max-sm:invisible max-sm:-translate-x-full')
    expect(shell).toContain('group-data-[sobreposto=sim]/shell:visible group-data-[sobreposto=sim]/shell:translate-x-0')
  })

  it('conteúdo sem o recuo do menu no celular; tablet/computador com os recuos de antes', () => {
    expect(shell).toContain('max-sm:pl-0!')
    expect(shell).toContain('pl-[232px]')
    expect(shell).toContain('group-data-[sidebar=recolhida]/shell:pl-[70px]')
  })

  it('o topo tem o botão "Abrir menu", só no celular', () => {
    expect(shell).toMatch(/export function BotaoMenuCelular[\s\S]*aria-label=\{recolhida \? 'Abrir menu' : 'Fechar menu'\}[\s\S]*sm:hidden/)
    expect(ler('components/layout/topbar.tsx')).toContain('<BotaoMenuCelular />')
  })
})
