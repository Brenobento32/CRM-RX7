export type TomSelo = 'neutro' | 'verde' | 'ambar' | 'vermelho' | 'azul' | 'roxo'

const TONS: Record<TomSelo, string> = {
  neutro: 'bg-premium-bg text-premium-secundario ring-premium-borda',
  verde: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300',
  ambar: 'bg-amber-500/10 text-amber-800 ring-amber-600/25 dark:text-amber-300',
  vermelho: 'bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300',
  azul: 'bg-sky-500/10 text-sky-700 ring-sky-600/20 dark:text-sky-300',
  roxo: 'bg-violet-500/10 text-violet-700 ring-violet-600/20 dark:text-violet-300',
}

/** Selo de status/categoria. A cor reforça, o texto informa (nunca só cor). */
export function Selo({ tom = 'neutro', children, className = '' }: { tom?: TomSelo; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        // Quem pede outra quebra (ex.: rótulos longos) não recebe o nowrap padrão — duas classes da mesma propriedade não se sobrepõem pela ordem.
        className.includes('whitespace-') ? '' : 'whitespace-nowrap'
      } ${TONS[tom]} ${className}`}
    >
      {children}
    </span>
  )
}
