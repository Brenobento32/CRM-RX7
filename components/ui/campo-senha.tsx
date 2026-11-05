'use client'

import { useState, type InputHTMLAttributes } from 'react'

import { inputClass } from '@/components/ui/estilos'

/**
 * Estado do botão de olho: o campo começa oculto; cada clique alterna. O
 * valor digitado não muda (só o `type` do mesmo input), então nada se perde.
 */
export function estadoCampoSenha(visivel: boolean) {
  return {
    type: visivel ? 'text' : 'password',
    rotulo: visivel ? 'Ocultar senha' : 'Mostrar senha',
    pressionado: visivel,
  } as const
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string; name: string }

/**
 * Campo de senha com botão de mostrar/ocultar. O botão é `type="button"` (nunca
 * envia o formulário), acessível por teclado e com rótulo para leitores de tela.
 */
export function CampoSenha({ id, className, ...props }: Props) {
  const [visivel, setVisivel] = useState(false)
  const estado = estadoCampoSenha(visivel)

  return (
    <div className="relative">
      <input
        {...props}
        id={id}
        type={estado.type}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${className ?? inputClass} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        aria-label={estado.rotulo}
        aria-pressed={estado.pressionado}
        aria-controls={id}
        title={estado.rotulo}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-premium-mudo hover:text-premium-texto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-premium-acento"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-5">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visivel && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  )
}
