import { TextoPercentual } from '@/app/(app)/metas/_components/progresso'
import type { ProgressoFunilMeta } from '@/lib/dal/metas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

/**
 * Paleta por POSIÇÃO (ciclo), nunca pelo nome do funil — "o segundo card é
 * laranja" é consequência do índice, não uma regra amarrada a "Funil
 * Inbound". Um funil novo (sexto, sétimo…) recicla a paleta a partir do
 * início; nunca hardcoded para 2 funis.
 */
export const PALETA_FUNIL = [
  { trilha: 'bg-violet-100 dark:bg-violet-950', fill: 'bg-violet-500 dark:bg-violet-400' },
  { trilha: 'bg-orange-100 dark:bg-orange-950', fill: 'bg-orange-500 dark:bg-orange-400' },
  { trilha: 'bg-teal-100 dark:bg-teal-950', fill: 'bg-teal-500 dark:bg-teal-400' },
  { trilha: 'bg-pink-100 dark:bg-pink-950', fill: 'bg-pink-500 dark:bg-pink-400' },
  { trilha: 'bg-sky-100 dark:bg-sky-950', fill: 'bg-sky-500 dark:bg-sky-400' },
  { trilha: 'bg-amber-100 dark:bg-amber-950', fill: 'bg-amber-500 dark:bg-amber-400' },
] as const

export type CorFunil = (typeof PALETA_FUNIL)[number]

/**
 * Um card por funil ATIVO — a lista vem de `obterProgressoMetasFunis`
 * (RPC `metas_funis_progresso`), que já devolve todo funil ativo
 * automaticamente; um funil novo aparece aqui sem nenhuma mudança de
 * código. Dentro de cada card, TCV e MRR são dois objetivos independentes
 * do mesmo funil — nunca somados numa barra só (mesma regra de `/metas`:
 * TCV e MRR nunca se misturam). Usado tanto em `/funil/metricas`
 * (dashboard) quanto em `/metas` (cards de leitura, abaixo do formulário
 * de cadastro do gerente) — mesmo componente, mesmos dados, para as duas
 * telas nunca divergirem.
 */
export function CardsMetaFunil({ progresso }: { progresso: ProgressoFunilMeta[] }) {
  if (progresso.length === 0) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {progresso.map((p, i) => (
        <CardMetaFunil key={p.funilId} progresso={p} cor={PALETA_FUNIL[i % PALETA_FUNIL.length]} />
      ))}
    </div>
  )
}

/**
 * Exportado para o grid único de `/funil/metricas` (`MetaMensal`), que
 * combina os cards de funil com os cards gerais (TCV/MRR) numa mesma grade —
 * `CardsMetaFunil` (acima) continua existindo à parte para `/metas`, que usa
 * sua própria grade só de funis.
 */
export function CardMetaFunil({ progresso, cor }: { progresso: ProgressoFunilMeta; cor: CorFunil }) {
  return (
    <section className="flex min-h-[170px] flex-col justify-center space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="font-semibold">{progresso.funilNome}</h3>
      <LinhaMetaFunil titulo="TCV" dados={progresso.tcv} cor={cor} />
      <LinhaMetaFunil titulo="MRR" dados={progresso.mrr} cor={cor} />
    </section>
  )
}

function LinhaMetaFunil({
  titulo,
  dados,
  cor,
}: {
  titulo: string
  dados: ProgressoFunilMeta['tcv']
  cor: CorFunil
}) {
  const rotulo = `${titulo} de ${formatarMoeda(dados.realizado)}${
    dados.valorMeta === null ? ', meta não definida' : ` de ${formatarMoeda(dados.valorMeta)}`
  }`

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">{titulo}</span>
        <TextoPercentual percentual={dados.percentual} />
      </div>
      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span className="font-medium">{formatarMoeda(dados.realizado)}</span>
        <span className="text-xs text-zinc-400">
          {dados.valorMeta === null ? 'Meta não definida' : `de ${formatarMoeda(dados.valorMeta)}`}
        </span>
      </div>
      {dados.percentual === null ? (
        <div aria-hidden className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <div
          role="progressbar"
          aria-label={rotulo}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(dados.percentual, 1) * 100)}
          aria-valuetext={formatarPercentual(dados.percentual)}
          className={`h-2 overflow-hidden rounded-full ${cor.trilha}`}
        >
          <div className={`h-full rounded-full ${cor.fill}`} style={{ width: `${Math.min(dados.percentual, 1) * 100}%` }} />
        </div>
      )}
    </div>
  )
}
