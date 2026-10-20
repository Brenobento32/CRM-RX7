/**
 * Primitivos visuais do design system "premium" (fundo escuro) — usados por
 * `/funil/metricas`, `/metas`, `/funil` (Kanban) e pela shell global
 * (sidebar/topbar). Só composição/estilo; nenhum busca dado nem calcula
 * nada — quem usa decide o conteúdo.
 */

/** Painel principal — os três painéis do topo, as seções de /metas, as colunas do Kanban. */
export function PremiumPanel({
  className = '',
  children,
  ...props
}: React.ComponentProps<'section'>) {
  return (
    <section className={`rounded-2xl border border-premium-borda bg-premium-card p-5 ${className}`} {...props}>
      {children}
    </section>
  )
}

/**
 * Card menor, dentro de um grid (meta por funil, meta geral) — fundo um tom
 * mais escuro que `PremiumPanel`, pra criar profundidade. Sem padding
 * default DE PROPÓSITO: `className` sempre inclui o padding (`p-4`, `px-3
 * py-2` etc.) — evita o clássico conflito do Tailwind de duas classes de
 * padding concorrentes (`p-4` da base + `px-3` do chamador) brigando pela
 * mesma propriedade CSS sem uma vencer de forma previsível.
 */
/**
 * Polimórfico em `as` (padrão: `div`, mas aceita `Link` do Next.js, `a` etc.)
 * — pra renderizar um card inteiro clicável (`as={Link} href="/metas"`) sem
 * perder a navegação client-side do Next por trás de um `<a>` cru.
 */
export function PremiumCard<T extends React.ElementType = 'div'>({
  as,
  className = '',
  children,
  ...props
}: { as?: T; className?: string; children?: React.ReactNode } & Omit<
  React.ComponentPropsWithoutRef<T>,
  'as' | 'className' | 'children'
>) {
  const Component = (as ?? 'div') as React.ElementType
  return (
    <Component className={`rounded-xl border border-premium-borda bg-premium-bg/50 ${className}`} {...props}>
      {children}
    </Component>
  )
}

/** Ícone num quadrado colorido — cabeçalhos de painel e de card (TCV/MRR/funil). */
export function IconBadge({
  icone: Icone,
  cor = 'text-premium-acento',
  fundo = 'bg-premium-acento-suave',
  tamanho = 'size-7',
}: {
  icone: (p: { className?: string }) => React.ReactNode
  cor?: string
  fundo?: string
  tamanho?: string
}) {
  return (
    <span className={`flex ${tamanho} shrink-0 items-center justify-center rounded-lg ${fundo}`}>
      <Icone className={`size-4 ${cor}`} />
    </span>
  )
}

export type CorProgresso = { trilho: string; fill: string; texto: string }

export const CORES_PROGRESSO = {
  verde: { trilho: 'bg-emerald-500/15', fill: 'bg-emerald-400', texto: 'text-emerald-400' },
  azul: { trilho: 'bg-sky-500/15', fill: 'bg-sky-400', texto: 'text-sky-400' },
  roxo: { trilho: 'bg-violet-500/15', fill: 'bg-violet-400', texto: 'text-violet-400' },
  rosa: { trilho: 'bg-pink-500/15', fill: 'bg-pink-400', texto: 'text-pink-400' },
  laranja: { trilho: 'bg-orange-500/15', fill: 'bg-orange-400', texto: 'text-orange-400' },
  ambar: { trilho: 'bg-amber-500/15', fill: 'bg-amber-400', texto: 'text-amber-400' },
  teal: { trilho: 'bg-teal-500/15', fill: 'bg-teal-400', texto: 'text-teal-400' },
} as const satisfies Record<string, CorProgresso>

/** Barra de progresso — trilho translúcido, preenchimento sólido, limite visual em 100% (`Math.min`). `null` = trilho vazio, nunca cheio. */
export function ProgressBarPremium({
  percentual,
  cor,
  rotulo,
}: {
  percentual: number | null
  cor: CorProgresso
  rotulo: string
}) {
  if (percentual === null) {
    return <div aria-hidden className={`h-2.5 rounded-full ${cor.trilho}`} />
  }
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(percentual, 1) * 100)}
      className={`h-2.5 overflow-hidden rounded-full ${cor.trilho}`}
    >
      <div className={`h-full rounded-full ${cor.fill}`} style={{ width: `${Math.min(percentual, 1) * 100}%` }} />
    </div>
  )
}

/** Par rótulo/valor — "Meta", "Realizado" etc. dentro dos cards de meta. */
export function StatValue({
  rotulo,
  valor,
  cor = 'text-premium-texto',
}: {
  rotulo: string
  valor: React.ReactNode
  cor?: string
}) {
  return (
    <div>
      <dt className="text-xs text-premium-mudo">{rotulo}</dt>
      <dd className={`font-medium tabular-nums ${cor}`}>{valor}</dd>
    </div>
  )
}
