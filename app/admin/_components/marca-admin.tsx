/** "AVANTE — Administração": a identificação do portal da plataforma, em todas as telas dele. */
export function MarcaAdmin({ grande = false }: { grande?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-lg bg-premium-acento font-bold text-premium-acento-texto ${grande ? 'size-10 text-base' : 'size-8 text-sm'}`}
      >
        A
      </span>
      <span className={`font-semibold tracking-tight text-premium-texto ${grande ? 'text-lg' : ''}`}>
        AVANTE <span className="font-normal text-premium-mudo">—</span> Administração
      </span>
    </span>
  )
}
