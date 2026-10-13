'use client'

import { useEffect, useRef, useState } from 'react'

import { obterUrlAnexoAction } from '@/lib/actions/conversas'

type Props = {
  /** Ausente só quando `srcLocal` é usado (preview de pré-envio). */
  mensagemId?: string
  /** Blob URL local (preview antes de enviar) — pula a busca de signed URL, já tem `src` pronto. */
  srcLocal?: string
  /**
   * Signed URL já obtida na carga da conversa (`obterConversaDoCliente` já
   * assina áudio igual a imagem/documento) — reaproveitada em vez de pedir
   * uma nova ao Storage. `null`/ausente só quando a mensagem chegou crua
   * pelo Realtime (sem signed URL no payload); nesse caso cai no fallback de
   * busca por `mensagemId` de qualquer forma, igual já funcionava.
   */
  urlInicial?: string | null
  /** Cronômetro do remetente (saída) ou `music-metadata` do whatsapp-service (entrada) — mostrado antes da signed URL/metadata real carregar. */
  duracaoInicial: number | null
}

/** "0:07", "1:23" — nunca `NaN:NaN` antes do `<audio>` ter metadata real. */
function formatarTempo(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00'
  const m = Math.floor(segundos / 60)
  const s = Math.floor(segundos % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function IconePlay({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  )
}

function IconePause({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function IconeCarregando({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Player customizado — `<audio controls>` nativo variava demais entre
 * navegadores pro nosso caso (Chrome/Edge/Firefox tocam webm/opus bruto só
 * a partir de signed URL; Safari não garante o mesmo). Reaproveita a signed
 * URL já trazida por `urlInicial` (gerada uma vez na carga da conversa) em
 * vez de pedir outra ao Storage; só busca uma nova por `mensagemId` quando
 * não há nenhuma ainda (mensagem chegada crua pelo Realtime) ou quando a
 * reaproveitada já expirou (TTL de 5 min — `TTL_URL_ASSINADA` na DAL) e o
 * `<audio>` falha ao carregá-la (`urlReutilizadaRef`, abaixo). Funciona
 * igual pra áudio enviado pelo CRM ou recebido do WhatsApp — a Action já é
 * agnóstica de direção/tipo.
 */
export function PlayerAudio({ mensagemId, srcLocal, urlInicial, duracaoInicial }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  /** Play foi pedido antes de ter `src` — toca assim que o `<audio>` carregar a URL nova. */
  const tocarQuandoCarregarRef = useRef(false)
  /**
   * `true` enquanto `src` for a URL reaproveitada de `urlInicial` (nunca
   * confirmada fresca por uma busca nossa) — só nesse caso uma falha de
   * carregamento/reprodução dispara UMA busca nova por `mensagemId` antes de
   * desistir e mostrar erro. Falsa assim que uma busca nossa resolve `src`
   * (`buscarUrl`), pra nunca entrar em loop de retry numa URL genuinamente
   * quebrada (formato não suportado, arquivo removido etc.).
   */
  const urlReutilizadaRef = useRef(Boolean(!srcLocal && urlInicial))

  const [src, setSrc] = useState<string | null>(srcLocal ?? urlInicial ?? null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<'busca' | 'reproducao' | null>(null)
  const [tocando, setTocando] = useState(false)
  const [tempoAtual, setTempoAtual] = useState(0)
  const [duracao, setDuracao] = useState(duracaoInicial ?? 0)

  async function buscarUrl(): Promise<string | null> {
    if (!mensagemId) return null // só `srcLocal` — nunca precisa buscar
    urlReutilizadaRef.current = false // a partir daqui `src` é sempre uma URL buscada por nós, nunca mais a reaproveitada
    setCarregando(true)
    setErro(null)
    const url = await obterUrlAnexoAction(mensagemId)
    setCarregando(false)
    if (!url) {
      setErro('busca')
      return null
    }
    setSrc(url)
    return url
  }

  /** Falha carregando/tocando a URL reaproveitada: tenta buscar uma nova (uma única vez) antes de desistir. */
  function tentarRenovarUrlReutilizada(): boolean {
    if (!urlReutilizadaRef.current || !mensagemId) return false
    void buscarUrl()
    return true
  }

  // Assim que uma URL nova é aplicada ao <audio>, toca se foi um play pendente
  // (clique enquanto ainda não tínhamos signed URL, ou retry depois de expirar).
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !src || !tocarQuandoCarregarRef.current) return
    tocarQuandoCarregarRef.current = false
    audio.play().catch(() => setErro('reproducao'))
  }, [src])

  async function alternarPlayPause() {
    const audio = audioRef.current
    if (!audio) return

    if (tocando) {
      audio.pause()
      return
    }

    if (!src) {
      tocarQuandoCarregarRef.current = true
      await buscarUrl()
      return
    }

    try {
      await audio.play()
    } catch {
      tocarQuandoCarregarRef.current = true
      if (tentarRenovarUrlReutilizada()) return
      tocarQuandoCarregarRef.current = false
      setErro('reproducao')
    }
  }

  function tentarDeNovo() {
    tocarQuandoCarregarRef.current = true
    void buscarUrl()
  }

  function aoClicarBarra(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !src || duracao <= 0) return
    const retangulo = e.currentTarget.getBoundingClientRect()
    const fracao = Math.min(1, Math.max(0, (e.clientX - retangulo.left) / retangulo.width))
    audio.currentTime = fracao * duracao
    setTempoAtual(audio.currentTime)
  }

  if (erro === 'busca') {
    return (
      <div className="mb-1 flex items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 text-xs dark:bg-white/10">
        <span>Não foi possível carregar o áudio.</span>
        <button type="button" onClick={tentarDeNovo} className="shrink-0 font-medium underline decoration-dotted">
          Tentar novamente
        </button>
      </div>
    )
  }

  if (erro === 'reproducao' && src) {
    // O navegador não conseguiu tocar o formato recebido (ex.: Safari com
    // webm) — não trava a conversa, só vira link de abrir numa aba nova.
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 flex items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 text-sm transition hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
      >
        <span aria-hidden className="text-xl">
          🎵
        </span>
        <span>Abrir áudio</span>
      </a>
    )
  }

  const progresso = duracao > 0 ? Math.min(1, tempoAtual / duracao) : 0

  return (
    <div className="mb-1 flex items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 dark:bg-white/10">
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          onEnded={() => {
            setTocando(false)
            setTempoAtual(0)
          }}
          onTimeUpdate={(e) => setTempoAtual(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const real = e.currentTarget.duration
            if (Number.isFinite(real) && real > 0) setDuracao(real)
          }}
          onError={() => {
            // Erro ao carregar a URL reaproveitada (ex.: expirou) — tenta renovar
            // uma vez; se a reprodução já tinha começado/sido pedida, retoma sozinha
            // assim que a nova URL chegar (ver `tocarQuandoCarregarRef`, acima).
            if (tocando) tocarQuandoCarregarRef.current = true
            if (tentarRenovarUrlReutilizada()) return
            setErro('reproducao')
          }}
          className="hidden"
        />
      )}
      <button
        type="button"
        onClick={alternarPlayPause}
        disabled={carregando}
        aria-label={tocando ? 'Pausar áudio' : 'Reproduzir áudio'}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/10 transition hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/10 dark:hover:bg-white/20"
      >
        {carregando ? <IconeCarregando /> : tocando ? <IconePause /> : <IconePlay />}
      </button>
      <div
        role="slider"
        aria-label="Progresso do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(duracao)}
        aria-valuenow={Math.round(tempoAtual)}
        onClick={aoClicarBarra}
        className="h-1.5 flex-1 cursor-pointer rounded-full bg-black/15 dark:bg-white/15"
      >
        <div className="h-full rounded-full bg-current" style={{ width: `${progresso * 100}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums opacity-80">
        {formatarTempo(tempoAtual)} / {formatarTempo(duracao)}
      </span>
    </div>
  )
}
