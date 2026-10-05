'use server'

import { z } from 'zod'

import { enviarMensagemTexto, obterConversaDoCliente, type ConversaCliente } from '@/lib/dal/conversas'

/** Carga inicial do `PainelConversa` — o Realtime assume a partir daqui. */
export async function obterConversaAction(clienteId: string): Promise<ConversaCliente | null> {
  if (!z.uuid().safeParse(clienteId).success) return null
  return obterConversaDoCliente(clienteId)
}

export type EstadoEnvioMensagem = { ok?: boolean; erro?: string }

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

  return { ok: true }
}
