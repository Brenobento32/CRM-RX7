import { randomUUID } from 'node:crypto'

import { supabase } from './supabase.js'

/** Bucket privado de mídia do WhatsApp — path `{conversa_id}/{uuid}.{extensao}` (ver migration 20261006100000). */
const BUCKET = 'whatsapp-midia'

export function extensaoDeMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}

/** Sobe mídia recebida/pendente pro bucket privado. Devolve o path (não a URL — leitura é sempre por signed URL). */
export async function subirMidia(
  conversaId: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string | null> {
  const caminho = `${conversaId}/${randomUUID()}.${extensaoDeMime(mimetype)}`

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
