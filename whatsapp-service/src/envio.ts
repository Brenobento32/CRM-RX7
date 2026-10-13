import { getAudioDuration, type AnyMessageContent, type WASocket, type proto } from '@whiskeysockets/baileys'

import { baixarMidia, converterParaOggOpus } from './midia.js'
import { supabase } from './supabase.js'

/** Intervalo do polling de segurança — cobre o caso de o Realtime cair sem o processo notar. */
const INTERVALO_POLLING_MS = 60_000

/**
 * Cache em memória das últimas mensagens que ESTE processo relayou —
 * `proto.IMessage` completo, o mesmo objeto que `sendMessage` devolve depois
 * de já ter feito upload/criptografia da mídia (ver `processarMensagem`
 * abaixo). É exatamente o que o `getMessage` do Baileys exige pra responder
 * a um "retry receipt" (quando o aparelho do destinatário não consegue
 * decriptar e pede reenvio) — sem isso, o Baileys não tem o que reenviar e o
 * retry silenciosamente não faz nada (ver `messages-recv.js` da lib:
 * `sendMessagesAgain` → `getMessage` → se vier `undefined`, só loga "message
 * not available" e segue). Guarda só os últimos `CACHE_MAX` (mesmo número
 * que o próprio código-fonte do Baileys sugere em comentário — "cache to
 * store the last 256 sent messages"). Só cobre mensagens enviadas depois que
 * este processo subiu — não sobrevive a restart nem cobre o histórico
 * anterior; isso exigiria persistência (fora do escopo desta etapa).
 */
const CACHE_MAX = 256
const mensagensEnviadasCache = new Map<string, proto.IMessage>()

function guardarParaRetry(id: string | null | undefined, mensagem: proto.IMessage | null | undefined): void {
  if (!id || !mensagem) return
  mensagensEnviadasCache.set(id, mensagem)
  if (mensagensEnviadasCache.size > CACHE_MAX) {
    const maisAntigo = mensagensEnviadasCache.keys().next().value
    if (maisAntigo) mensagensEnviadasCache.delete(maisAntigo)
  }
}

/** Usado como `getMessage` do socket (ver `index.ts`) — só o que este processo mesmo enviou desde que subiu. */
export function obterMensagemParaRetry(id: string | null | undefined): proto.IMessage | undefined {
  if (!id) return undefined
  return mensagensEnviadasCache.get(id)
}

type MensagemPendente = {
  id: string
  conversa_id: string
  tipo: 'texto' | 'imagem' | 'documento' | 'audio'
  conteudo: string | null
  arquivo_path: string | null
  arquivo_mime: string | null
  arquivo_nome: string | null
  arquivo_duracao_segundos: number | null
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
 * Liga o sender de saída (texto, imagem, documento e áudio): busca o que já está pendente
 * (mensagem criada enquanto o serviço estava offline), assina Realtime pra
 * pegar novidade em tempo real, e mantém um polling de segurança a cada 60s
 * pro caso de o Realtime cair. Independente da conexão com o WhatsApp — pode
 * ser chamado uma única vez no início do processo, antes mesmo do primeiro QR.
 */
export function iniciarSenderMensagens(): void {
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
    .select('id, conversa_id, tipo, conteudo, arquivo_path, arquivo_mime, arquivo_nome, arquivo_duracao_segundos')
    .eq('direcao', 'saida')
    .in('tipo', ['texto', 'imagem', 'documento', 'audio'])
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

/** Monta o conteúdo que o Baileys espera, por tipo. Baixa do Storage quando for mídia. */
async function montarConteudo(mensagem: MensagemPendente): Promise<AnyMessageContent> {
  if (mensagem.tipo === 'texto') {
    if (!mensagem.conteudo) throw new Error('mensagem de texto sem conteúdo')
    return { text: mensagem.conteudo }
  }

  if (!mensagem.arquivo_path || !mensagem.arquivo_mime) throw new Error(`mensagem de ${mensagem.tipo} sem arquivo`)

  const bufferBruto = await baixarMidia(mensagem.arquivo_path)
  if (!bufferBruto) throw new Error(`falha ao baixar arquivo ${mensagem.arquivo_path} do Storage`)

  if (mensagem.tipo === 'documento') {
    return {
      document: bufferBruto,
      mimetype: mensagem.arquivo_mime,
      fileName: mensagem.arquivo_nome ?? undefined,
      caption: mensagem.conteudo ?? undefined,
    }
  }

  if (mensagem.tipo === 'audio') {
    // O arquivo bruto é o que o MediaRecorder do navegador gravou
    // (webm/ogg/mp4) — nunca o que vai pro Baileys. Conversão real pro
    // Ogg/Opus acontece aqui, sempre, independente do formato de entrada.
    const bufferOggOpus = await converterParaOggOpus(bufferBruto)
    const duracao = mensagem.arquivo_duracao_segundos ?? (await getAudioDuration(bufferOggOpus).catch(() => undefined))

    return {
      audio: bufferOggOpus,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      seconds: duracao !== undefined ? Math.round(duracao) : undefined,
    }
  }

  return { image: bufferBruto, mimetype: mensagem.arquivo_mime, caption: mensagem.conteudo ?? undefined }
}

async function processarMensagem(mensagem: MensagemPendente): Promise<void> {
  const socket = socketAtivo
  if (!socket) return

  if (!(await reivindicar(mensagem.id))) return // outra chamada (Realtime/polling) já pegou essa

  try {
    const telefone = await buscarTelefoneDaConversa(mensagem.conversa_id)
    if (!telefone) throw new Error(`conversa ${mensagem.conversa_id} sem telefone`)

    const conteudo = await montarConteudo(mensagem)
    const enviada = await socket.sendMessage(`${telefone}@s.whatsapp.net`, conteudo)
    guardarParaRetry(enviada?.key?.id, enviada?.message)

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
