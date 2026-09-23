import { PALETA_ETAPAS, type CorEtapa } from '@/lib/utils/etapas'

/** Marcador de cor da etapa. Decorativo: o nome da etapa sempre acompanha. */
export function PontoEtapa({ cor, className = 'size-2.5' }: { cor: CorEtapa; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: PALETA_ETAPAS[cor].hex }}
    />
  )
}
