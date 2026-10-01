'use server'

import { z } from 'zod'

import { obterConversaDoCliente, type ConversaCliente } from '@/lib/dal/conversas'

/** Carga inicial do `PainelConversa` — o Realtime assume a partir daqui. */
export async function obterConversaAction(clienteId: string): Promise<ConversaCliente | null> {
  if (!z.uuid().safeParse(clienteId).success) return null
  return obterConversaDoCliente(clienteId)
}
