import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

type DirecaoMensagem = Database['public']['Enums']['direcao_mensagem']
type TipoMensagem = Database['public']['Enums']['tipo_mensagem']

export type MensagemConversa = {
  id: string
  direcao: DirecaoMensagem
  tipo: TipoMensagem
  conteudo: string | null
  createdAt: string
}

export type ConversaCliente = {
  id: string
  mensagens: MensagemConversa[]
}

/**
 * Conversa de WhatsApp vinculada a um cliente, com as mensagens em ordem
 * cronológica (mais antiga primeiro). `null` quando o cliente nunca teve
 * conversa — RLS de `conversas`/`mensagens` decide o que cada usuário
 * enxerga (gerente vê tudo; closer só a conversa de um cliente que é dele),
 * mesma regra do resto do sistema.
 */
export async function obterConversaDoCliente(clienteId: string): Promise<ConversaCliente | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data: conversa, error: erroConversa } = await supabase
    .from('conversas')
    .select('id')
    .eq('cliente_id', clienteId)
    .order('ultima_mensagem_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (erroConversa) throw new Error('Não foi possível carregar a conversa.', { cause: erroConversa })
  if (!conversa) return null

  const { data: mensagens, error: erroMensagens } = await supabase
    .from('mensagens')
    .select('id, direcao, tipo, conteudo, created_at')
    .eq('conversa_id', conversa.id)
    .order('created_at', { ascending: true })

  if (erroMensagens) throw new Error('Não foi possível carregar as mensagens.', { cause: erroMensagens })

  return {
    id: conversa.id,
    mensagens: (mensagens ?? []).map((m) => ({
      id: m.id,
      direcao: m.direcao,
      tipo: m.tipo,
      conteudo: m.conteudo,
      createdAt: m.created_at,
    })),
  }
}
