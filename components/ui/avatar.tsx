import Image from 'next/image'

const TAMANHOS = { sm: 32, md: 40, lg: 72 } as const

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase() || '?'
}

/** Foto do usuário ou, sem foto, as iniciais do nome. */
export function Avatar({
  nome,
  fotoUrl,
  tamanho = 'md',
}: {
  nome: string
  fotoUrl: string | null
  tamanho?: keyof typeof TAMANHOS
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
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      style={{ width: px, height: px, fontSize: px * 0.38 }}
    >
      {iniciais(nome)}
    </span>
  )
}
