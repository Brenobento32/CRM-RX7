import Link from 'next/link'

import type { UsuarioAtual } from '@/lib/dal/auth'

/**
 * Cabeçalho de página — título + subtítulo à esquerda, ações à direita.
 * O usuário/notificações/menu do perfil ficam no cabeçalho GLOBAL da casca
 * (`ShellApp` + `Topbar`), igual em todas as páginas; aqui não se repetem.
 */
export function PageHeaderPremium({
  titulo,
  subtitulo,
  voltar,
  acoes,
}: {
  titulo: string
  subtitulo?: string
  voltar?: { href: string; rotulo: string }
  acoes?: React.ReactNode
  /** Não é mais usado aqui (o usuário vive no cabeçalho global); mantido para compatibilidade. */
  usuario?: UsuarioAtual
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {voltar && (
          <Link href={voltar.href} className="text-sm text-premium-mudo transition hover:text-premium-texto hover:underline">
            ← {voltar.rotulo}
          </Link>
        )}
        <h1 className={`text-[28px] font-semibold text-premium-texto ${voltar ? 'mt-1' : ''}`}>{titulo}</h1>
        {subtitulo && <p className="text-sm text-premium-secundario">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex items-center gap-4">{acoes}</div>}
    </div>
  )
}
