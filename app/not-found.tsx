import Link from 'next/link'

import { GarantirTema } from '@/components/layout/garantir-tema'
import { botaoPrimarioClass } from '@/components/ui/estilos'

/** 404 fora da área interna (endereço inexistente sem empresa na URL). */
export default function NaoEncontradaGlobal() {
  return (
    <main className="flex flex-1 items-center justify-center bg-premium-bg px-4 py-16">
      <GarantirTema />
      <div className="flex max-w-md flex-col items-center text-center">
        <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-premium-acento text-lg font-bold text-premium-acento-texto">
          A
        </span>
        <p className="mt-6 text-sm font-semibold tracking-wide text-premium-acento">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-premium-texto">Página não encontrada</h1>
        <p className="mt-2 text-sm text-premium-secundario">Confira o endereço ou volte para o início do AVANTE.</p>
        <Link href="/" className={`${botaoPrimarioClass} mt-6`}>
          Voltar ao AVANTE
        </Link>
      </div>
    </main>
  )
}
