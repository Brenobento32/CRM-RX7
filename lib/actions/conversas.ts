'use server'

import { z } from 'zod'

import {
  enviarMensagemDocumento,
  enviarMensagemImagem,
  enviarMensagemTexto,
  obterConversaDoCliente,
  obterStatusMensagem,
  obterUrlAnexo,
  reenviarMensagemMidia,
  type ConversaCliente,
  type StatusMensagem,
} from '@/lib/dal/conversas'
import { validarAnexoDocumento, validarAnexoImagem } from '@/lib/validations/mensagem'

/** Carga inicial do `PainelConversa` — o Realtime assume a partir daqui. */
export async function obterConversaAction(clienteId: string): Promise<ConversaCliente | null> {
  if (!z.uuid().safeParse(clienteId).success) return null
  return obterConversaDoCliente(clienteId)
}

/** Fallback pontual (uma mensagem, uma vez) pro caso do UPDATE do Realtime não chegar no remetente. */
export async function obterStatusMensagemAction(id: string): Promise<StatusMensagem | null> {
  if (!z.uuid().safeParse(id).success) return null
  return obterStatusMensagem(id)
}

/** Signed URL de uma mensagem de imagem que chegou via Realtime (sem URL no payload). */
export async function obterUrlAnexoAction(mensagemId: string): Promise<string | null> {
  if (!z.uuid().safeParse(mensagemId).success) return null
  return obterUrlAnexo(mensagemId)
}

export type EstadoEnvioMensagem = {
  ok?: boolean
  erro?: string
  /** Só presentes quando `ok` — pra `PainelConversa` mostrar a própria mensagem sem esperar o Realtime. */
  id?: string
  createdAt?: string
  conteudo?: string
  /** Só presentes quando `ok` e a mensagem é de mídia (imagem ou documento). */
  arquivoUrl?: string
  arquivoNome?: string
}

const uuid = z.uuid()

/** Envio de texto pelo `PainelConversa` — vazio é barrado aqui e, por garantia, pelo CHECK no banco. */
export async function enviarMensagemAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const texto = String(formData.get('texto') ?? '').trim()
  if (!texto) return { erro: 'Escreva uma mensagem antes de enviar.' }

  const resultado = await enviarMensagemTexto(conversaId, texto)
  if (!resultado.ok) return { erro: resultado.mensagem }

  return { ok: true, id: resultado.id, createdAt: resultado.createdAt, conteudo: texto }
}

/** Envio de imagem pelo `PainelConversa` — mesmo ciclo pendente→enviando→enviado/falhou do texto. */
export async function enviarMensagemImagemAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const arquivo = validarAnexoImagem(formData.get('arquivo'))
  if (typeof arquivo === 'string') return { erro: arquivo }
  if (!arquivo) return { erro: 'Selecione uma imagem.' }

  const legenda = String(formData.get('texto') ?? '').trim()

  const resultado = await enviarMensagemImagem(conversaId, arquivo, legenda || null)
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    conteudo: resultado.conteudo ?? undefined,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
  }
}

/** Envio de documento pelo `PainelConversa` — mesmo ciclo pendente→enviando→enviado/falhou do texto/imagem. */
export async function enviarMensagemDocumentoAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const arquivo = validarAnexoDocumento(formData.get('arquivo'))
  if (typeof arquivo === 'string') return { erro: arquivo }
  if (!arquivo) return { erro: 'Selecione um documento.' }

  const legenda = String(formData.get('texto') ?? '').trim()

  const resultado = await enviarMensagemDocumento(conversaId, arquivo, legenda || null)
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    conteudo: resultado.conteudo ?? undefined,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
    arquivoNome: resultado.arquivoNome ?? undefined,
  }
}

/** "Tentar novamente" numa mensagem de mídia (imagem ou documento) `falhou` — reaproveita o arquivo já no Storage. */
export async function reenviarMensagemMidiaAction(mensagemId: string): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(mensagemId).success) return { erro: 'Mensagem inválida.' }

  const resultado = await reenviarMensagemMidia(mensagemId)
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    conteudo: resultado.conteudo ?? undefined,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
    arquivoNome: resultado.arquivoNome ?? undefined,
  }
}
