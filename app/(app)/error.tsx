'use client'

import Link from 'next/link'

import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'

/**
 * Erro inesperado numa tela interna. Não mostra detalhes técnicos (podem
 * conter dados); oferece tentar de novo e o código de referência do Next
 * (`digest`) para o suporte cruzar com o log do servidor.
 */
export default function ErroDaPagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <p className="text-sm font-semibold tracking-wide text-red-600 dark:text-red-400">Algo deu errado</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-premium-texto">Não foi possível carregar esta tela</h1>
      <p className="mt-2 text-sm text-premium-secundario">
        Seus dados não foram alterados. Tente de novo; se continuar, fale com o suporte informando o código abaixo.
      </p>
      {error.digest && (
        <p className="mt-3 rounded-md bg-premium-bg px-2 py-1 font-mono text-xs text-premium-mudo">Código: {error.digest}</p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={botaoPrimarioClass}>
          Tentar de novo
        </button>
        <Link href="/" className={botaoSecundarioClass}>
          Ir para o Início
        </Link>
      </div>
    </div>
  )
}
