/**
 * Conecta 1 número WhatsApp via QR Code (Baileys) e grava no Supabase:
 * status da conexão (`whatsapp_conexoes`), mensagens recebidas
 * (`conversas`/`mensagens`, ver `mensagens.ts`) e envio de texto pendente
 * criado pelo CRM (ver `envio.ts`). Nada aqui cria cliente ("lead") nem mexe
 * no Kanban. A `service_role` usada em `supabase.ts` só existe neste
 * processo, nunca no Next.js.
 */
import { Boom } from '@hapi/boom'
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type ConnectionState,
} from '@whiskeysockets/baileys'
import { pino } from 'pino'
import qrcodeTerminal from 'qrcode-terminal'

import { atualizarStatusConexao } from './conexao.js'
import { definirSocketAtivo, iniciarSenderTexto } from './envio.js'
import { salvarMensagemRecebida } from './mensagens.js'

const PASTA_CREDENCIAIS = 'auth_info_baileys'

const logger = pino({ level: 'silent' })

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(PASTA_CREDENCIAIS)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    version,
    auth: state,
    logger,
  })

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('\nEscaneie o QR Code no WhatsApp (Aparelhos conectados › Conectar um aparelho):\n')
      qrcodeTerminal.generate(qr, { small: true })
    }

    if (connection === 'connecting') {
      console.log('[status] conectando…')
      void atualizarStatusConexao('conectando')
    }

    if (connection === 'open') {
      const numero = socket.user?.id?.split(':')[0]
      console.log('[status] conectado — número:', numero ?? 'desconhecido')
      void atualizarStatusConexao('conectado', numero)
      definirSocketAtivo(socket)
    }

    if (connection === 'close') {
      const codigo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
      const deslogado = codigo === DisconnectReason.loggedOut
      console.log('[status] desconectado', { codigo, deslogado })
      void atualizarStatusConexao('desconectado')
      definirSocketAtivo(null)

      if (deslogado) {
        console.log(`Sessão encerrada pelo WhatsApp. Apague a pasta "${PASTA_CREDENCIAIS}" e rode de novo para gerar um QR novo.`)
        return
      }

      console.log('Reconectando…')
      void iniciar()
    }
  })

  // Fase 1: só grava o que chega (`type === 'notify'` = mensagem em tempo
  // real; ignora `'append'`, que é histórico sincronizado na reconexão).
  socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      salvarMensagemRecebida(msg).catch((erro) => console.error('[mensagens] erro inesperado:', erro))
    }
  })
}

// Independente da conexão com o WhatsApp — sobrevive a reconexões do socket
// e já busca o que ficou pendente enquanto o processo estava fora do ar.
iniciarSenderTexto()

iniciar().catch((erro) => {
  console.error('Falha ao iniciar o serviço WhatsApp:', erro)
  process.exit(1)
})
