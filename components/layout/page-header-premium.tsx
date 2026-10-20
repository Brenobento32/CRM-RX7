import Link from 'next/link'

import type { UsuarioAtual } from '@/lib/dal/auth'

import { Topbar } from './topbar'

/**
 * Cabeçalho padrão das telas "premium" (fundo escuro) — título + subtítulo
 * à esquerda, `Topbar` (usuário) à direita, na mesma linha, como na
 * referência visual. `voltar`/`acoes` opcionais: nem toda tela tem um link
 * de volta ou um botão de ação ao lado do título.
 */
export function PageHeaderPremium({
  titulo,
  subtitulo,
  voltar,
  acoes,
  usuario,
}: {
  titulo: string
  subtitulo?: string
  voltar?: { href: string; rotulo: string }
  acoes?: React.ReactNode
  usuario: UsuarioAtual
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
      <div className="flex items-center gap-4">
        {acoes}
        <Topbar usuario={usuario} />
      </div>
    </div>
  )
}
