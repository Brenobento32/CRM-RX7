import type { WASocket } from '@whiskeysockets/baileys'

import { supabase } from './supabase.js'

/** Intervalo do polling de segurança — cobre o caso de o Realtime cair sem o processo notar. */
const INTERVALO_POLLING_MS = 60_000

type MensagemPendente = {
  id: string
  conversa_id: string
  conteudo: string | null
}

/**
 * Socket Baileys atual, se conectado. `index.ts` atualiza isto a cada
 * `connection.update` (`open` → socket; `close`/reconectando → null). Sem
 * socket conectado, `processarPendentes` não reivindica nada — a mensagem
 * fica `pendente` até o próximo gatilho (Realtime, polling ou reconexão).
 */
let socketAtivo: WASocket | null = null

export function definirSocketAtivo(socket: WASocket | null): void {
  socketAtivo = socket
  // Socket voltou a ficar disponível: tenta recuperar o que acumulou
  // enquanto estava desconectado (reconexão) ou offline (reinício do processo).
  if (socket) void processarPendentes()
}

/**
 * Liga o sender de texto: busca o que já está pendente (mensagem criada
 * enquanto o serviço estava offline), assina Realtime pra pegar novidade em
 * tempo real, e mantém um polling de segurança a cada 60s pro caso de o
 * Realtime cair. Independente da conexão com o WhatsApp — pode ser chamado
 * uma única vez no início do processo, antes mesmo do primeiro QR.
 */
export function iniciarSenderTexto(): void {
  assinarRealtime()
  setInterval(() => void processarPendentes(), INTERVALO_POLLING_MS)
  void processarPendentes()
}

function assinarRealtime(): void {
  supabase
    .channel('whatsapp-service-mensagens-pendentes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mensagens', filter: 'status=eq.pendente' },
      () => void processarPendentes(),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'mensagens', filter: 'status=eq.pendente' },
      () => void processarPendentes(),
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[envio] Realtime de mensagens pendentes com problema:', status, '— polling de 60s continua ativo.')
      }
    })
}

/**
 * Varre tudo que está `pendente` agora. Chamado pelo Realtime, pelo polling
 * e na reconexão — sempre a mesma função, sempre com claim atômico por
 * mensagem, então rodar em paralelo nunca duplica envio (ver `reivindicar`).
 */
async function processarPendentes(): Promise<void> {
  if (!socketAtivo) return

  const { data, error } = await supabase
    .from('mensagens')
    .select('id, conversa_id, conteudo')
    .eq('direcao', 'saida')
    .eq('tipo', 'texto')
    .eq('status', 'pendente')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[envio] falha ao buscar mensagens pendentes:', error.message)
    return
  }

  for (const mensagem of data ?? []) {
    await processarMensagem(mensagem)
  }
}

/** Reivindica a mensagem pra este processo. Só quem afetar exatamente 1 linha segue com o envio. */
async function reivindicar(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('mensagens')
    .update({ status: 'enviando' })
    .eq('id', id)
    .eq('status', 'pendente')
    .select('id')

  if (error) {
    console.error('[envio] falha ao reivindicar mensagem', id, error.message)
    return false
  }
  return (data?.length ?? 0) === 1
}

async function buscarTelefoneDaConversa(conversaId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversas')
    .select('telefone')
    .eq('id', conversaId)
    .maybeSingle()

  if (error) {
    console.error('[envio] falha ao buscar telefone da conversa', conversaId, error.message)
    return null
  }
  return data?.telefone ?? null
}

async function processarMensagem(mensagem: MensagemPendente): Promise<void> {
  const socket = socketAtivo
  if (!socket) return

  if (!(await reivindicar(mensagem.id))) return // outra chamada (Realtime/polling) já pegou essa

  try {
    if (!mensagem.conteudo) throw new Error('mensagem de texto sem conteúdo')

    const telefone = await buscarTelefoneDaConversa(mensagem.conversa_id)
    if (!telefone) throw new Error(`conversa ${mensagem.conversa_id} sem telefone`)

    const enviada = await socket.sendMessage(`${telefone}@s.whatsapp.net`, { text: mensagem.conteudo })

    const { error } = await supabase
      .from('mensagens')
      .update({ status: 'enviado', whatsapp_message_id: enviada?.key?.id ?? null })
      .eq('id', mensagem.id)

    if (error) console.error('[envio] falha ao marcar mensagem como enviada', mensagem.id, error.message)
    else console.log('[envio] mensagem enviada:', mensagem.id)
  } catch (erro) {
    console.error('[envio] falha ao enviar mensagem', mensagem.id, erro)
    const { error } = await supabase.from('mensagens').update({ status: 'falhou' }).eq('id', mensagem.id)
    if (error) console.error('[envio] falha ao marcar mensagem como falhou', mensagem.id, error.message)
  }
}
