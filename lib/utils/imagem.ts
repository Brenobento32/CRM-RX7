import { FOTO_TAMANHO_MAXIMO, FOTO_TIPOS } from '@/lib/validations/usuario'

export type TipoImagem = (typeof FOTO_TIPOS)[number]

const EXTENSAO: Record<TipoImagem, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const ascii = (b: Uint8Array, inicio: number, fim: number) => String.fromCharCode(...b.subarray(inicio, fim))

/**
 * Tipo REAL da imagem pelos primeiros bytes (assinatura do formato), não pelo
 * nome nem pelo tipo que o navegador declarou. Só JPG, PNG e WebP.
 */
export function tipoRealDaImagem(b: Uint8Array): TipoImagem | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export const extensaoDaImagem = (tipo: TipoImagem) => EXTENSAO[tipo]

/**
 * Foto enviada pelo formulário, conferida antes de ir para o Storage:
 * - `null`: nenhum arquivo;
 * - erro: tipo não aceito, vazio, acima de 2 MB ou conteúdo que não é a imagem declarada;
 * - ok: um arquivo novo, com o tipo real e nome neutro (o nome original nunca é usado).
 */
export async function lerFotoSegura(
  entrada: FormDataEntryValue | null,
): Promise<null | { ok: true; arquivo: File; tipo: TipoImagem } | { ok: false; mensagem: string }> {
  if (!(entrada instanceof File) || entrada.size === 0) return null
  if (!(FOTO_TIPOS as readonly string[]).includes(entrada.type)) return { ok: false, mensagem: 'Use uma imagem JPG, PNG ou WebP.' }
  if (entrada.size > FOTO_TAMANHO_MAXIMO) return { ok: false, mensagem: 'A foto pode ter no máximo 2 MB.' }
  const bytes = new Uint8Array(await entrada.arrayBuffer())
  const tipo = tipoRealDaImagem(bytes)
  if (!tipo || tipo !== entrada.type) return { ok: false, mensagem: 'O arquivo não é uma imagem JPG, PNG ou WebP válida.' }
  return { ok: true, tipo, arquivo: new File([bytes], `foto.${EXTENSAO[tipo]}`, { type: tipo }) }
}
