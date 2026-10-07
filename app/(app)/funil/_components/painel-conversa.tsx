'use client'

import { startTransition, useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  enviarMensagemAction,
  enviarMensagemAudioAction,
  enviarMensagemDocumentoAction,
  enviarMensagemImagemAction,
  obterConversaAction,
  obterStatusMensagemAction,
  obterUrlAnexoAction,
  reenviarMensagemMidiaAction,
  type EstadoEnvioMensagem,
} from '@/lib/actions/conversas'
import type { MensagemConversa } from '@/lib/dal/conversas'
import { createClient } from '@/lib/supabase/client'
import {
  diaEmSaoPaulo,
  formatarDia,
  formatarHora,
  formatarTamanhoArquivo,
  hojeSaoPaulo,
  somarDias,
} from '@/lib/utils/formatacao'

import { AnexoMenu } from './anexo-menu'
import { EmojiPopover } from './emoji-popover'
import { PlayerAudio } from './player-audio'

/** Textarea cresce com o texto até esse limite; depois disso, rola por dentro. */
const ALTURA_MAX_TEXTAREA = 160

/**
 * Fallback do Realtime: confere no servidor o status da própria mensagem a
 * cada 1s, por no máximo 30 tentativas (30s) — janela alargada porque imagem
 * tem um passo de upload de mídia pro WhatsApp que texto não tem, e
 * rotineiramente passa dos ~10s que bastavam só para texto. Só essa UMA
 * mensagem é conferida, nunca a conversa inteira (sem polling de lista).
 */
const INTERVALO_VERIFICACAO_MS = 1000
const TENTATIVAS_MAX_VERIFICACAO = 30

type Props = {
  card: { clienteId: string; clienteNome: string; clienteEmpresa: string | null }
  onFechar: () => void
}

type Estado =
  | { status: 'carregando' }
  | { status: 'sem-conversa' }
  | { status: 'pronto'; conversaId: string; mensagens: MensagemConversa[] }

/** Linha crua do Realtime (`postgres_changes`) — mesmas colunas de `mensagens`. */
type LinhaMensagem = {
  id: string
  conversa_id: string
  direcao: MensagemConversa['direcao']
  tipo: MensagemConversa['tipo']
  conteudo: string | null
  status: MensagemConversa['status']
  arquivo_nome: string | null
  arquivo_duracao_segundos: number | null
  created_at: string
}

/**
 * O payload do Realtime traz as colunas da linha, mas nunca uma signed URL —
 * isso é gerado sob demanda (ver `buscarUrlsFaltantes` abaixo), nunca
 * confiando num caminho vindo do cliente.
 */
function paraMensagem(linha: LinhaMensagem): MensagemConversa {
  return {
    id: linha.id,
    direcao: linha.direcao,
    tipo: linha.tipo,
    conteudo: linha.conteudo,
    status: linha.status,
    createdAt: linha.created_at,
    arquivoNome: linha.arquivo_nome,
    arquivoDuracaoSegundos: linha.arquivo_duracao_segundos,
    arquivoUrl: null,
  }
}

/** Segundos → "0:07", "1:23" — só o cronômetro da gravação (o player final mostra sua própria duração nativa). */
function formatarContador(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Mesmo traço (24×24, stroke 2px) dos ícones de `components/layout/icones.tsx` — escopo local porque esse arquivo é só navegação. */
function IconeMicrofone({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 19v3M8 22h8" />
    </svg>
  )
}

const N_BARRAS_WAVEFORM = 24

/**
 * Waveform ao vivo durante a gravação — `AnalyserNode` lê o volume do
 * próprio `MediaStream` do microfone (o mesmo stream que o `MediaRecorder`
 * já está usando; um `MediaStream` aceita múltiplos consumidores) e
 * desenha barras com CSS puro, sem canvas. Todo o ciclo de vida do
 * `AudioContext`/`AnalyserNode`/`requestAnimationFrame` é local a este
 * componente — ele só existe montado enquanto `gravacaoAudio.fase ===
 * 'gravando'`, então o cleanup do efeito abaixo roda sempre que a gravação
 * para (concluir ou cancelar) ou o painel fecha, sem depender de nenhum
 * estado externo lembrar de limpar.
 */
function WaveformGravacao({ stream }: { stream: MediaStream }) {
  const [barras, setBarras] = useState<number[]>(() => Array(N_BARRAS_WAVEFORM).fill(0.05))

  useEffect(() => {
    const audioContext = new AudioContext()
    const origem = audioContext.createMediaStreamSource(stream)
    const analisador = audioContext.createAnalyser()
    analisador.fftSize = 256
    origem.connect(analisador)

    const dados = new Uint8Array(analisador.frequencyBinCount)
    let frameId: number

    function passo() {
      analisador.getByteTimeDomainData(dados)
      let somaQuadrados = 0
      for (let i = 0; i < dados.length; i++) {
        const amostra = (dados[i] - 128) / 128
        somaQuadrados += amostra * amostra
      }
      const volume = Math.sqrt(somaQuadrados / dados.length) // RMS, 0..~1
      setBarras((atual) => [...atual.slice(1), Math.min(1, volume * 4)]) // ganho só pra ficar visível com fala normal
      frameId = requestAnimationFrame(passo)
    }
    frameId = requestAnimationFrame(passo)

    return () => {
      cancelAnimationFrame(frameId)
      origem.disconnect()
      analisador.disconnect()
      void audioContext.close()
    }
  }, [stream])

  return (
    <div className="flex h-6 flex-1 items-center gap-0.5" aria-hidden>
      {barras.map((v, i) => (
        <span
          key={i}
          className="w-1 flex-1 rounded-full bg-red-500"
          style={{ height: `${Math.max(10, v * 100)}%` }}
        />
      ))}
    </div>
  )
}

const ROTULO_STATUS_ENVIO: Record<NonNullable<MensagemConversa['status']>, string> = {
  pendente: 'Enviando…',
  enviando: 'Enviando…',
  enviado: '✓ Enviado',
  falhou: '⚠ Falhou',
}

/** Posição no ciclo de envio — nunca deixa um payload atrasado regredir pra uma posição anterior. */
const ORDEM_STATUS_ENVIO: Record<NonNullable<MensagemConversa['status']>, number> = {
  pendente: 0,
  enviando: 1,
  enviado: 2,
  falhou: 2,
}

/**
 * Insere mensagem nova (INSERT) ou atualiza uma já carregada (UPDATE de
 * status, eco tardio do próprio INSERT otimista, ou o fallback de
 * verificação pontual) pelo id.
 *
 * A inserção otimista local, o INSERT do Realtime da mesma linha, os
 * UPDATEs de status (pendente → enviando → enviado/falhou) e o fallback de
 * verificação podem chegar fora de ordem no cliente — ex.: o eco do INSERT,
 * que carrega o snapshot `status: 'pendente'` de quando a linha nasceu,
 * chegando *depois* de um UPDATE que já levou pra `enviando`. Pra mensagem
 * de saída, só aceita o status novo se ele não regredir no ciclo —
 * `enviado`/`falhou` são terminais (nunca mais aceitam nada; o retry cria
 * mensagem nova) e `enviando` nunca volta pra `pendente`. Mensagem de
 * entrada não tem ciclo (`status` é sempre `null`) e passa direto por essa
 * checagem.
 */
function mesclarMensagem(atual: MensagemConversa[], nova: MensagemConversa, inserirSeNaoExistir: boolean) {
  const indice = atual.findIndex((m) => m.id === nova.id)
  if (indice === -1) return inserirSeNaoExistir ? [...atual, nova] : atual

  const existente = atual[indice]
  if (existente.status && nova.status && ORDEM_STATUS_ENVIO[nova.status] < ORDEM_STATUS_ENVIO[existente.status]) {
    return atual
  }

  const copia = [...atual]
  // `nova` pode vir de um payload crú do Realtime (sem signed URL, ver
  // `paraMensagem`) — nunca regride uma URL já resolvida por `arquivoUrl: null`.
  copia[indice] = { ...nova, arquivoUrl: nova.arquivoUrl ?? existente.arquivoUrl }
  return copia
}

/** Dia (AAAA-MM-DD, fuso São Paulo) → "Hoje" / "Ontem" / "DD/MM/AAAA" — mesma referência de fuso de `formatarHora`. */
function rotuloSeparadorData(dia: string): string {
  const hoje = hojeSaoPaulo()
  if (dia === hoje) return 'Hoje'
  if (dia === somarDias(hoje, -1)) return 'Ontem'
  return formatarDia(dia)
}

type ItemHistorico =
  | { tipo: 'separador'; dia: string }
  | { tipo: 'mensagem'; mensagem: MensagemConversa; primeiroDoGrupo: boolean }

/**
 * Deriva do array de mensagens já carregado (sem consulta nova) onde entram
 * separadores de dia e quais mensagens abrem um novo grupo visual —
 * consecutivas da mesma `direcao` no mesmo dia viram um grupo, reduzindo o
 * espaçamento entre elas (ver uso de `primeiroDoGrupo` no render).
 */
function construirItensHistorico(mensagens: MensagemConversa[]): ItemHistorico[] {
  const itens: ItemHistorico[] = []
  let diaAnterior: string | null = null
  let direcaoAnterior: MensagemConversa['direcao'] | null = null

  for (const m of mensagens) {
    const dia = diaEmSaoPaulo(m.createdAt)
    const novoDia = dia !== diaAnterior
    if (novoDia) itens.push({ tipo: 'separador', dia })

    itens.push({ tipo: 'mensagem', mensagem: m, primeiroDoGrupo: novoDia || m.direcao !== direcaoAnterior })

    diaAnterior = dia
    direcaoAnterior = m.direcao
  }

  return itens
}

/**
 * Conversa de WhatsApp do cliente — carga inicial via server action
 * (`obterConversaAction`, respeita a RLS de `conversas`/`mensagens`) e
 * atualização em tempo real via Supabase Realtime (`postgres_changes` em
 * `mensagens`, filtrado pela conversa): INSERT pra mensagem nova, UPDATE pro
 * ciclo de status de saída (pendente → enviando → enviado/falhou) que o
 * whatsapp-service grava de forma assíncrona. Envia texto (com emoji),
 * imagem, documento e áudio (gravado com `MediaRecorder`, bruto no Storage —
 * a conversão pro Ogg/Opus real do WhatsApp só acontece no whatsapp-service)
 * — câmera ainda é só o botão/menu preparado.
 */
export function PainelConversa({ card, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Posição de cursor a restaurar depois que `texto` comitar no DOM (ver `inserirEmoji`). */
  const posicaoPendenteRef = useRef<number | null>(null)
  /** Pra não aplicar o fallback de verificação (setTimeout) depois que o painel já fechou. */
  const montadoRef = useRef(true)
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' })

  useEffect(() => {
    // `useRef(true)` só vale na primeira criação do ref — nunca é
    // reaplicado numa remontagem. Em dev, o Strict Mode monta → desmonta →
    // remonta de propósito (pra pegar cleanup faltando); o cleanup abaixo
    // zera o ref, e sem este set aqui ele nunca volta a `true` na
    // remontagem real, deixando TUDO que depende de `montadoRef.current`
    // (o fallback de status, a busca de signed URL) permanentemente
    // bloqueado mesmo com o painel aberto e funcionando.
    montadoRef.current = true

    const dialog = ref.current
    dialog?.showModal()
    return () => {
      montadoRef.current = false
      dialog?.close()
    }
  }, [])

  // O painel desmonta e remonta a cada card (troca via `{conversa && <PainelConversa .../>}`
  // no Kanban), então `estado` já nasce 'carregando' — sem precisar resetar aqui.
  useEffect(() => {
    let ativo = true
    void obterConversaAction(card.clienteId).then((conversa) => {
      if (!ativo) return
      setEstado(
        conversa
          ? { status: 'pronto', conversaId: conversa.id, mensagens: conversa.mensagens }
          : { status: 'sem-conversa' },
      )
    })
    return () => {
      ativo = false
    }
  }, [card.clienteId])

  const conversaId = estado.status === 'pronto' ? estado.conversaId : null

  /**
   * Fallback pro caso do UPDATE do Realtime (pendente → enviando →
   * enviado/falhou) não chegar no próprio remetente: confere no servidor só
   * o status DESSA mensagem (uma linha, nunca a conversa inteira) a cada 1s,
   * por no máximo 30 tentativas (30s) — uma única checagem fixa não bastava
   * porque o envio pode demorar mais do que o intervalo escolhido. Para
   * assim que o status real vier `enviado`/`falhou` (aplicado via
   * `mesclarMensagem`, que já impede regressão) ou ao esgotar as tentativas;
   * nunca "assume" um status, só usa o que o banco devolve.
   */
  function agendarVerificacaoStatus(id: string) {
    let tentativas = 0

    const intervalo = setInterval(async () => {
      tentativas += 1

      if (!montadoRef.current) {
        clearInterval(intervalo)
        return
      }

      const status = await obterStatusMensagemAction(id)
      if (!montadoRef.current) {
        clearInterval(intervalo)
        return
      }

      if (status === 'enviado' || status === 'falhou') {
        clearInterval(intervalo)
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          const existente = atual.mensagens.find((m) => m.id === id)
          if (!existente) return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, { ...existente, status }, false) }
        })
        return
      }

      if (tentativas >= TENTATIVAS_MAX_VERIFICACAO) clearInterval(intervalo)
    }, INTERVALO_VERIFICACAO_MS)
  }

  const [texto, setTexto] = useState('')
  const [estadoEnvio, formAction, enviando] = useActionState(
    async (_anterior: EstadoEnvioMensagem | undefined, formData: FormData) => {
      if (!conversaId) return { erro: 'Conversa não encontrada.' }
      const resultado = await enviarMensagemAction(conversaId, _anterior, formData)
      if (resultado.ok && resultado.id && resultado.createdAt) {
        setTexto('')
        // Mostra a própria mensagem na hora — não espera o Realtime (que
        // só chega de volta depois). `mesclarMensagem` descarta por id se o
        // evento do Realtime também chegar depois, então não duplica.
        const nova: MensagemConversa = {
          id: resultado.id,
          direcao: 'saida',
          tipo: 'texto',
          conteudo: resultado.conteudo ?? '',
          status: 'pendente',
          createdAt: resultado.createdAt,
          arquivoUrl: null,
          arquivoNome: null,
          arquivoDuracaoSegundos: null,
        }
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
        })
        agendarVerificacaoStatus(resultado.id)
      }
      return resultado
    },
    undefined,
  )

  /** Imagem escolhida no `AnexoMenu`, ainda não enviada — preview local (blob) até a confirmação do servidor. */
  const [imagemSelecionada, setImagemSelecionada] = useState<{ arquivo: File; preview: string } | null>(null)

  // Libera a blob URL ao trocar de imagem ou cancelar — nunca ao trocar de `estado`/mensagens.
  useEffect(() => {
    return () => {
      if (imagemSelecionada) URL.revokeObjectURL(imagemSelecionada.preview)
    }
  }, [imagemSelecionada])

  const [estadoEnvioImagem, formActionImagem, enviandoImagem] = useActionState(
    async (_anterior: EstadoEnvioMensagem | undefined, formData: FormData) => {
      if (!conversaId) return { erro: 'Conversa não encontrada.' }
      const resultado = await enviarMensagemImagemAction(conversaId, _anterior, formData)
      if (resultado.ok && resultado.id && resultado.createdAt) {
        setTexto('')
        setImagemSelecionada(null)
        const nova: MensagemConversa = {
          id: resultado.id,
          direcao: 'saida',
          tipo: 'imagem',
          conteudo: resultado.conteudo ?? null,
          status: 'pendente',
          createdAt: resultado.createdAt,
          arquivoUrl: resultado.arquivoUrl ?? null,
          arquivoNome: null,
          arquivoDuracaoSegundos: null,
        }
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
        })
        agendarVerificacaoStatus(resultado.id)
      }
      return resultado
    },
    undefined,
  )

  /** Documento escolhido no `AnexoMenu`, ainda não enviado — sem preview de imagem, só nome/tamanho (ver `aoSelecionarDocumento`). */
  const [documentoSelecionado, setDocumentoSelecionado] = useState<{ arquivo: File } | null>(null)

  const [estadoEnvioDocumento, formActionDocumento, enviandoDocumento] = useActionState(
    async (_anterior: EstadoEnvioMensagem | undefined, formData: FormData) => {
      if (!conversaId) return { erro: 'Conversa não encontrada.' }
      const resultado = await enviarMensagemDocumentoAction(conversaId, _anterior, formData)
      if (resultado.ok && resultado.id && resultado.createdAt) {
        setTexto('')
        setDocumentoSelecionado(null)
        const nova: MensagemConversa = {
          id: resultado.id,
          direcao: 'saida',
          tipo: 'documento',
          conteudo: resultado.conteudo ?? null,
          status: 'pendente',
          createdAt: resultado.createdAt,
          arquivoUrl: resultado.arquivoUrl ?? null,
          arquivoNome: resultado.arquivoNome ?? null,
          arquivoDuracaoSegundos: null,
        }
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
        })
        agendarVerificacaoStatus(resultado.id)
      }
      return resultado
    },
    undefined,
  )

  /**
   * Gravação de áudio: `MediaRecorder.isTypeSupported` decide o formato
   * bruto por navegador — nunca o que vai pro Baileys (isso é conversão no
   * whatsapp-service). `MediaRecorder`/`MediaStream` são objetos mutáveis
   * da Web API (seta `onstop` neles, chama `.stop()`) — nunca ficam dentro
   * do `useState`, que o React trata como imutável; só o ref abaixo.
   */
  type GravacaoAudio = { fase: 'gravando' } | { fase: 'pronta'; blob: Blob; duracaoSegundos: number; preview: string }

  const [gravacaoAudio, setGravacaoAudio] = useState<GravacaoAudio | null>(null)
  const [tempoGravacao, setTempoGravacao] = useState(0)
  const [erroGravacao, setErroGravacao] = useState<string | null>(null)
  const chunksGravacaoRef = useRef<Blob[]>([])
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; mimeType: string } | null>(null)
  /**
   * Cópia só-leitura do stream ativo, pra renderizar `<WaveformGravacao>` —
   * refs nunca podem ser lidos durante a renderização (só em efeitos/
   * handlers), então o stream "de trabalho" continua exclusivamente em
   * `recorderRef`; esta variável nunca é mutada, só passada como prop.
   */
  const [streamAtivo, setStreamAtivo] = useState<MediaStream | null>(null)

  // Libera a blob URL do preview ao trocar/cancelar — mesma lógica de `imagemSelecionada`.
  useEffect(() => {
    return () => {
      if (gravacaoAudio?.fase === 'pronta') URL.revokeObjectURL(gravacaoAudio.preview)
    }
  }, [gravacaoAudio])

  // Se o painel inteiro fechar enquanto ainda está gravando (sem passar por
  // cancelarGravacao/pararGravacao — ex.: clicar no X do cabeçalho), o
  // microfone nunca seria liberado: `recorderRef` é um ref, não é limpo por
  // nenhum outro efeito. Roda só na desmontagem (array vazio).
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.recorder.stop()
        recorderRef.current.stream.getTracks().forEach((t) => t.stop())
        recorderRef.current = null
      }
    }
  }, [])

  // Cronômetro — só roda enquanto estiver de fato gravando.
  useEffect(() => {
    if (gravacaoAudio?.fase !== 'gravando') return
    const intervalo = setInterval(() => setTempoGravacao((t) => t + 1), 1000)
    return () => clearInterval(intervalo)
  }, [gravacaoAudio])

  const [estadoEnvioAudio, formActionAudio, enviandoAudio] = useActionState(
    async (_anterior: EstadoEnvioMensagem | undefined, formData: FormData) => {
      if (!conversaId) return { erro: 'Conversa não encontrada.' }
      const resultado = await enviarMensagemAudioAction(conversaId, _anterior, formData)
      if (resultado.ok && resultado.id && resultado.createdAt) {
        setGravacaoAudio(null)
        const nova: MensagemConversa = {
          id: resultado.id,
          direcao: 'saida',
          tipo: 'audio',
          conteudo: null,
          status: 'pendente',
          createdAt: resultado.createdAt,
          arquivoUrl: resultado.arquivoUrl ?? null,
          arquivoNome: null,
          arquivoDuracaoSegundos: resultado.arquivoDuracaoSegundos ?? null,
        }
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
        })
        agendarVerificacaoStatus(resultado.id)
      }
      return resultado
    },
    undefined,
  )

  /** "Tentar novamente" numa mensagem de TEXTO `falhou` — reaproveita o mesmo envio (nova mensagem pendente). Imagem não tem retry nesta fase. */
  function reenviar(conteudo: string) {
    const formData = new FormData()
    formData.set('texto', conteudo)
    startTransition(() => formAction(formData))
  }

  /**
   * "Tentar novamente" numa mensagem de MÍDIA (documento ou áudio) `falhou`
   * — reaproveita o arquivo já no Storage, sem subir de novo. Genérico por
   * `tipo`: `reenviarMensagemMidiaAction` devolve o tipo da mensagem original,
   * a UI não precisa saber de antemão qual mídia está sendo reenviada.
   * Imagem não tem retry nesta fase (ver `AnexoMenu`).
   */
  function reenviarMidia(mensagemId: string) {
    void reenviarMensagemMidiaAction(mensagemId).then((resultado) => {
      if (!resultado.ok || !resultado.id || !resultado.createdAt || !resultado.tipo) return
      const nova: MensagemConversa = {
        id: resultado.id,
        direcao: 'saida',
        tipo: resultado.tipo,
        conteudo: resultado.conteudo ?? null,
        status: 'pendente',
        createdAt: resultado.createdAt,
        arquivoUrl: resultado.arquivoUrl ?? null,
        arquivoNome: resultado.arquivoNome ?? null,
        arquivoDuracaoSegundos: resultado.arquivoDuracaoSegundos ?? null,
      }
      setEstado((atual) => {
        if (atual.status !== 'pronto') return atual
        return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
      })
      agendarVerificacaoStatus(resultado.id)
    })
  }

  function selecionarImagem(arquivo: File) {
    setDocumentoSelecionado(null)
    setImagemSelecionada({ arquivo, preview: URL.createObjectURL(arquivo) })
  }

  function cancelarImagem() {
    setImagemSelecionada(null)
  }

  function selecionarDocumento(arquivo: File) {
    setImagemSelecionada(null)
    setDocumentoSelecionado({ arquivo })
  }

  function cancelarDocumento() {
    setDocumentoSelecionado(null)
  }

  /**
   * Escolhe o MIME de gravação por suporte real do navegador, nunca por
   * sniffing de user-agent — `isTypeSupported` já devolve exatamente o que
   * cada engine aceita: Chrome/Edge só webm;codecs=opus, Firefox aceita os
   * dois (ogg primeiro na lista, então é o que ele escolhe), Safari/iOS só
   * mp4. O formato bruto nunca é o que vai pro Baileys — isso é conversão no
   * whatsapp-service (ffmpeg), sempre pra Ogg/Opus real.
   */
  function escolherMimeGravacao(): string | null {
    if (typeof MediaRecorder === 'undefined') return null
    const candidatos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4']
    return candidatos.find((tipo) => MediaRecorder.isTypeSupported(tipo)) ?? null
  }

  /** Pede o microfone só agora (nunca antes do clique) e começa a gravar. Impede gravação simultânea. */
  async function iniciarGravacao() {
    if (gravacaoAudio) return
    setErroGravacao(null)

    const mimeType = escolherMimeGravacao()
    if (!mimeType) {
      setErroGravacao('Seu navegador não suporta gravação de áudio.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setErroGravacao('Não foi possível acessar o microfone.')
      return
    }

    const recorder = new MediaRecorder(stream, { mimeType })
    chunksGravacaoRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksGravacaoRef.current.push(e.data)
    }
    recorder.start()
    recorderRef.current = { recorder, stream, mimeType }
    setTempoGravacao(0)
    setStreamAtivo(stream)
    setGravacaoAudio({ fase: 'gravando' })
  }

  /** Para a gravação. `enviar=false` descarta (cancelar); `enviar=true` monta o blob pra revisão antes do envio de fato. */
  function pararGravacao(enviar: boolean) {
    if (gravacaoAudio?.fase !== 'gravando' || !recorderRef.current) return
    const { recorder, stream, mimeType } = recorderRef.current
    const duracaoFinal = tempoGravacao

    recorder.onstop = () => {
      // Libera o microfone sempre — cancelando ou enviando, nunca fica preso.
      stream.getTracks().forEach((t) => t.stop())
      recorderRef.current = null
      setStreamAtivo(null)

      if (!enviar) {
        setGravacaoAudio(null)
        return
      }

      const blob = new Blob(chunksGravacaoRef.current, { type: mimeType })
      setGravacaoAudio({ fase: 'pronta', blob, duracaoSegundos: duracaoFinal, preview: URL.createObjectURL(blob) })
    }
    recorder.stop()
  }

  function cancelarGravacao() {
    if (gravacaoAudio?.fase === 'gravando') {
      pararGravacao(false)
    } else {
      setGravacaoAudio(null)
    }
  }

  /** Insere o emoji na posição do cursor (não no final) — o foco é devolvido no `useLayoutEffect` abaixo. */
  function inserirEmoji(emoji: string) {
    const campo = textareaRef.current
    const inicio = campo?.selectionStart ?? texto.length
    const fim = campo?.selectionEnd ?? texto.length

    posicaoPendenteRef.current = inicio + emoji.length
    setTexto(texto.slice(0, inicio) + emoji + texto.slice(fim))
  }

  // Roda assim que `texto` comita no DOM (antes da pintura) — não depende de
  // rAF nem de quando o popover de emoji devolve ou não o foco, só do React
  // ter aplicado o novo valor na textarea.
  useLayoutEffect(() => {
    const posicao = posicaoPendenteRef.current
    if (posicao === null) return
    posicaoPendenteRef.current = null
    const campo = textareaRef.current
    campo?.focus()
    campo?.setSelectionRange(posicao, posicao)
  }, [texto])

  // Cresce com o conteúdo (digitado, emoji inserido ou campo limpo depois do
  // envio) até ALTURA_MAX_TEXTAREA; depois disso, rola por dentro.
  useEffect(() => {
    const campo = textareaRef.current
    if (!campo) return
    campo.style.height = 'auto'
    campo.style.height = `${Math.min(campo.scrollHeight, ALTURA_MAX_TEXTAREA)}px`
  }, [texto])

  /**
   * Canal de Realtime da conversa, com reconexão controlada. Sem isso, um
   * canal que cai (CHANNEL_ERROR/TIMED_OUT) ou fecha sem ter sido este efeito
   * quem pediu (CLOSED) fica morto pro resto da sessão — nada avisa, e o
   * fallback por mensagem (acima) é curto demais pra cobrir isso sozinho.
   *
   * `geracao` invalida o callback de um canal já substituído: ao reconectar
   * ou desmontar, o canal antigo ainda pode emitir um 'CLOSED' tardio (efeito
   * do nosso próprio `removeChannel`), e sem essa checagem esse eco agendaria
   * uma reconexão duplicada. Backoff exponencial (1s, 2s, 4s, ... até 30s)
   * evita martelar o servidor numa queda persistente; zera a cada
   * `SUBSCRIBED`. Nunca faz polling da conversa — só resubscreve os mesmos
   * listeners INSERT/UPDATE; o que tiver sido perdido no intervalo chega
   * depois por INSERT/UPDATE de novo ou pelo fallback por mensagem, e
   * `mesclarMensagem` já deduplica por id.
   */
  useEffect(() => {
    if (!conversaId) return

    const supabase = createClient()
    let desmontado = false
    let canalAtual: ReturnType<typeof supabase.channel> | null = null
    let timeoutReconexao: ReturnType<typeof setTimeout> | null = null
    let tentativas = 0
    let geracao = 0

    function conectar() {
      geracao += 1
      const minhaGeracao = geracao

      const canalAnterior = canalAtual
      canalAtual = null
      if (canalAnterior) void supabase.removeChannel(canalAnterior)

      canalAtual = supabase
        .channel(`mensagens-conversa-${conversaId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversaId}` },
          (payload) => {
            const nova = paraMensagem(payload.new as LinhaMensagem)
            setEstado((atual) => {
              if (atual.status !== 'pronto') return atual
              return { ...atual, mensagens: mesclarMensagem(atual.mensagens, nova, true) }
            })
          },
        )
        .on(
          // O whatsapp-service faz pendente → enviando → enviado/falhou via UPDATE
          // nesta mesma linha; é só isso que chega aqui (conteúdo não muda depois do INSERT).
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversaId}` },
          (payload) => {
            const atualizada = paraMensagem(payload.new as LinhaMensagem)
            setEstado((atual) => {
              if (atual.status !== 'pronto') return atual
              return { ...atual, mensagens: mesclarMensagem(atual.mensagens, atualizada, false) }
            })
          },
        )
        .subscribe((status) => {
          if (minhaGeracao !== geracao) return // canal já substituído — eco do removeChannel acima

          if (status === 'SUBSCRIBED') {
            tentativas = 0
            return
          }

          if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (desmontado) return

            const espera = Math.min(1000 * 2 ** tentativas, 30_000)
            tentativas += 1
            console.error(
              `[realtime] canal da conversa caiu (${status}) — reconectando em ${espera}ms (tentativa ${tentativas})`,
            )
            timeoutReconexao = setTimeout(() => {
              if (!desmontado) conectar()
            }, espera)
          }
        })
    }

    conectar()

    return () => {
      desmontado = true
      geracao += 1 // invalida qualquer callback do canal atual que ainda não tenha chegado
      if (timeoutReconexao) clearTimeout(timeoutReconexao)
      if (canalAtual) void supabase.removeChannel(canalAtual)
    }
  }, [conversaId])

  const mensagens = estado.status === 'pronto' ? estado.mensagens : []
  const itensHistorico = construirItensHistorico(mensagens)

  /** Ids com busca de signed URL em andamento — evita repetir a mesma chamada a cada render. */
  const buscandoUrlRef = useRef<Set<string>>(new Set())

  // Mensagem de imagem/documento chegada pelo Realtime nasce sem
  // `arquivoUrl` (o payload só traz as colunas da linha, nunca uma signed
  // URL — ver `paraMensagem`). Busca sob demanda por id, nunca a partir de
  // um caminho vindo do cliente. Áudio fica de fora: `PlayerAudio` busca a
  // própria signed URL só no primeiro play, nunca antes — pré-buscar aqui
  // só desperdiçaria uma URL que expira em 5 min bem antes de alguém clicar.
  useEffect(() => {
    if (estado.status !== 'pronto') return
    const faltantes = estado.mensagens.filter(
      (m) => (m.tipo === 'imagem' || m.tipo === 'documento') && !m.arquivoUrl && !buscandoUrlRef.current.has(m.id),
    )
    if (faltantes.length === 0) return

    for (const m of faltantes) {
      buscandoUrlRef.current.add(m.id)
      void obterUrlAnexoAction(m.id).then((url) => {
        if (!montadoRef.current || !url) return
        setEstado((atual) => {
          if (atual.status !== 'pronto') return atual
          const existente = atual.mensagens.find((x) => x.id === m.id)
          if (!existente) return atual
          return { ...atual, mensagens: mesclarMensagem(atual.mensagens, { ...existente, arquivoUrl: url }, false) }
        })
      })
    }
  }, [estado])

  useEffect(() => {
    const lista = listaRef.current
    if (lista) lista.scrollTop = lista.scrollHeight
  }, [mensagens.length])

  return (
    <dialog
      ref={ref}
      aria-labelledby="painel-conversa-titulo"
      onCancel={(e) => {
        e.preventDefault()
        onFechar()
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 sm:w-[48vw] sm:min-w-[420px] dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
              <span aria-hidden>●</span> WhatsApp
            </p>
            {card.clienteEmpresa && (
              <p className="truncate text-base font-semibold" title={card.clienteEmpresa}>
                {card.clienteEmpresa}
              </p>
            )}
            <p
              id="painel-conversa-titulo"
              className={`truncate ${card.clienteEmpresa ? 'text-sm text-zinc-500' : 'text-base font-semibold'}`}
              title={card.clienteNome}
            >
              {card.clienteNome}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar conversa"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </header>

        <div ref={listaRef} className="flex-1 overflow-y-auto p-4">
          {estado.status === 'carregando' && (
            <p className="text-center text-sm text-zinc-500">Carregando…</p>
          )}

          {estado.status !== 'carregando' && mensagens.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-sm text-zinc-500">Nenhuma mensagem ainda.</p>
            </div>
          )}

          {mensagens.length > 0 && (
            <ul>
              {itensHistorico.map((item) => {
                if (item.tipo === 'separador') {
                  return (
                    <li key={`dia-${item.dia}`} className="my-3 flex justify-center first:mt-0">
                      <span className="rounded-full bg-zinc-200/70 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
                        {rotuloSeparadorData(item.dia)}
                      </span>
                    </li>
                  )
                }

                const m = item.mensagem
                return (
                  <li
                    key={m.id}
                    className={`flex ${m.direcao === 'saida' ? 'justify-end' : 'justify-start'} ${
                      item.primeiroDoGrupo ? 'mt-3 first:mt-0' : 'mt-0.5'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        m.direcao === 'saida'
                          ? `bg-green-600 text-white ${item.primeiroDoGrupo ? 'rounded-tr-sm' : ''}`
                          : `bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 ${item.primeiroDoGrupo ? 'rounded-tl-sm' : ''}`
                      }`}
                    >
                    {m.tipo === 'imagem' &&
                      (m.arquivoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- bucket privado, signed URL com token e TTL curtos; não é um candidato a next/image
                        <img
                          src={m.arquivoUrl}
                          alt={m.arquivoNome ?? 'Imagem'}
                          className="mb-1 max-h-72 w-full rounded-md object-contain"
                        />
                      ) : (
                        <p className="mb-1 text-xs italic opacity-70">Carregando imagem…</p>
                      ))}
                    {m.tipo === 'documento' &&
                      (m.arquivoUrl ? (
                        <a
                          href={m.arquivoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={m.arquivoNome ?? undefined}
                          className={`mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                            m.direcao === 'saida'
                              ? 'bg-black/10 hover:bg-black/15'
                              : 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15'
                          }`}
                        >
                          <span aria-hidden className="text-xl">📄</span>
                          <span className="truncate">{m.arquivoNome ?? 'Documento'}</span>
                        </a>
                      ) : (
                        <p className="mb-1 text-xs italic opacity-70">Carregando documento…</p>
                      ))}
                    {m.tipo === 'audio' && (
                      <PlayerAudio mensagemId={m.id} duracaoInicial={m.arquivoDuracaoSegundos} />
                    )}
                    {m.conteudo && <p className="whitespace-pre-wrap">{m.conteudo}</p>}
                    <p
                      className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] ${
                        m.direcao === 'saida' ? 'text-green-100' : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {formatarHora(m.createdAt)}
                      {m.direcao === 'saida' && m.status && <span>· {ROTULO_STATUS_ENVIO[m.status]}</span>}
                    </p>
                    {m.direcao === 'saida' && m.status === 'falhou' && m.tipo === 'texto' && (
                      <button
                        type="button"
                        onClick={() => reenviar(m.conteudo ?? '')}
                        disabled={enviando}
                        className="mt-1 text-[11px] font-medium text-green-100 underline decoration-dotted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Tentar novamente
                      </button>
                    )}
                    {m.direcao === 'saida' &&
                      m.status === 'falhou' &&
                      (m.tipo === 'documento' || m.tipo === 'audio') && (
                        <button
                          type="button"
                          onClick={() => reenviarMidia(m.id)}
                          disabled={enviandoDocumento || enviandoAudio}
                          className="mt-1 text-[11px] font-medium text-green-100 underline decoration-dotted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Tentar novamente
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <form
          className="flex flex-col gap-1.5 border-t border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault()
            const formData = new FormData(e.currentTarget)
            if (imagemSelecionada) {
              formData.set('arquivo', imagemSelecionada.arquivo)
              startTransition(() => formActionImagem(formData))
              return
            }
            if (documentoSelecionado) {
              formData.set('arquivo', documentoSelecionado.arquivo)
              startTransition(() => formActionDocumento(formData))
              return
            }
            if (gravacaoAudio?.fase === 'pronta') {
              formData.set('arquivo', gravacaoAudio.blob, 'gravacao')
              formData.set('duracao', String(gravacaoAudio.duracaoSegundos))
              startTransition(() => formActionAudio(formData))
              return
            }
            if (!texto.trim()) return
            startTransition(() => formAction(formData))
          }}
        >
          {(estadoEnvio?.erro ??
            estadoEnvioImagem?.erro ??
            estadoEnvioDocumento?.erro ??
            estadoEnvioAudio?.erro ??
            erroGravacao) && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {estadoEnvio?.erro ?? estadoEnvioImagem?.erro ?? estadoEnvioDocumento?.erro ?? estadoEnvioAudio?.erro ?? erroGravacao}
            </p>
          )}
          {imagemSelecionada && (
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL), nunca passa por next/image */}
              <img
                src={imagemSelecionada.preview}
                alt=""
                className="h-14 w-14 shrink-0 rounded object-cover"
              />
              <p className="flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {imagemSelecionada.arquivo.name}
              </p>
              <button
                type="button"
                onClick={cancelarImagem}
                disabled={enviandoImagem}
                aria-label="Remover imagem"
                className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          )}
          {documentoSelecionado && (
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
              <span aria-hidden className="text-2xl">📄</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {documentoSelecionado.arquivo.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {(documentoSelecionado.arquivo.name.split('.').pop() ?? '').toUpperCase()} ·{' '}
                  {formatarTamanhoArquivo(documentoSelecionado.arquivo.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={cancelarDocumento}
                disabled={enviandoDocumento}
                aria-label="Remover documento"
                className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          )}
          {gravacaoAudio?.fase === 'pronta' && (
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
              <div className="flex-1">
                <PlayerAudio srcLocal={gravacaoAudio.preview} duracaoInicial={gravacaoAudio.duracaoSegundos} />
              </div>
              <button
                type="button"
                onClick={cancelarGravacao}
                disabled={enviandoAudio}
                aria-label="Remover áudio"
                className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          )}
          {gravacaoAudio?.fase === 'gravando' ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelarGravacao}
                aria-label="Cancelar gravação"
                className="shrink-0 rounded-md p-2 text-lg leading-none text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                🗑️
              </button>
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                <span aria-hidden className="size-2 animate-pulse rounded-full bg-red-600" />
                {formatarContador(tempoGravacao)}
              </span>
              {streamAtivo && <WaveformGravacao stream={streamAtivo} />}
              <button
                type="button"
                onClick={() => pararGravacao(true)}
                aria-label="Parar gravação e revisar"
                className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition dark:bg-zinc-100 dark:text-zinc-900"
              >
                Concluir
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-1">
              <EmojiPopover onEscolher={inserirEmoji} disabled={!conversaId} />
              <AnexoMenu
                disabled={!conversaId || enviandoImagem || enviandoDocumento || gravacaoAudio?.fase === 'pronta'}
                onSelecionarImagem={selecionarImagem}
                onSelecionarDocumento={selecionarDocumento}
              />
              <textarea
                ref={textareaRef}
                name="texto"
                rows={1}
                placeholder={
                  imagemSelecionada || documentoSelecionado
                    ? 'Legenda (opcional)…'
                    : gravacaoAudio?.fase === 'pronta'
                      ? 'Áudio gravado — sem legenda'
                      : 'Escreva uma mensagem…'
                }
                aria-label={imagemSelecionada || documentoSelecionado ? 'Legenda do anexo' : 'Mensagem'}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Enter envia; Shift+Enter quebra linha (comportamento padrão do textarea).
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (imagemSelecionada || documentoSelecionado || gravacaoAudio?.fase === 'pronta' || texto.trim()) {
                      e.currentTarget.form?.requestSubmit()
                    }
                  }
                }}
                disabled={!conversaId || gravacaoAudio?.fase === 'pronta'}
                className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
              />
              {imagemSelecionada || documentoSelecionado || gravacaoAudio?.fase === 'pronta' || texto.trim() ? (
                <button
                  type="submit"
                  disabled={!conversaId || enviando || enviandoImagem || enviandoDocumento || enviandoAudio}
                  className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {enviando || enviandoImagem || enviandoDocumento || enviandoAudio ? 'Enviando…' : 'Enviar'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={iniciarGravacao}
                  disabled={!conversaId}
                  aria-label="Gravar áudio"
                  title="Gravar áudio"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <IconeMicrofone />
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </dialog>
  )
}
