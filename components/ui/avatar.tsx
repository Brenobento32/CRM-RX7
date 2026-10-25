import Image from 'next/image'

const TAMANHOS = { sm: 32, md: 40, lg: 72 } as const

function iniciais(nome: string): string {
  // Só palavras que começam com letra: "Ana Gerente (Alfa)" → "AG", não "A(".
  const partes = nome.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p))
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase() || '?'
}

/**
 * Foto do usuário ou, sem foto, as iniciais do nome.
 *
 * `variant="premium"`: usado só pela `Topbar` (casca sempre no design system
 * premium, claro ou escuro pelo `data-theme` da shell) — tokens `premium-*`
 * em vez do `dark:` de SO, senão as iniciais ficariam na cor errada ao
 * alternar o tema do app sem mudar o tema do sistema operacional. As outras
 * telas que usam `Avatar` (`/configuracoes/usuarios`) continuam com o
 * `variant="padrao"` de sempre.
 */
export function Avatar({
  nome,
  fotoUrl,
  tamanho = 'md',
  variant = 'padrao',
}: {
  nome: string
  fotoUrl: string | null
  tamanho?: keyof typeof TAMANHOS
  variant?: 'padrao' | 'premium'
}) {
  const px = TAMANHOS[tamanho]

  if (fotoUrl) {
    return (
      <Image
        src={fotoUrl}
        alt={`Foto de ${nome}`}
        width={px}
        height={px}
        className="shrink-0 rounded-full object-cover"
        style={{ width: px, height: px }}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${
        variant === 'premium'
          ? 'bg-premium-borda text-premium-secundario'
          : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
      style={{ width: px, height: px, fontSize: px * 0.38 }}
    >
      {iniciais(nome)}
    </span>
  )
}
