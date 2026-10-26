'use client'

import { useEffect, useId, useRef } from 'react'

import { ANEXO_DOCUMENTO_TIPOS, ANEXO_IMAGEM_TIPOS } from '@/lib/validations/mensagem'

const LARGURA_MENU = 224

/** Câmera ainda não tem upload/envio implementado — "em breve", sem fingir que algo foi enviado. Áudio não é um item deste menu — é o botão 🎤 dedicado no composer, igual ao WhatsApp Web. */
const ITENS_EM_BREVE = [{ rotulo: 'Câmera', icone: '📷' }] as const

type Props = {
  disabled?: boolean
  onSelecionarImagem: (arquivo: File) => void
  onSelecionarDocumento: (arquivo: File) => void
}

/** Botão 📎 + menu de anexos pro composer do `PainelConversa` — mesma Popover API nativa de `MenuMoverPara`. */
export function AnexoMenu({ disabled = false, onSelecionarImagem, onSelecionarDocumento }: Props) {
  const id = useId()
  const botaoRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputImagemRef = useRef<HTMLInputElement>(null)
  const inputDocumentoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    const botao = botaoRef.current
    if (!menu || !botao) return

    function posicionar() {
      if (!menu || !botao) return
      const r = botao.getBoundingClientRect()
      const altura = menu.offsetHeight
      const cabeEmCima = r.top - 4 - altura >= 0
      menu.style.top = `${cabeEmCima ? r.top - 4 - altura : r.bottom + 4}px`
      menu.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - LARGURA_MENU - 8)}px`
    }

    function aoAlternar(e: Event) {
      if ((e as ToggleEvent).newState === 'open') posicionar()
    }

    menu.addEventListener('toggle', aoAlternar)
    return () => menu.removeEventListener('toggle', aoAlternar)
  }, [])

  function escolherFotos() {
    menuRef.current?.hidePopover()
    inputImagemRef.current?.click()
  }

  function escolherDocumento() {
    menuRef.current?.hidePopover()
    inputDocumentoRef.current?.click()
  }

  function aoSelecionarImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = '' // permite selecionar o mesmo arquivo de novo depois (ex.: reenviar após corrigir)
    if (arquivo) onSelecionarImagem(arquivo)
  }

  function aoSelecionarDocumento(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (arquivo) onSelecionarDocumento(arquivo)
  }

  return (
    <>
      <input
        ref={inputImagemRef}
        type="file"
        accept={ANEXO_IMAGEM_TIPOS.join(',')}
        onChange={aoSelecionarImagem}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={inputDocumentoRef}
        type="file"
        accept={ANEXO_DOCUMENTO_TIPOS.join(',')}
        onChange={aoSelecionarDocumento}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />

      <button
        ref={botaoRef}
        type="button"
        popoverTarget={`${id}-anexo`}
        aria-haspopup="menu"
        aria-label="Anexar"
        title="Anexar"
        disabled={disabled}
        className="shrink-0 rounded-md p-2 text-lg leading-none transition hover:bg-premium-bg disabled:cursor-not-allowed disabled:opacity-60"
      >
        📎
      </button>

      <div
        ref={menuRef}
        id={`${id}-anexo`}
        popover="auto"
        role="menu"
        aria-label="Anexar arquivo"
        className="fixed m-0 rounded-lg border border-premium-borda bg-premium-card p-1 text-sm shadow-premium-alta"
        style={{ width: LARGURA_MENU, inset: 'auto' }}
      >
        <button
          type="button"
          role="menuitem"
          onClick={escolherFotos}
          disabled={disabled}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-premium-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden>🖼️</span>
          <span className="truncate">Fotos e vídeos</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={escolherDocumento}
          disabled={disabled}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-premium-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden>📄</span>
          <span className="truncate">Documento</span>
        </button>

        {ITENS_EM_BREVE.map((item) => (
          <button
            key={item.rotulo}
            type="button"
            role="menuitem"
            disabled
            title="Em breve"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-500"
          >
            <span aria-hidden>{item.icone}</span>
            <span className="truncate">{item.rotulo}</span>
            <span className="ml-auto shrink-0 text-xs">Em breve</span>
          </button>
        ))}
      </div>
    </>
  )
}
