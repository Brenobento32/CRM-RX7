/** Bloco de carregamento (pulso suave; some com `prefers-reduced-motion`). */
export function Esqueleto({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-premium-borda/60 ${className}`} />
}

/** Página carregando: cabeçalho, indicadores e um painel — mesma grade das telas. */
export function EsqueletoPagina() {
  return (
    <div role="status" aria-label="Carregando" className="space-y-6">
      <div className="space-y-2">
        <Esqueleto className="h-7 w-56" />
        <Esqueleto className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-premium-borda bg-premium-card p-5">
            <Esqueleto className="h-3 w-24" />
            <Esqueleto className="h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-premium-borda bg-premium-card p-5">
        <Esqueleto className="h-4 w-40" />
        {Array.from({ length: 5 }, (_, i) => (
          <Esqueleto key={i} className="h-9 w-full" />
        ))}
      </div>
      <span className="sr-only">Carregando…</span>
    </div>
  )
}
