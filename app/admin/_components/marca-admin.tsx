import { MarcaAvante } from '@/components/marca/logo-avante'

/** "AVANTE CRM — Administração": a identificação do portal da plataforma, em todas as telas dele. */
export function MarcaAdmin({ grande = false }: { grande?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <MarcaAvante className={grande ? 'h-10 w-auto' : 'h-7 w-auto'} />
      <span
        className={`border-l border-premium-borda pl-3 font-medium tracking-tight text-premium-mudo ${grande ? 'text-base' : 'text-sm'}`}
      >
        Administração
      </span>
    </span>
  )
}
