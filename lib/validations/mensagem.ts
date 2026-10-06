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

/** Igual ao bucket `whatsapp-midia` (migration de documento). ZIP fica fora desta fase. */
export const ANEXO_DOCUMENTO_TIPOS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const

export const ANEXO_DOCUMENTO_TAMANHO_MAXIMO = 20 * 1024 * 1024

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

/** `null` = sem documento enviado; string = mensagem de erro. */
export function validarAnexoDocumento(arquivo: FormDataEntryValue | null): File | null | string {
  if (!(arquivo instanceof File) || arquivo.size === 0) return null
  if (!(ANEXO_DOCUMENTO_TIPOS as readonly string[]).includes(arquivo.type)) {
    return 'Use PDF, Word, Excel, PowerPoint, CSV ou TXT.'
  }
  if (arquivo.size > ANEXO_DOCUMENTO_TAMANHO_MAXIMO) return 'O documento pode ter no máximo 20 MB.'
  return arquivo
}

export function extensaoDocumentoDeMime(mime: string): string {
  return EXTENSAO_POR_MIME_DOCUMENTO[mime] ?? 'bin'
}

const ASSINATURA_PDF = [0x25, 0x50, 0x44, 0x46] // %PDF
const ASSINATURA_OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] // DOC/XLS/PPT legado (Compound File)
const ASSINATURA_ZIP = [0x50, 0x4b, 0x03, 0x04] // DOCX/XLSX/PPTX são zip (OOXML) por dentro

function comecaCom(bytes: Uint8Array, assinatura: number[]): boolean {
  return assinatura.every((b, i) => bytes[i] === b)
}

/**
 * Confere a assinatura real do arquivo (magic bytes) contra o MIME
 * declarado. `File.type` vem só da extensão/sniffing do navegador — nunca
 * do conteúdo —, então renomear qualquer arquivo pra ".pdf" bastaria pra
 * passar só pela checagem de MIME. CSV/TXT são texto puro, sem assinatura
 * binária confiável: ficam de fora desta checagem (MIME + tamanho é a
 * defesa que existe pra eles).
 */
export function assinaturaDocumentoValida(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'application/pdf':
      return comecaCom(bytes, ASSINATURA_PDF)
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return comecaCom(bytes, ASSINATURA_OLE)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return comecaCom(bytes, ASSINATURA_ZIP)
    case 'text/csv':
    case 'text/plain':
      return true
    default:
      return false
  }
}

/**
 * Formato bruto gravado pelo navegador (`MediaRecorder`) — nunca o que vai
 * pro Baileys. A conversão pro Ogg/Opus real que o WhatsApp exige pra voice
 * note acontece só no whatsapp-service (ffmpeg); aqui só valida o que o
 * navegador conseguiu gravar.
 */
export const ANEXO_AUDIO_TIPOS = ['audio/ogg', 'audio/webm', 'audio/mp4', 'audio/mpeg'] as const
export const ANEXO_AUDIO_TAMANHO_MAXIMO = 20 * 1024 * 1024

const EXTENSAO_POR_MIME_AUDIO: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

/** `null` = sem áudio enviado; string = mensagem de erro. */
export function validarAnexoAudio(arquivo: FormDataEntryValue | null): File | null | string {
  if (!(arquivo instanceof File) || arquivo.size === 0) return null
  if (!(ANEXO_AUDIO_TIPOS as readonly string[]).includes(arquivo.type)) {
    return 'Áudio em formato não suportado.'
  }
  if (arquivo.size > ANEXO_AUDIO_TAMANHO_MAXIMO) return 'O áudio pode ter no máximo 20 MB.'
  return arquivo
}

export function extensaoAudioDeMime(mime: string): string {
  return EXTENSAO_POR_MIME_AUDIO[mime] ?? 'bin'
}

const ASSINATURA_OGG = [0x4f, 0x67, 0x67, 0x53] // OggS
const ASSINATURA_EBML = [0x1a, 0x45, 0xdf, 0xa3] // WebM/Matroska

/**
 * Mesma lógica de `assinaturaDocumentoValida`, pra áudio. MP4/M4A tem o box
 * type "ftyp" nos bytes 4-8 (não no começo, como os outros dois formatos) —
 * é a assinatura padrão de qualquer contêiner ISO Base Media. MP3 não tem
 * assinatura binária universal confiável: MIME + tamanho é a defesa que
 * existe pra ele, mesmo caso de CSV/TXT em `assinaturaDocumentoValida`.
 */
export function assinaturaAudioValida(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'audio/ogg':
      return comecaCom(bytes, ASSINATURA_OGG)
    case 'audio/webm':
      return comecaCom(bytes, ASSINATURA_EBML)
    case 'audio/mp4':
      return bytes.length >= 8 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp'
    case 'audio/mpeg':
      return true
    default:
      return false
  }
}
