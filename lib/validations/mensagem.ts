/** Igual ao bucket `whatsapp-midia` (migration de mídia do WhatsApp). */
export const ANEXO_IMAGEM_TIPOS = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ANEXO_IMAGEM_TAMANHO_MAXIMO = 8 * 1024 * 1024

/** `null` = sem imagem enviada; string = mensagem de erro. */
export function validarAnexoImagem(arquivo: FormDataEntryValue | null): File | null | string {
  if (!(arquivo instanceof File) || arquivo.size === 0) return null
  if (!(ANEXO_IMAGEM_TIPOS as readonly string[]).includes(arquivo.type)) {
    return 'Use uma imagem JPG, PNG ou WebP.'
  }
  if (arquivo.size > ANEXO_IMAGEM_TAMANHO_MAXIMO) return 'A imagem pode ter no máximo 8 MB.'
  return arquivo
}

export function extensaoDeMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}
