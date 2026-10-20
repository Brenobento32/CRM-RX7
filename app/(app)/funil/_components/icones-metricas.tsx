/** Ícones decorativos do dashboard de métricas — SVG inline, sem biblioteca nova. */

export function IconeFunil({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path d="M4 4h16l-6 8.5V19l-4 2v-8.5L4 4Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function IconeAlvo({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  )
}

export function IconeMoeda({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v9M14.5 9.5c0-1-1-1.5-2.5-1.5s-2.5.6-2.5 1.7c0 2.3 5 1 5 3.3 0 1.1-1.1 1.7-2.5 1.7s-2.5-.5-2.5-1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconeTrofeu({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" strokeLinejoin="round" />
      <path d="M8 5H5a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4M16 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
      <path d="M12 13v3m-3 4h6m-3-4v4" strokeLinecap="round" />
    </svg>
  )
}
