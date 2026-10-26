'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { IconeEditar } from '@/components/layout/icones'

const TIPOS = ['image/png', 'image/jpeg', 'image/webp']
const TAMANHO_MAXIMO = 2 * 1024 * 1024

/**
 * Campo de logotipo dos formulários da empresa (Gerente e Super Admin).
 *
 * - O logo atual aparece em destaque; o lápis (ou "Trocar logotipo") abre a
 *   seleção do arquivo, e a imagem nova aparece ANTES de salvar.
 * - Remover é uma ação explícita ("Remover" → aviso → "Desfazer"), nunca uma
 *   caixa já marcada: o campo `remover_logo` só vai no envio depois do clique.
 * - O servidor valida de novo (tipo, tamanho, pasta da empresa); aqui é só a
 *   orientação imediata para o usuário.
 */
export function CampoLogotipo({ logoUrl, nome }: { logoUrl: string | null; nome: string }) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<{ url: string; nome: string } | null>(null)
  const [remover, setRemover] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => () => {
    if (previa) URL.revokeObjectURL(previa.url)
  }, [previa])

  function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    setErro(null)
    if (!arquivo) return
    if (!TIPOS.includes(arquivo.type)) {
      setErro('Use uma imagem PNG, JPG ou WebP.')
      e.target.value = ''
      return
    }
    if (arquivo.size > TAMANHO_MAXIMO) {
      setErro('O logotipo pode ter no máximo 2 MB.')
      e.target.value = ''
      return
    }
    setRemover(false)
    setPrevia({ url: URL.createObjectURL(arquivo), nome: arquivo.name })
  }

  function cancelarNovo() {
    if (inputRef.current) inputRef.current.value = ''
    setPrevia(null)
  }

  const exibida = remover ? null : (previa?.url ?? logoUrl)
  const temLogoAtual = Boolean(logoUrl)

  return (
    <div className="flex flex-wrap items-start gap-5 rounded-lg border border-premium-borda bg-premium-bg/50 p-4">
      <div className="relative shrink-0">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border border-premium-borda bg-white shadow-sm">
          {exibida ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo público do Storage ou prévia local (blob:)
            <img src={exibida} alt={`Logotipo de ${nome}`} className="size-full object-contain p-2" />
          ) : (
            <span aria-hidden className="text-3xl font-semibold text-zinc-400">
              {nome.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <label
          htmlFor={id}
          title={temLogoAtual ? 'Trocar logotipo' : 'Enviar logotipo'}
          className="absolute -right-2 -bottom-2 flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-premium-card bg-premium-acento text-zinc-950 shadow transition hover:brightness-110 focus-within:outline-2 focus-within:outline-premium-acento"
        >
          <IconeEditar className="size-4" />
          <span className="sr-only">{temLogoAtual ? 'Trocar logotipo' : 'Enviar logotipo'}</span>
        </label>
      </div>

      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div>
          <p className="font-medium text-premium-texto">Logotipo</p>
          <p className="text-xs text-premium-mudo">PNG, JPG ou WebP, até 2 MB. Aparece no menu lateral para toda a equipe.</p>
        </div>

        <input
          ref={inputRef}
          id={id}
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={aoEscolher}
          className="sr-only"
        />
        {remover && <input type="hidden" name="remover_logo" value="1" />}

        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={id}
            className="cursor-pointer rounded-md border border-premium-borda bg-premium-card px-3 py-1.5 text-sm font-medium text-premium-texto transition hover:border-premium-mudo"
          >
            {temLogoAtual || previa ? 'Trocar logotipo' : 'Enviar logotipo'}
          </label>
          {previa && (
            <button type="button" onClick={cancelarNovo} className="rounded-md px-3 py-1.5 text-sm text-premium-secundario transition hover:bg-premium-card">
              Cancelar troca
            </button>
          )}
          {temLogoAtual && !previa && !remover && (
            <button
              type="button"
              onClick={() => setRemover(true)}
              className="rounded-md px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
            >
              Remover
            </button>
          )}
        </div>

        {previa && (
          <p role="status" className="text-xs text-premium-acento">
            Nova imagem selecionada ({previa.nome}). Ela substitui o logotipo atual quando você salvar.
          </p>
        )}
        {remover && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-red-600 dark:text-red-400">
            O logotipo será removido quando você salvar.
            <button type="button" onClick={() => setRemover(false)} className="font-medium underline underline-offset-2">
              Desfazer
            </button>
          </p>
        )}
        {erro && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {erro}
          </p>
        )}
      </div>
    </div>
  )
}
