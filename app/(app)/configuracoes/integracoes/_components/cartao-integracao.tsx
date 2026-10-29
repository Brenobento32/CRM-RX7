'use client'

import { useEffect, useRef } from 'react'

const CHAVE_ABERTA = 'avante:central-aberta'

/**
 * Cartão clicável da Central que abre a configuração numa janela (dialog
 * nativo: foco preso, Esc fecha, acessível). O conteúdo é renderizado no
 * servidor e só fica visível ao abrir. Depois de salvar (as ações voltam para
 * esta página com ?ok/?erro), a mesma janela reabre para mostrar o resultado.
 */
export function CartaoIntegracao({
  chave,
  titulo,
  cabecalho,
  children,
}: {
  chave: string
  titulo: string
  cabecalho: React.ReactNode
  children: React.ReactNode
}) {
  const janela = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const voltouDeAcao = params.has('ok') || params.has('erro')
      const pedida = params.get('abrir')
      if (pedida === chave || (voltouDeAcao && sessionStorage.getItem(CHAVE_ABERTA) === chave)) janela.current?.showModal()
      if (voltouDeAcao) sessionStorage.removeItem(CHAVE_ABERTA)
    } catch {
      // sem sessionStorage: a janela só não reabre sozinha
    }
  }, [chave])

  const abrir = () => janela.current?.showModal()
  const fechar = () => janela.current?.close()

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        className="group flex h-full w-full flex-col rounded-xl border border-premium-borda bg-premium-card p-4 text-left shadow-premium transition hover:-translate-y-0.5 hover:border-premium-acento/60 focus-visible:outline-2 focus-visible:outline-premium-acento"
      >
        {cabecalho}
        <span className="mt-auto pt-3 text-sm font-medium text-premium-acento group-hover:underline">Configurar</span>
      </button>
      <dialog
        ref={janela}
        aria-label={titulo}
        onClick={(e) => {
          if (e.target === e.currentTarget) fechar()
        }}
        onSubmitCapture={() => {
          try {
            sessionStorage.setItem(CHAVE_ABERTA, chave)
          } catch {}
        }}
        className="m-auto max-h-[92dvh] w-[min(56rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-premium-borda bg-premium-bg p-0 text-premium-texto shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
      >
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-premium-borda-suave bg-premium-card px-5 py-3">
            <h2 className="text-base font-semibold tracking-tight">{titulo}</h2>
            <button type="button" onClick={fechar} className="rounded-lg px-2 py-1 text-sm text-premium-secundario hover:bg-premium-bg" aria-label="Fechar">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto p-4 sm:p-5">{children}</div>
        </div>
      </dialog>
    </>
  )
}
