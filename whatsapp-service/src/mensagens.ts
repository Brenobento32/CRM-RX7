import type { WAMessage } from '@whiskeysockets/baileys'

import { supabase } from './supabase.js'
import { candidatosTelefone, telefoneDoJid } from './telefone.js'

type Tipo = 'texto' | 'imagem' | 'documento' | 'audio' | 'video'

/**
 * Extrai um conteúdo exibível da mensagem. Mídia não é baixada nesta fase
 * (sem tabela de anexo/Storage ainda) — só o tipo e uma legenda/placeholder.
 */
function extrairConteudo(msg: WAMessage): { conteudo: string; tipo: Tipo } | null {
  const m = msg.message
  if (!m) return null

  if (m.conversation) return { conteudo: m.conversation, tipo: 'texto' }
  if (m.extendedTextMessage?.text) return { conteudo: m.extendedTextMessage.text, tipo: 'texto' }
  if (m.imageMessage) return { conteudo: m.imageMessage.caption ?? '[Imagem]', tipo: 'imagem' }
  if (m.videoMessage) return { conteudo: m.videoMessage.caption ?? '[Vídeo]', tipo: 'video' }
  if (m.audioMessage) return { conteudo: '[Áudio]', tipo: 'audio' }
  if (m.documentMessage) return { conteudo: m.documentMessage.fileName ?? '[Documento]', tipo: 'documento' }

  return null
}

/** Acha o cliente já cadastrado com esse telefone/whatsapp. Nunca cria um novo ("lead"). */
async function buscarClientePorTelefone(digitos: string): Promise<string | null> {
  const candidatos = candidatosTelefone(digitos)
  const filtro = candidatos.flatMap((c) => [`telefone.eq.${c}`, `whatsapp.eq.${c}`]).join(',')

  const { data, error } = await supabase
    .from('clientes')
    .select('id')
    .is('deleted_at', null)
    .or(filtro)
    .limit(1)

  if (error) {
    console.error('[mensagens] falha ao buscar cliente pelo telefone:', error.message)
    return null
  }
  return data?.[0]?.id ?? null
}

/** Acha a conversa do telefone ou cria uma nova; nunca sobrescreve um cliente_id já vinculado. */
async function obterOuCriarConversa(telefone: string, clienteId: string | null): Promise<string | null> {
  const agora = new Date().toISOString()

  const { data: existente, error: erroBusca } = await supabase
    .from('conversas')
    .select('id, cliente_id')
    .eq('telefone', telefone)
    .maybeSingle()

  if (erroBusca) {
    console.error('[mensagens] falha ao buscar conversa:', erroBusca.message)
    return null
  }

  if (existente) {
    const { error: erroUpdate } = await supabase
      .from('conversas')
      .update({
        ultima_mensagem_em: agora,
        ...(existente.cliente_id ? {} : { cliente_id: clienteId }),
      })
      .eq('id', existente.id)

    if (erroUpdate) console.error('[mensagens] falha ao atualizar conversa:', erroUpdate.message)
    return existente.id
  }

  const { data: nova, error: erroInsert } = await supabase
    .from('conversas')
    .insert({ telefone, cliente_id: clienteId, ultima_mensagem_em: agora })
    .select('id')
    .single()

  if (erroInsert || !nova) {
    console.error('[mensagens] falha ao criar conversa:', erroInsert?.message)
    return null
  }
  return nova.id
}

/**
 * Cliente novo ("lead") + negociação aberta no funil configurado em
 * `/configuracoes/whatsapp`, via `criar_cliente_whatsapp()` — atômico, e
 * idempotente por `conversa_id` (duas mensagens simultâneas do mesmo número
 * não duplicam lead: a função serializa pelo lock da linha de `conversas`).
 * Funil e responsável padrão não são passados daqui — a função lê direto de
 * `whatsapp_conexoes`, nunca um valor que este serviço decide. Nome nunca
 * inventado — o WhatsApp não manda nome de contato nesta fase.
 */
async function criarLeadWhatsapp(telefone: string, conversaId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('criar_cliente_whatsapp', {
    p_telefone: telefone,
    p_nome: `Contato WhatsApp — ${telefone}`,
    p_conversa_id: conversaId,
  })

  if (error) {
    console.error('[mensagens] falha ao criar lead automático:', error.message)
    return null
  }

  return data?.[0]?.cliente_id ?? null
}

/**
 * Ponto de entrada chamado pelo evento `messages.upsert` do Baileys.
 * Fase 1: só grava mensagem de ENTRADA (do cliente para a empresa) — mensagem
 * enviada pelo próprio número conectado (`fromMe`) é ignorada aqui.
 */
export async function salvarMensagemRecebida(msg: WAMessage): Promise<void> {
  if (msg.key.fromMe) return

  // WhatsApp pode endereçar o contato por `@lid` (identificador de privacidade)
  // em vez do `@s.whatsapp.net` tradicional. Nesse caso o telefone real vem
  // junto na própria mensagem, em `key.senderPn`. Sem esse campo não há como
  // resolver o telefone a partir de um `@lid` — loga e descarta em vez de
  // inventar um telefone.
  const ehLid = msg.key.remoteJid?.endsWith('@lid')
  if (ehLid && !msg.key.senderPn) {
    console.error('[mensagens] remoteJid @lid sem senderPn — telefone não resolvido, mensagem descartada:', msg.key.remoteJid)
    return
  }

  const telefone = telefoneDoJid(ehLid ? msg.key.senderPn : msg.key.remoteJid)
  if (!telefone) return

  const extraido = extrairConteudo(msg)
  if (!extraido) return

  let clienteId = await buscarClientePorTelefone(telefone)
  const jaEraCliente = clienteId !== null
  const conversaId = await obterOuCriarConversa(telefone, clienteId)
  if (!conversaId) return

  // Telefone desconhecido: abre lead automático. Telefone já conhecido segue
  // o fluxo normal, sem tocar em cliente/negociação.
  let leadCriadoAgora = false
  if (!clienteId) {
    clienteId = await criarLeadWhatsapp(telefone, conversaId)
    leadCriadoAgora = clienteId !== null
  }

  const { error } = await supabase.from('mensagens').insert({
    conversa_id: conversaId,
    direcao: 'entrada',
    tipo: extraido.tipo,
    conteudo: extraido.conteudo,
    whatsapp_message_id: msg.key.id ?? null,
  })

  if (error) {
    console.error('[mensagens] falha ao gravar mensagem:', error.message)
    return
  }

  const rotulo = leadCriadoAgora ? ' (novo lead criado)' : jaEraCliente ? ' (cliente cadastrado)' : ''
  console.log(`[mensagens] recebida de ${telefone}${rotulo}: ${extraido.conteudo.slice(0, 60)}`)
}
