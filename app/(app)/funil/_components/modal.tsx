'use client'

import { useEffect, useRef } from 'react'
import { botaoFantasmaClass, botaoPrimarioClass, caixaErroClass } from '@/components/ui/estilos'

/**
 * Modal sobre `<dialog>` nativo: `showModal()` já entrega foco preso, Esc e
 * fundo inerte. Esc, clique fora (no backdrop, nunca dentro do conteúdo) e o
 * X chamam `onCancelar` — no funil isso desfaz o movimento do card.
 *
 * `<dialog>` com `showModal()` NÃO fecha sozinho ao clicar fora — o clique no
 * backdrop é tecnicamente um clique no próprio `<dialog>` (a área ao redor do
 * conteúdo); `e.target === dialog` só é verdade nesse caso, nunca quando o
 * clique começa em algo dentro de `children`.
 */
export function Modal({
  titulo,
  descricao,
  onCancelar,
  children,
}: {
  titulo: string
  descricao?: React.ReactNode
  onCancelar: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-titulo"
      onCancel={(e) => {
        e.preventDefault()
        onCancelar()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancelar()
      }}
      className="m-auto w-full max-w-lg rounded-2xl border border-premium-borda bg-premium-card p-0 text-premium-texto shadow-premium-alta backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="modal-titulo" className="text-lg font-semibold">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCancelar}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-1.5 text-premium-mudo transition hover:bg-premium-bg hover:text-premium-texto"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z" />
            </svg>
          </button>
        </div>
        {descricao && (
          <p className="mt-1 text-sm text-premium-secundario">{descricao}</p>
        )}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  )
}

export { ErroCampo } from '@/components/ui/erro-campo'
export { inputClass } from '@/components/ui/estilos'

export function ErroGeral({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null
  return (
    <div
      role="alert"
      className={caixaErroClass}
    >
      {mensagem}
    </div>
  )
}

export function BotoesModal({
  pendente,
  rotulo,
  onCancelar,
}: {
  pendente: boolean
  rotulo: string
  onCancelar: () => void
}) {
  return (
    <div className="flex justify-end gap-3 border-t border-premium-borda pt-5">
      <button
        type="button"
        onClick={onCancelar}
        disabled={pendente}
        className={botaoFantasmaClass}
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={pendente}
        className={botaoPrimarioClass}
      >
        {pendente ? 'Salvando…' : rotulo}
      </button>
    </div>
  )
}
