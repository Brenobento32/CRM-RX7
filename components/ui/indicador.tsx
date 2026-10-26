import Link from 'next/link'

/**
 * Indicador (KPI): rótulo, valor grande, detalhe curto. `destaque` marca o
 * número que mais importa na tela (borda e valor em verde). `href` torna o
 * cartão um atalho para a lista correspondente.
 */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  icone,
  destaque = false,
  href,
}: {
  rotulo: string
  valor: React.ReactNode
  detalhe?: React.ReactNode
  icone?: React.ReactNode
  destaque?: boolean
  href?: string
}) {
  const conteudo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-premium-mudo">{rotulo}</p>
        {icone && (
          <span aria-hidden className={`flex size-7 items-center justify-center rounded-lg ${destaque ? 'bg-premium-acento text-premium-acento-texto' : 'bg-premium-bg text-premium-secundario'}`}>
            {icone}
          </span>
        )}
      </div>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${destaque ? 'text-premium-acento' : 'text-premium-texto'}`}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-premium-mudo">{detalhe}</p>}
    </>
  )
  const classe = `block rounded-xl border bg-premium-card p-4 shadow-premium transition ${destaque ? 'border-premium-acento/40 ring-1 ring-premium-acento/15' : 'border-premium-borda'}`
  return href ? (
    <Link href={href} className={`${classe} hover:border-premium-acento/50 hover:shadow-premium-alta`}>
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  )
}
