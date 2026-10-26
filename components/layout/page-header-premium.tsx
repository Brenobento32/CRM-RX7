import Link from 'next/link'

import type { UsuarioAtual } from '@/lib/dal/auth'

/**
 * Cabeçalho de página padrão do AVANTE: contexto (opcional) e título à
 * esquerda, ação principal à direita — sempre na mesma posição, em todas as
 * telas. O usuário/notificações ficam no cabeçalho GLOBAL (`Topbar`).
 */
export function PageHeaderPremium({
  titulo,
  subtitulo,
  voltar,
  acoes,
  contexto,
}: {
  titulo: string
  subtitulo?: React.ReactNode
  voltar?: { href: string; rotulo: string }
  acoes?: React.ReactNode
  /** Rótulo pequeno acima do título (área do sistema, ex.: "CRM"). */
  contexto?: string
  /** Não é mais usado aqui (o usuário vive no cabeçalho global); mantido para compatibilidade. */
  usuario?: UsuarioAtual
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {voltar && (
          <Link
            href={voltar.href}
            className="mb-1.5 inline-flex items-center gap-1 text-sm text-premium-mudo transition hover:text-premium-texto"
          >
            <span aria-hidden>←</span> {voltar.rotulo}
          </Link>
        )}
        {contexto && !voltar && <p className="mb-1 text-xs font-medium tracking-wide text-premium-acento uppercase">{contexto}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-premium-texto sm:text-[26px]">{titulo}</h1>
        {subtitulo && <p className="mt-1 max-w-3xl text-sm text-premium-secundario">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  )
}

/** Mesmo cabeçalho, nome em português para telas novas. */
export const CabecalhoPagina = PageHeaderPremium
