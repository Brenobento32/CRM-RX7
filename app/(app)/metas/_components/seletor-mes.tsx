import Link from 'next/link'

import { mesAtual, rotuloMes, somarMeses } from '@/lib/utils/periodo'

const SETA_PADRAO =
  'rounded-md px-2.5 py-1.5 text-sm text-premium-secundario transition hover:bg-premium-bg'
const SETA_PREMIUM =
  'rounded-md px-2.5 py-1.5 text-sm text-premium-mudo transition hover:bg-premium-borda hover:text-premium-texto'

/**
 * Links, não estado de cliente: o mês fica na URL e o servidor recalcula.
 *
 * `caminhoBase` é a URL completa (caminho + `?...&`) que antecede o `mes=` —
 * por padrão `/metas?`, mas outras telas (ex.: `/funil/metricas`, que tem
 * seu próprio seletor de PERÍODO operacional, independente deste) passam a
 * própria URL com os demais parâmetros já embutidos, pra trocar de mês sem
 * resetar nada mais da página. `variant="premium"`: visual escuro do
 * dashboard de métricas — `/metas` nunca passa essa prop, continua idêntico.
 */
export function SeletorMes({
  mes,
  caminhoBase = '/metas?',
  nomeParametro = 'mes',
  variant = 'padrao',
}: {
  mes: string
  caminhoBase?: string
  nomeParametro?: string
  variant?: 'padrao' | 'premium'
}) {
  const atual = mesAtual()
  const anterior = somarMeses(mes, -1)
  const seguinte = somarMeses(mes, 1)
  const href = (m: string) => `${caminhoBase}${nomeParametro}=${m}`
  const premium = variant === 'premium'
  const seta = premium ? SETA_PREMIUM : SETA_PADRAO

  return (
    <nav
      aria-label="Mês"
      className={
        premium
          ? 'inline-flex items-center gap-1 rounded-lg border border-premium-borda bg-premium-card p-0.5'
          : 'inline-flex items-center gap-1 rounded-lg border border-premium-borda bg-premium-card p-0.5'
      }
    >
      <Link href={href(anterior)} aria-label={rotuloMes(anterior)} className={seta}>
        ‹
      </Link>
      <span className={`min-w-40 px-2 text-center text-sm font-medium ${premium ? 'text-premium-texto' : ''}`}>
        {rotuloMes(mes)}
      </span>
      <Link href={href(seguinte)} aria-label={rotuloMes(seguinte)} className={seta}>
        ›
      </Link>
      {mes !== atual && (
        <Link href={caminhoBase.replace(/[?&]$/, '')} className={seta}>
          Mês atual
        </Link>
      )}
    </nav>
  )
}
