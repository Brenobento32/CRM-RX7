'use client'

import { useEffect, useId, useState } from 'react'

import { botaoPrimarioClass } from '@/components/ui/estilos'

const TIPOS = ['image/png', 'image/jpeg', 'image/webp']
const TAMANHO_MAXIMO = 2 * 1024 * 1024

/**
 * Troca da logo do AVANTE CRM (uma variante): mostra a logo em uso sobre o
 * fundo do tema dela e, ao escolher um arquivo, a PRÉVIA da nova logo no
 * mesmo fundo, antes de salvar. O servidor valida de novo (tipo, tamanho,
 * Super Admin no banco e no storage).
 */
export function CampoLogoPlataforma({
  variante,
  emUso,
  personalizada,
}: {
  variante: 'claro' | 'escuro'
  emUso: string
  personalizada: boolean
}) {
  const id = useId()
  const [previa, setPrevia] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (previa) URL.revokeObjectURL(previa)
    },
    [previa],
  )

  function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    setErro(null)
    setPrevia(null)
    if (!arquivo) return
    if (!TIPOS.includes(arquivo.type)) {
      setErro('Use uma imagem PNG, JPG ou WebP (PNG com fundo transparente fica melhor).')
      e.target.value = ''
      return
    }
    if (arquivo.size > TAMANHO_MAXIMO) {
      setErro('A logo pode ter no máximo 2 MB.')
      e.target.value = ''
      return
    }
    setPrevia(URL.createObjectURL(arquivo))
  }

  const fundo = variante === 'claro' ? 'bg-[#f5f6f4] border-black/10' : 'bg-[#0c0f11] border-white/10'

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="space-y-1.5">
          <figcaption className="text-xs font-medium text-premium-mudo">
            Em uso {personalizada ? '(personalizada)' : '(oficial do AVANTE CRM)'}
          </figcaption>
          <div data-logo-em-uso={variante} className={`flex h-28 items-center justify-center rounded-lg border p-4 ${fundo}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo do storage ou de /public */}
            <img src={emUso} alt={`Logo do modo ${variante} em uso`} className="max-h-full max-w-full object-contain" />
          </div>
        </figure>
        <figure className="space-y-1.5">
          <figcaption className="text-xs font-medium text-premium-mudo">Prévia da nova logo</figcaption>
          <div data-logo-previa={variante} className={`flex h-28 items-center justify-center rounded-lg border border-dashed p-4 ${fundo}`}>
            {previa ? (
              // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:)
              <img src={previa} alt={`Prévia da logo do modo ${variante}`} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className={`text-xs ${variante === 'claro' ? 'text-black/45' : 'text-white/45'}`}>
                Escolha um arquivo para ver aqui
              </span>
            )}
          </div>
        </figure>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="text-sm font-medium text-premium-texto">
          Nova logo
        </label>
        <input
          id={id}
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={aoEscolher}
          className="text-sm text-premium-secundario file:mr-3 file:rounded-lg file:border file:border-premium-borda file:bg-premium-card file:px-3 file:py-1.5 file:text-sm file:text-premium-texto"
        />
        <button type="submit" disabled={!previa} className={`${botaoPrimarioClass} disabled:cursor-not-allowed disabled:opacity-50`}>
          Salvar logo
        </button>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}
    </div>
  )
}
