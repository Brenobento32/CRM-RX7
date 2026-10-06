import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { supabase } from './supabase.js'

/** Bucket privado de mídia do WhatsApp — path `{conversa_id}/{uuid}.{extensao}` (ver migration 20261006100000). */
const BUCKET = 'whatsapp-midia'

// `ffmpeg-static` é CommonJS puro (`module.exports = <string>`), mas seu
// `.d.ts` declara um `export default` estilo ESM — combinação que confunde
// a resolução de tipos do TS sob `moduleResolution: NodeNext` num projeto
// ESM (`"type": "module"`, ver package.json). `createRequire` carrega o
// valor real do `module.exports` direto, sem passar pela interop de import
// estático — é o caminho padrão pra esse tipo de pacote nessas condições.
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null

export function extensaoDeMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}

const EXTENSAO_POR_MIME_DOCUMENTO: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

export function extensaoDocumentoDeMime(mime: string): string {
  return EXTENSAO_POR_MIME_DOCUMENTO[mime] ?? 'bin'
}

const EXTENSAO_POR_MIME_AUDIO: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

export function extensaoAudioDeMime(mime: string): string {
  return EXTENSAO_POR_MIME_AUDIO[mime] ?? 'bin'
}

/**
 * Converte qualquer áudio bruto (webm/ogg/mp4 — o que o `MediaRecorder` do
 * navegador gravou) pra Ogg/Opus real. Baileys não transcodifica nada, só
 * sobe os bytes que receber — sem isso, o voice note não toca em boa parte
 * dos WhatsApp (principalmente iOS), porque o `mimetype` seria só um rótulo
 * mentindo sobre o codec real dos bytes.
 *
 * Nomes de arquivo são sempre gerados aqui (`randomUUID`), nunca derivados
 * do upload do usuário — e os argumentos vão pro ffmpeg via `execFile`
 * (array, sem shell), nunca como string interpolada.
 */
export async function converterParaOggOpus(buffer: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static não encontrou o binário')

  const entrada = path.join(tmpdir(), `${randomUUID()}.entrada`)
  const saida = path.join(tmpdir(), `${randomUUID()}.ogg`)

  await fs.writeFile(entrada, buffer)

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath,
        ['-y', '-i', entrada, '-c:a', 'libopus', '-ar', '48000', '-ac', '1', '-f', 'ogg', saida],
        (erro) => (erro ? reject(erro) : resolve()),
      )
    })
    return await fs.readFile(saida)
  } finally {
    await fs.unlink(entrada).catch(() => {})
    await fs.unlink(saida).catch(() => {})
  }
}

/** Sobe mídia recebida/pendente pro bucket privado. Devolve o path (não a URL — leitura é sempre por signed URL). */
export async function subirMidia(
  conversaId: string,
  buffer: Buffer,
  mimetype: string,
  extensao: string,
): Promise<string | null> {
  const caminho = `${conversaId}/${randomUUID()}.${extensao}`

  const { error } = await supabase.storage.from(BUCKET).upload(caminho, buffer, {
    contentType: mimetype,
    upsert: false,
  })

  if (error) {
    console.error('[midia] falha ao subir arquivo:', error.message)
    return null
  }
  return caminho
}

/** Baixa um arquivo do bucket pra repassar pro Baileys enviar. */
export async function baixarMidia(caminho: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(caminho)

  if (error || !data) {
    console.error('[midia] falha ao baixar arquivo', caminho, error?.message)
    return null
  }
  return Buffer.from(await data.arrayBuffer())
}
