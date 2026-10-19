import Link from 'next/link'

import { mesAtual, rotuloMes, somarMeses } from '@/lib/utils/periodo'

const seta =
  'rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'

/**
 * Links, não estado de cliente: o mês fica na URL e o servidor recalcula.
 *
 * `caminhoBase` é a URL completa (caminho + `?...&`) que antecede o `mes=` —
 * por padrão `/metas?`, mas outras telas (ex.: `/funil/metricas`, que tem
 * seu próprio seletor de PERÍODO operacional, independente deste) passam a
 * própria URL com os demais parâmetros já embutidos, pra trocar de mês sem
 * resetar nada mais da página.
 */
export function SeletorMes({ mes, caminhoBase = '/metas?', nomeParametro = 'mes' }: { mes: string; caminhoBase?: string; nomeParametro?: string }) {
  const atual = mesAtual()
  const anterior = somarMeses(mes, -1)
  const seguinte = somarMeses(mes, 1)
  const href = (m: string) => `${caminhoBase}${nomeParametro}=${m}`

  return (
    <nav
      aria-label="Mês"
      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <Link href={href(anterior)} aria-label={rotuloMes(anterior)} className={seta}>
        ‹
      </Link>
      <span className="min-w-40 px-2 text-center text-sm font-medium">{rotuloMes(mes)}</span>
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
