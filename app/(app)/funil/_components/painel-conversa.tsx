'use client'

import { startTransition, useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  enviarMensagemAction,
  enviarMensagemAudioAction,
  enviarMensagemDocumentoAction,
  enviarMensagemImagemAction,
  excluirMensagensParaMimAction,
  obterConversaAction,
  obterMensagensAntigasAction,
  obterReacoesDaConversaAction,
  obterStatusMensagemAction,
  obterUrlAnexoAction,
  obterUsuarioAtualIdAction,
  reagirMensagemAction,
  reenviarMensagemMidiaAction,
  removerReacaoAction,
  type EstadoEnvioMensagem,
} from '@/lib/actions/conversas'
import type { MensagemConversa, MensagemEncaminhada, ReacaoMensagem } from '@/lib/dal/conversas'
import { topicoConversa, useEmpresaAtual } from '@/components/layout/empresa-contexto'
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
import { MenuMensagem } from './menu-mensagem'
import { ModalEncaminhar } from './modal-encaminhar'
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
  /** Carga inicial (`obterConversaAction`) rejeitou — nunca fica preso em `carregando` silenciosamente; `tentarCarregarNovamente` refaz a mesma busca. */
  | { status: 'erro'; mensagem: string }
  | {
      status: 'pronto'
      conversaId: string
      mensagens: MensagemConversa[]
      /** `true` quando ainda pode haver mensagens mais antigas que a primeira carregada (ver `carregarMensagensAntigas`). */
      temMensagensAntigas: boolean
    }

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
  resposta_a_id: string | null
  resposta_a_tipo: MensagemConversa['tipo'] | null
  resposta_a_conteudo: string | null
  resposta_a_direcao: MensagemConversa['direcao'] | null
  encaminhada_de_id: string | null
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
    respostaA: linha.resposta_a_id
      ? {
          id: linha.resposta_a_id,
          tipo: linha.resposta_a_tipo as MensagemConversa['tipo'],
          conteudo: linha.resposta_a_conteudo,
          direcao: linha.resposta_a_direcao as MensagemConversa['direcao'],
        }
      : null,
    encaminhada: linha.encaminhada_de_id !== null,
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

/** Mesmo traço (2px) dos outros ícones locais — seta encurvada, mesmo símbolo do WhatsApp Web pra "encaminhar"/"encaminhada". */
function IconeEncaminhar({ className = 'size-4' }: { className?: string }) {
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
      <path d="m14 5 6 6-6 6" />
      <path d="M4 5v4a4 4 0 0 0 4 4h12" />
    </svg>
  )
}

function IconeLixeira({ className = 'size-4' }: { className?: string }) {
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
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.1a2 2 0 0 1-2 1.9H9.8a2 2 0 0 1-2-1.9L7 7" />
    </svg>
  )
}

function IconeCheck({ className = 'size-3' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M5 12.5 9.5 17 19 7" />
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

/**
 * Rótulo acessível (`title`/`aria-label`) do ícone de status — nunca visível
 * como texto solto na bolha, só leitor de tela/tooltip. "Enviado" aqui nunca
 * vira "Entregue"/"Lido": o estado `enviado` continua significando só que o
 * whatsapp-service teve sucesso no `sendMessage`, nada sobre o aparelho do
 * destinatário (ver `IconeStatusEnvio`, abaixo).
 */
const ROTULO_STATUS_ENVIO: Record<NonNullable<MensagemConversa['status']>, string> = {
  pendente: 'Enviando…',
  enviando: 'Enviando…',
  enviado: 'Enviado',
  falhou: 'Falha no envio',
}

/**
 * Indicador compacto de status, ícone junto ao horário — mesmo traço (2px,
 * `currentColor`) dos outros ícones locais deste arquivo (`IconeMicrofone`).
 * Só muda o FORMATO por estado, nunca a cor: o texto original também não
 * diferenciava cor por status, só a palavra/símbolo — manter esse mesmo peso
 * visual, só compactado. Deliberadamente sem ✓✓ (duplo check) nem azul: isso
 * sugeriria entregue/lido, que este estado nunca significou.
 */
function IconeStatusEnvio({ status }: { status: NonNullable<MensagemConversa['status']> }) {
  if (status === 'pendente' || status === 'enviando') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-3 shrink-0 animate-spin">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} opacity="0.35" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
    )
  }

  if (status === 'enviado') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="size-3.5 shrink-0"
      >
        <path d="M5 12.5 9.5 17 19 7" />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-3.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5v.01" />
    </svg>
  )
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

/** Linha crua do Realtime pra `mensagem_reacoes` — sem `conversa_id` (schema mínimo, ver migration 20261007160000). */
type LinhaReacao = {
  mensagem_id: string
  usuario_id: string
  emoji: string
}

/**
 * Upsert local de uma reação vinda do Realtime (INSERT ou UPDATE — troca de
 * emoji é só um UPDATE na mesma linha) — substitui a reação anterior dessa
 * pessoa nessa mensagem, nunca duplica. O payload cru não traz o nome do
 * usuário (só a carga em lote inicial faz esse join) — reaproveita o nome
 * já conhecido de outra reação da mesma pessoa nesta conversa, se houver.
 */
function mesclarReacao(atual: ReacaoMensagem[], linha: LinhaReacao): ReacaoMensagem[] {
  const nomeConhecido = atual.find((r) => r.usuarioId === linha.usuario_id)?.usuarioNome ?? 'Alguém'
  const semAntiga = atual.filter((r) => !(r.mensagemId === linha.mensagem_id && r.usuarioId === linha.usuario_id))
  return [...semAntiga, { mensagemId: linha.mensagem_id, usuarioId: linha.usuario_id, usuarioNome: nomeConhecido, emoji: linha.emoji }]
}

type GrupoReacao = { emoji: string; contagem: number; nomes: string[]; minha: boolean }

/** Agrupa reações cruas por emoji pra exibir embaixo da bolha — pura, recalculada no render a partir de `reacoesPorMensagem`. */
function agruparReacoes(lista: ReacaoMensagem[], usuarioAtualId: string | null): GrupoReacao[] {
  const grupos = new Map<string, GrupoReacao>()
  for (const r of lista) {
    const grupo = grupos.get(r.emoji)
    if (grupo) {
      grupo.contagem += 1
      grupo.nomes.push(r.usuarioNome)
      if (r.usuarioId === usuarioAtualId) grupo.minha = true
    } else {
      grupos.set(r.emoji, { emoji: r.emoji, contagem: 1, nomes: [r.usuarioNome], minha: r.usuarioId === usuarioAtualId })
    }
  }
  return [...grupos.values()]
}

/**
 * Prependa um lote de mensagens antigas (já em ordem cronológica) no início
 * do array — nunca no fim, nunca via `mesclarMensagem` (que é pra update
 * pontual de uma linha já existente ou inserção no fim). Filtra por id
 * qualquer sobreposição com o que já está carregado: defesa barata contra
 * uma mensagem que, por algum motivo, já tenha chegado por outro caminho
 * (Realtime, fallback de status) entre o pedido da página e a resposta —
 * nunca duplica, mesmo nesse caso raro.
 */
function prependarAntigas(atual: MensagemConversa[], antigas: MensagemConversa[]): MensagemConversa[] {
  const idsExistentes = new Set(atual.map((m) => m.id))
  const novas = antigas.filter((m) => !idsExistentes.has(m.id))
  if (novas.length === 0) return atual
  return [...novas, ...atual]
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
  const empresa = useEmpresaAtual()
  const ref = useRef<HTMLDialogElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Posição de cursor a restaurar depois que `texto` comitar no DOM (ver `inserirEmoji`). */
  const posicaoPendenteRef = useRef<number | null>(null)
  /** Pra não aplicar o fallback de verificação (setTimeout) depois que o painel já fechou. */
  const montadoRef = useRef(true)
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' })
  /**
   * Espelho síncrono de `estado`, sempre atualizado no corpo do render —
   * `carregarMensagensAntigas` é chamada de dentro do callback do
   * `IntersectionObserver` (efeito que só reconfigura quando `conversaId`
   * muda, nunca a cada mensagem nova), então ler `estado` direto ali
   * capturaria um snapshot velho. Ler `estadoRef.current` em vez disso
   * garante o cursor (primeira mensagem carregada) sempre atual.
   */
  const estadoRef = useRef(estado)
  useEffect(() => {
    estadoRef.current = estado
  }, [estado])
  const sentinelaTopoRef = useRef<HTMLDivElement>(null)
  const [carregandoAntigas, setCarregandoAntigas] = useState(false)
  /** Reações de TODA a conversa (nunca por página) — buscada uma vez na carga inicial, mantida via Realtime (ver efeito do canal). */
  const [reacoes, setReacoes] = useState<ReacaoMensagem[]>([])
  /** Mensagem sendo respondida no composer — `null` fora do modo resposta. */
  const [respostaAtiva, setRespostaAtiva] = useState<MensagemConversa | null>(null)
  const [modoSelecao, setModoSelecao] = useState(false)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  /** Id da mensagem com o feedback "Copiado" visível agora — `null` a maior parte do tempo. */
  const [copiadoId, setCopiadoId] = useState<string | null>(null)
  const timeoutCopiadoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modalEncaminhar, setModalEncaminhar] = useState<{ mensagemIds: string[] } | null>(null)
  /** Só pra saber se uma reação já carregada é a própria (destacar/remover com 1 clique) — nunca usado pra autorização. */
  const [usuarioAtualId, setUsuarioAtualId] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    void obterUsuarioAtualIdAction().then((id) => ativo && setUsuarioAtualId(id))
    return () => {
      ativo = false
    }
  }, [])
  /** Guarda de concorrência lida de dentro do observer — `carregandoAntigas` (estado) não está disponível ali sem recriar o observer a cada render. */
  const carregandoAntigasRef = useRef(false)
  /** Scroll a restaurar depois que um lote de mensagens antigas prependar — consumido e limpo no `useLayoutEffect` de scroll, abaixo. */
  const preservarScrollRef = useRef<{ scrollTopAntes: number; scrollHeightAntes: number } | null>(null)
  /** Id da última mensagem no render anterior — só ele dispara o auto-scroll-pro-fim, nunca o tamanho do array (ver `useLayoutEffect` de scroll). */
  const ultimoIdRef = useRef<string | null>(null)

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

  /** Incrementado por `tentarCarregarNovamente` — só existe pra forçar o efeito de carga abaixo a rodar de novo sem depender de trocar de card. */
  const [tentativaCarga, setTentativaCarga] = useState(0)

  // O painel desmonta e remonta a cada card (troca via `{conversa && <PainelConversa .../>}`
  // no Kanban), então `estado` já nasceria 'carregando' nesse caso — mas numa
  // nova tentativa (retry manual, mesmo card) o painel NÃO remonta, então o
  // reset pra 'carregando' precisa ser explícito aqui também.
  useEffect(() => {
    let ativo = true
    void obterConversaAction(card.clienteId)
      .then((conversa) => {
        if (!ativo) return
        setEstado(
          conversa
            ? {
                status: 'pronto',
                conversaId: conversa.id,
                mensagens: conversa.mensagens,
                temMensagensAntigas: conversa.temMensagensAntigas,
              }
            : { status: 'sem-conversa' },
        )
        // Reações da conversa inteira, numa chamada só — nunca por página nem
        // por mensagem (ver `obterReacoesDaConversa`). Mensagem antiga ainda
        // não carregada pela paginação já tem a reação disponível assim que
        // entrar, sem precisar buscar de novo.
        if (conversa) void obterReacoesDaConversaAction(conversa.id).then((r) => ativo && setReacoes(r))
      })
      .catch((erro: unknown) => {
        // Antes, uma falha aqui (ex.: tabela/coluna ainda sem migration
        // aplicada) deixava `estado` parado pra sempre em 'carregando' — a
        // Promise rejeitava e nada chamava `setEstado`. Agora qualquer
        // rejeição vira um estado visível, nunca falha silenciosa.
        if (!ativo) return
        console.error('[painel-conversa] falha ao carregar a conversa:', erro)
        setEstado({ status: 'erro', mensagem: 'Não foi possível carregar a conversa.' })
      })
    return () => {
      ativo = false
    }
  }, [card.clienteId, tentativaCarga])

  function tentarCarregarNovamente() {
    // Setado aqui (evento de clique), nunca no corpo do efeito — um
    // `setState` síncrono direto no corpo de um `useEffect` dispara render
    // em cascata, o que o lint de hooks já acusa. Bumping `tentativaCarga`
    // é só o gatilho pro efeito rodar de novo com o mesmo `card.clienteId`.
    setEstado({ status: 'carregando' })
    setTentativaCarga((t) => t + 1)
  }

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
        setRespostaAtiva(null)
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
          respostaA: resultado.respostaA ?? null,
          encaminhada: false,
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
        setRespostaAtiva(null)
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
          respostaA: resultado.respostaA ?? null,
          encaminhada: false,
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
        setRespostaAtiva(null)
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
          respostaA: resultado.respostaA ?? null,
          encaminhada: false,
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
        setRespostaAtiva(null)
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
          respostaA: resultado.respostaA ?? null,
          encaminhada: false,
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
        respostaA: resultado.respostaA ?? null,
        encaminhada: false,
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
    const topico = topicoConversa(empresa.id, conversaId)

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

      // Canal PRIVADO por empresa e conversa (`empresa:<tenant>:conversa:<id>`):
      // o banco publica mensagens e reações (triggers com realtime.send) e só
      // deixa entrar quem é da empresa e enxerga a conversa. postgres_changes
      // não serve aqui: o Realtime não manda a empresa da aba ao banco.
      canalAtual = supabase
        .channel(topico, { config: { private: true } })
        .on('broadcast', { event: 'mensagem' }, ({ payload }) => {
          const { op, registro } = payload as { op: string; registro: LinhaMensagem }
          if (registro.conversa_id !== conversaId) return
          const mensagem = paraMensagem(registro)
          setEstado((atual) => {
            if (atual.status !== 'pronto') return atual
            // UPDATE: o whatsapp-service faz pendente → enviando → enviado/falhou nesta linha.
            return { ...atual, mensagens: mesclarMensagem(atual.mensagens, mensagem, op === 'INSERT') }
          })
        })
        .on('broadcast', { event: 'reacao' }, ({ payload }) => {
          const { op, registro } = payload as { op: string; registro: LinhaReacao }
          if (op === 'DELETE') {
            setReacoes((atual) =>
              atual.filter((r) => !(r.mensagemId === registro.mensagem_id && r.usuarioId === registro.usuario_id)),
            )
            return
          }
          setReacoes((atual) => mesclarReacao(atual, registro))
        })
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
  }, [conversaId, empresa.id])

  /**
   * Busca a próxima página de mensagens mais antigas que a primeira
   * atualmente carregada — cursor composto `(created_at, id)` da mensagem
   * em `estadoRef.current.mensagens[0]`, sempre lido do ref (nunca do
   * `estado` fechado no escopo de quem chama) pra nunca pedir uma página
   * baseada numa primeira mensagem que já não é mais a primeira. Guarda de
   * concorrência por ref: `IntersectionObserver` pode disparar de novo
   * antes da resposta anterior voltar (ex.: rolagem rápida) — só a primeira
   * chamada em voo segue adiante.
   */
  async function carregarMensagensAntigas() {
    const atual = estadoRef.current
    if (atual.status !== 'pronto' || !atual.temMensagensAntigas || carregandoAntigasRef.current) return
    const primeira = atual.mensagens[0]
    if (!primeira) return

    carregandoAntigasRef.current = true
    setCarregandoAntigas(true)

    const lista = listaRef.current
    if (lista) {
      preservarScrollRef.current = { scrollTopAntes: lista.scrollTop, scrollHeightAntes: lista.scrollHeight }
    }

    const resultado = await obterMensagensAntigasAction(atual.conversaId, primeira.createdAt, primeira.id)

    carregandoAntigasRef.current = false
    if (!montadoRef.current) return
    setCarregandoAntigas(false)

    if (!resultado) {
      preservarScrollRef.current = null // pedido falhou — nada vai prependar, não deixa o scroll pendente de ajuste
      return
    }

    setEstado((atualEstado) => {
      if (atualEstado.status !== 'pronto') return atualEstado
      return {
        ...atualEstado,
        mensagens: prependarAntigas(atualEstado.mensagens, resultado.mensagens),
        temMensagensAntigas: resultado.temMensagensAntigas,
      }
    })
  }

  // Sentinela no topo da lista: observer configurado uma vez por conversa
  // (nunca recriado a cada mensagem nova) — `carregarMensagensAntigas` já lê
  // estado sempre atual via `estadoRef`, então não precisa reconfigurar o
  // observer pra isso. Dispara um pouco antes do topo física (rootMargin),
  // pra a rolagem parecer natural em vez de travar bem na borda.
  useEffect(() => {
    if (!conversaId) return
    const sentinela = sentinelaTopoRef.current
    const lista = listaRef.current
    if (!sentinela || !lista) return

    const observer = new IntersectionObserver(
      (entradas) => {
        if (entradas[0]?.isIntersecting) void carregarMensagensAntigas()
      },
      { root: lista, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(sentinela)
    return () => observer.disconnect()
  }, [conversaId])

  /** Copia o texto/legenda — mensagem sem `conteudo` nem mostra a opção no menu (ver `copiavel` no render). */
  function copiarMensagem(m: MensagemConversa) {
    if (!m.conteudo) return
    void navigator.clipboard.writeText(m.conteudo).then(() => {
      if (timeoutCopiadoRef.current) clearTimeout(timeoutCopiadoRef.current)
      setCopiadoId(m.id)
      timeoutCopiadoRef.current = setTimeout(() => setCopiadoId(null), 1500)
    })
  }

  useEffect(() => {
    return () => {
      if (timeoutCopiadoRef.current) clearTimeout(timeoutCopiadoRef.current)
    }
  }, [])

  function iniciarResposta(m: MensagemConversa) {
    setRespostaAtiva(m)
    textareaRef.current?.focus()
  }

  /** Rola até a mensagem original citada, só se ela já estiver entre as carregadas — nunca busca mais páginas só por causa disso. */
  function irParaMensagem(mensagemId: string) {
    listaRef.current?.querySelector(`[data-mensagem-id="${mensagemId}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  function iniciarSelecao(mensagemId: string) {
    setModoSelecao(true)
    setSelecionadas(new Set([mensagemId]))
  }

  function alternarSelecao(mensagemId: string) {
    setSelecionadas((atual) => {
      const copia = new Set(atual)
      if (copia.has(mensagemId)) copia.delete(mensagemId)
      else copia.add(mensagemId)
      return copia
    })
  }

  function cancelarSelecao() {
    setModoSelecao(false)
    setSelecionadas(new Set())
  }

  /** "Excluir pra mim" (uma ou várias, sempre em UMA chamada) — some da própria tela na hora; nunca afeta quem mais vê a conversa. */
  function excluirMensagens(mensagemIds: string[]) {
    const idsUnicos = [...new Set(mensagemIds)]
    if (idsUnicos.length === 0) return

    void excluirMensagensParaMimAction(idsUnicos)

    const paraExcluir = new Set(idsUnicos)
    setEstado((atual) => {
      if (atual.status !== 'pronto') return atual
      return { ...atual, mensagens: atual.mensagens.filter((m) => !paraExcluir.has(m.id)) }
    })
    setSelecionadas((atual) => {
      if (idsUnicos.every((id) => !atual.has(id))) return atual
      const copia = new Set(atual)
      for (const id of idsUnicos) copia.delete(id)
      return copia
    })
  }

  function excluirSelecionadas() {
    excluirMensagens([...selecionadas])
    cancelarSelecao()
  }

  /** Reagir ou trocar a própria reação — CRM-only, nunca sincroniza com o WhatsApp nesta fase (ver migration). */
  function reagir(mensagemId: string, emoji: string) {
    void reagirMensagemAction(mensagemId, emoji)
  }

  function removerPropriaReacao(mensagemId: string) {
    void removerReacaoAction(mensagemId)
  }

  const [avisoEncaminhar, setAvisoEncaminhar] = useState<string | null>(null)

  function abrirEncaminhar(mensagemIds: string[]) {
    setModalEncaminhar({ mensagemIds: [...new Set(mensagemIds)] })
  }

  function aoEncaminhado(resultado: { enviadas: MensagemEncaminhada[]; falhas: number }) {
    cancelarSelecao()
    const partes = []
    if (resultado.enviadas.length > 0) {
      partes.push(
        resultado.enviadas.length === 1
          ? '1 mensagem encaminhada'
          : `${resultado.enviadas.length} mensagens encaminhadas`,
      )
    }
    if (resultado.falhas > 0) partes.push(resultado.falhas === 1 ? '1 falhou' : `${resultado.falhas} falharam`)
    setAvisoEncaminhar(partes.join(' — '))
    setTimeout(() => setAvisoEncaminhar(null), 4000)
  }

  // Memoizado: referência só muda quando `estado` muda de fato — o
  // `useLayoutEffect` de scroll (abaixo) depende do array inteiro (pra
  // comparar o id da última mensagem), não só do tamanho, e sem isso
  // recalcularia a cada render só por causa do `[]` novo nos estados
  // `carregando`/`sem-conversa`.
  const mensagens = useMemo(() => (estado.status === 'pronto' ? estado.mensagens : []), [estado])
  const itensHistorico = construirItensHistorico(mensagens)

  /** Reações agrupadas por mensagem — recalculado só quando `reacoes` muda, nunca por mensagem na hora do render. */
  const reacoesPorMensagem = useMemo(() => {
    const mapa = new Map<string, ReacaoMensagem[]>()
    for (const r of reacoes) {
      const lista = mapa.get(r.mensagemId)
      if (lista) lista.push(r)
      else mapa.set(r.mensagemId, [r])
    }
    return mapa
  }, [reacoes])

  /** Ids com busca de signed URL em andamento — evita repetir a mesma chamada a cada render. */
  const buscandoUrlRef = useRef<Set<string>>(new Set())

  // Mensagem de imagem/documento chegada pelo Realtime nasce sem
  // `arquivoUrl` (o payload só traz as colunas da linha, nunca uma signed
  // URL — ver `paraMensagem`). Busca sob demanda por id, nunca a partir de
  // um caminho vindo do cliente. Áudio fica de fora: `PlayerAudio` já
  // reaproveita a signed URL da carga inicial (`urlInicial`) quando ela
  // existe, e só busca a própria por `mensagemId` quando não há nenhuma
  // ainda (caso justamente de uma mensagem chegada crua pelo Realtime) ou
  // quando a reaproveitada expirou — nunca precisa deste efeito.
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

  /**
   * Único efeito que decide o scroll depois de qualquer mudança nas
   * mensagens — `useLayoutEffect` (não `useEffect`) pra aplicar antes do
   * paint, sem flash visual em nenhum dos dois casos:
   *
   * 1. Prepend de mensagens antigas (`preservarScrollRef` setado em
   *    `carregarMensagensAntigas`): restaura a posição exata — usuário
   *    continua vendo a mesma mensagem na mesma posição da tela. Nunca
   *    rola pro fim nesse caso, mesmo que a lista tenha crescido.
   * 2. Mensagem nova no FIM (detectado comparando o id da última mensagem
   *    com o do render anterior, nunca o tamanho do array — prepend também
   *    muda o tamanho, mas nunca o id da última): só rola pro fim se for a
   *    carga inicial da conversa OU se o usuário já estava a ≤100px do
   *    fim. Se ele está lendo histórico antigo, mensagem nova não o
   *    arrasta pra baixo à força.
   */
  useLayoutEffect(() => {
    const lista = listaRef.current
    if (!lista) return

    const prependPendente = preservarScrollRef.current
    if (prependPendente) {
      preservarScrollRef.current = null
      lista.scrollTop = prependPendente.scrollTopAntes + (lista.scrollHeight - prependPendente.scrollHeightAntes)
      ultimoIdRef.current = mensagens.at(-1)?.id ?? ultimoIdRef.current
      return
    }

    if (mensagens.length === 0) return
    const ultimaMensagem = mensagens[mensagens.length - 1]
    const idAnterior = ultimoIdRef.current
    ultimoIdRef.current = ultimaMensagem.id

    const éCargaInicial = idAnterior === null
    const últimaMudou = idAnterior !== null && idAnterior !== ultimaMensagem.id
    if (!éCargaInicial && !últimaMudou) return // só prepend de antigas sem ser via `preservarScrollRef` — não deveria acontecer, mas não mexe no scroll por garantia

    const pertoDoFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight <= 100
    if (éCargaInicial || pertoDoFim) lista.scrollTop = lista.scrollHeight
  }, [mensagens])

  return (
    <>
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
          {modoSelecao ? (
            <>
              <p id="painel-conversa-titulo" className="self-center text-sm font-medium">
                {selecionadas.size} selecionada{selecionadas.size === 1 ? '' : 's'}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => abrirEncaminhar([...selecionadas])}
                  disabled={selecionadas.size === 0}
                  aria-label="Encaminhar selecionadas"
                  title="Encaminhar"
                  className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <IconeEncaminhar className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={excluirSelecionadas}
                  disabled={selecionadas.size === 0}
                  aria-label="Excluir selecionadas para mim"
                  title="Excluir para mim"
                  className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <IconeLixeira className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={cancelarSelecao}
                  className="rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </header>

        {avisoEncaminhar && (
          <p role="status" className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {avisoEncaminhar}
          </p>
        )}

        <div ref={listaRef} className="flex-1 overflow-y-auto p-4">
          {estado.status === 'carregando' && (
            <p className="text-center text-sm text-zinc-500">Carregando…</p>
          )}

          {estado.status === 'erro' && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="text-sm text-zinc-500">{estado.mensagem}</p>
              <button
                type="button"
                onClick={tentarCarregarNovamente}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {(estado.status === 'sem-conversa' || estado.status === 'pronto') && mensagens.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-sm text-zinc-500">Nenhuma mensagem ainda.</p>
            </div>
          )}

          {mensagens.length > 0 && (
            <>
              {/* Sentinela 1px — `IntersectionObserver` dispara `carregarMensagensAntigas` ao entrar na viewport (ver efeito acima). Sem botão: a rolagem natural já é o gatilho. */}
              <div ref={sentinelaTopoRef} aria-hidden className="h-px" />
              {carregandoAntigas && (
                <p className="mb-2 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  Carregando mensagens anteriores…
                </p>
              )}
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
                const gruposReacao = agruparReacoes(reacoesPorMensagem.get(m.id) ?? [], usuarioAtualId)
                const selecionada = selecionadas.has(m.id)
                return (
                  <li
                    key={m.id}
                    data-mensagem-id={m.id}
                    className={`flex items-end gap-1.5 ${m.direcao === 'saida' ? 'justify-end' : 'justify-start'} ${
                      item.primeiroDoGrupo ? 'mt-3 first:mt-0' : 'mt-0.5'
                    }`}
                  >
                    {modoSelecao && (
                      <button
                        type="button"
                        onClick={() => alternarSelecao(m.id)}
                        aria-pressed={selecionada}
                        aria-label={selecionada ? 'Remover da seleção' : 'Selecionar mensagem'}
                        className={`mb-1 flex size-5 shrink-0 items-center justify-center rounded-full border transition ${
                          selecionada
                            ? 'border-green-600 bg-green-600 text-white'
                            : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'
                        }`}
                      >
                        {selecionada && <IconeCheck />}
                      </button>
                    )}
                    <div className="relative max-w-[80%]">
                    <div
                      onClick={modoSelecao ? () => alternarSelecao(m.id) : undefined}
                      className={`rounded-lg px-3 py-2 text-sm ${modoSelecao ? 'cursor-pointer' : ''} ${
                        m.direcao === 'saida'
                          ? `bg-green-600 text-white ${item.primeiroDoGrupo ? 'rounded-tr-sm' : ''}`
                          : `bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 ${item.primeiroDoGrupo ? 'rounded-tl-sm' : ''}`
                      }`}
                    >
                    {m.encaminhada && (
                      <p
                        className={`mb-1 flex items-center gap-1 text-[11px] italic ${
                          m.direcao === 'saida' ? 'text-green-100/80' : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        <IconeEncaminhar className="size-3" />
                        Encaminhada
                      </p>
                    )}
                    {m.respostaA && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          irParaMensagem(m.respostaA!.id)
                        }}
                        className={`mb-1.5 block w-full rounded border-l-4 px-2 py-1 text-left text-xs transition ${
                          m.direcao === 'saida'
                            ? 'border-green-200 bg-black/10 hover:bg-black/15'
                            : 'border-zinc-400 bg-black/5 hover:bg-black/10 dark:border-zinc-500 dark:bg-white/10 dark:hover:bg-white/15'
                        }`}
                      >
                        <span className="block truncate font-medium opacity-90">
                          {m.respostaA.direcao === 'saida' ? 'Você' : card.clienteNome}
                        </span>
                        <span className="block truncate opacity-70">{m.respostaA.conteudo ?? '…'}</span>
                      </button>
                    )}
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
                      <PlayerAudio
                        mensagemId={m.id}
                        urlInicial={m.arquivoUrl}
                        duracaoInicial={m.arquivoDuracaoSegundos}
                      />
                    )}
                    {m.conteudo && <p className="whitespace-pre-wrap">{m.conteudo}</p>}
                    <p
                      className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] ${
                        m.direcao === 'saida' ? 'text-green-100' : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {formatarHora(m.createdAt)}
                      {m.direcao === 'saida' && m.status && (
                        <span title={ROTULO_STATUS_ENVIO[m.status]} aria-label={ROTULO_STATUS_ENVIO[m.status]}>
                          <IconeStatusEnvio status={m.status} />
                        </span>
                      )}
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

                    {gruposReacao.length > 0 && (
                      <div className={`mt-0.5 flex flex-wrap gap-1 ${m.direcao === 'saida' ? 'justify-end' : 'justify-start'}`}>
                        {gruposReacao.map((grupo) => (
                          <button
                            key={grupo.emoji}
                            type="button"
                            onClick={() => (grupo.minha ? removerPropriaReacao(m.id) : reagir(m.id, grupo.emoji))}
                            title={grupo.nomes.join(', ')}
                            className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition ${
                              grupo.minha
                                ? 'border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950'
                                : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>{grupo.emoji}</span>
                            {grupo.contagem > 1 && <span className="tabular-nums">{grupo.contagem}</span>}
                          </button>
                        ))}
                      </div>
                    )}

                    {copiadoId === m.id && (
                      <span className="absolute -top-2 right-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white shadow dark:bg-zinc-100 dark:text-zinc-900">
                        Copiado
                      </span>
                    )}

                    {!modoSelecao && (
                      <div className={`absolute -top-1.5 ${m.direcao === 'saida' ? '-left-1.5' : '-right-1.5'}`}>
                        <MenuMensagem
                          copiavel={Boolean(m.conteudo)}
                          onCopiar={() => copiarMensagem(m)}
                          onResponder={() => iniciarResposta(m)}
                          onReagir={(emoji) => reagir(m.id, emoji)}
                          onEncaminhar={() => abrirEncaminhar([m.id])}
                          onSelecionar={() => iniciarSelecao(m.id)}
                          onExcluir={() => excluirMensagens([m.id])}
                        />
                      </div>
                    )}
                    </div>
                  </li>
                )
              })}
              </ul>
            </>
          )}
        </div>

        <form
          className="flex flex-col gap-1.5 border-t border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault()
            const formData = new FormData(e.currentTarget)
            if (respostaAtiva) formData.set('respostaAId', respostaAtiva.id)
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
          {respostaAtiva && (
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 border-l-4 border-l-green-600 p-2 dark:border-zinc-700">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-green-700 dark:text-green-400">
                  {respostaAtiva.direcao === 'saida' ? 'Você' : card.clienteNome}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {respostaAtiva.conteudo ??
                    (respostaAtiva.tipo === 'imagem'
                      ? 'Imagem'
                      : respostaAtiva.tipo === 'documento'
                        ? 'Documento'
                        : respostaAtiva.tipo === 'audio'
                          ? 'Áudio'
                          : '')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRespostaAtiva(null)}
                aria-label="Cancelar resposta"
                className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                  <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
                </svg>
              </button>
            </div>
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
    {modalEncaminhar && conversaId && (
      <ModalEncaminhar
        mensagemIds={modalEncaminhar.mensagemIds}
        conversaAtualId={conversaId}
        onFechar={() => setModalEncaminhar(null)}
        onEncaminhado={aoEncaminhado}
      />
    )}
    </>
  )
}
