import { describe, expect, it } from 'vitest'

import { lerFotoSegura, tipoRealDaImagem } from '@/lib/utils/imagem'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([36, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0))))
const TEXTO = new TextEncoder().encode('<svg onload="alert(1)"></svg>')

const arquivo = (bytes: Uint8Array, tipo: string, nome = 'foto') => new File([bytes.slice()], nome, { type: tipo })

describe('tipo real da imagem pelos primeiros bytes', () => {
  it('reconhece JPG, PNG e WebP', () => {
    expect(tipoRealDaImagem(JPG)).toBe('image/jpeg')
    expect(tipoRealDaImagem(PNG)).toBe('image/png')
    expect(tipoRealDaImagem(WEBP)).toBe('image/webp')
  })
  it('recusa SVG, texto e arquivo vazio', () => {
    expect(tipoRealDaImagem(TEXTO)).toBeNull()
    expect(tipoRealDaImagem(new Uint8Array())).toBeNull()
  })
})

describe('foto do perfil conferida antes do Storage', () => {
  it('sem arquivo: nada a fazer', async () => {
    expect(await lerFotoSegura(null)).toBeNull()
    expect(await lerFotoSegura(arquivo(new Uint8Array(), 'image/png'))).toBeNull()
  })

  it('PNG, JPG e WebP verdadeiros: aceitos, com nome neutro e o tipo real', async () => {
    for (const [bytes, tipo, ext] of [[PNG, 'image/png', 'png'], [JPG, 'image/jpeg', 'jpg'], [WEBP, 'image/webp', 'webp']] as const) {
      const r = await lerFotoSegura(arquivo(bytes, tipo, '../../outra-pessoa/minha foto.' + ext))
      expect(r && r.ok && r.tipo === tipo && r.arquivo.type === tipo && r.arquivo.name === `foto.${ext}`).toBe(true)
    }
  })

  it('tipo não aceito (GIF, SVG): recusado', async () => {
    expect(await lerFotoSegura(arquivo(PNG, 'image/gif'))).toEqual({ ok: false, mensagem: 'Use uma imagem JPG, PNG ou WebP.' })
    expect(await lerFotoSegura(arquivo(TEXTO, 'image/svg+xml'))).toEqual({ ok: false, mensagem: 'Use uma imagem JPG, PNG ou WebP.' })
  })

  it('conteúdo que não é a imagem declarada: recusado', async () => {
    const r1 = await lerFotoSegura(arquivo(TEXTO, 'image/png'))
    const r2 = await lerFotoSegura(arquivo(JPG, 'image/png'))
    expect(r1).toEqual({ ok: false, mensagem: 'O arquivo não é uma imagem JPG, PNG ou WebP válida.' })
    expect(r2).toEqual({ ok: false, mensagem: 'O arquivo não é uma imagem JPG, PNG ou WebP válida.' })
  })

  it('acima de 2 MB: recusado', async () => {
    const grande = new Uint8Array(2 * 1024 * 1024 + 1)
    grande.set(PNG)
    expect(await lerFotoSegura(arquivo(grande, 'image/png'))).toEqual({ ok: false, mensagem: 'A foto pode ter no máximo 2 MB.' })
  })
})
