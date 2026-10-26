import Link from 'next/link'

import { botaoPrimarioClass, botaoSecundarioClass } from './estilos'

/**
 * Estado vazio com orientação: o que é esta área e qual o próximo passo.
 * Nunca só "Nenhum item" solto — sempre que houver uma ação possível, ela
 * aparece aqui (`acao`), e só para quem tem permissão (a página decide).
 */
export function EstadoVazio({
  titulo,
  descricao,
  acao,
  acaoSecundaria,
  icone,
  compacto = false,
}: {
  titulo: string
  descricao?: React.ReactNode
  acao?: { href: string; rotulo: string }
  acaoSecundaria?: { href: string; rotulo: string }
  icone?: React.ReactNode
  /** Dentro de cartões pequenos: menos espaço, sem borda tracejada. */
  compacto?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compacto ? 'gap-1.5 px-4 py-6' : 'gap-2 rounded-xl border border-dashed border-premium-borda bg-premium-card/50 px-6 py-12'
      }`}
    >
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-full bg-premium-acento-suave text-premium-acento ${compacto ? 'mb-1 size-8' : 'mb-2 size-11'}`}
      >
        {icone ?? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={compacto ? 'size-4' : 'size-5'}>
            <path d="M4 7h16M4 12h10M4 17h6" />
          </svg>
        )}
      </span>
      <p className={`font-medium text-premium-texto ${compacto ? 'text-sm' : 'text-base'}`}>{titulo}</p>
      {descricao && <p className="max-w-md text-sm text-premium-mudo">{descricao}</p>}
      {(acao || acaoSecundaria) && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {acao && (
            <Link href={acao.href} className={botaoPrimarioClass}>
              {acao.rotulo}
            </Link>
          )}
          {acaoSecundaria && (
            <Link href={acaoSecundaria.href} className={botaoSecundarioClass}>
              {acaoSecundaria.rotulo}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
