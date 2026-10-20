import Link from 'next/link'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { CardMetaFunil, PALETA_FUNIL } from '@/components/metas/cards-meta-funil'
import type { ProgressoEmpresa, ProgressoFunilMeta } from '@/lib/dal/metas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'
import { rotuloMes } from '@/lib/utils/periodo'

import { IconeMoeda } from './icones-metricas'

/**
 * "Meta mensal — [mês/ano]" — mês cheio, navegável pelo PRÓPRIO seletor
 * (`seletorMes`, independente do seletor de período operacional ao lado —
 * `SeletorPeriodoFunil`): essas são duas perguntas diferentes ("a empresa
 * bateu a meta de outubro?" vs. "como foi a conversão nos últimos 7
 * dias?"), cada uma com seu próprio mês/período. `progressoEmpresa` vem de
 * `obterProgressoMetas(mes)` (RPC `metas_progresso`); `progressoFunis` vem
 * de `obterProgressoMetasFunis(mes)` (RPC `metas_funis_progresso`,
 * migration 20261019180000) — cada funil ativo com sua própria meta
 * TCV/MRR, nunca uma divisão da meta geral. O círculo de progresso desta
 * mesma meta mensal vive em `DonutMetaMensal` (painel central do topo da
 * página) — mesmos dados (`progressoEmpresa`), outro lugar na tela.
 */
export function MetaMensal({
  mes,
  progressoEmpresa,
  progressoFunis,
  seletorMes,
}: {
  /** AAAA-MM do mês de referência — o que `seletorMes` tem selecionado agora. */
  mes: string
  progressoEmpresa: ProgressoEmpresa | null
  progressoFunis: ProgressoFunilMeta[]
  /** `<SeletorMes caminhoBase="/funil/metricas?...&" nomeParametro="mesMeta" mes={mes} />` — próprio, nunca o período operacional. */
  seletorMes: React.ReactNode
}) {
  const somaMetasFunis = (tipo: 'tcv' | 'mrr') =>
    progressoFunis.reduce((soma, f) => soma + (f[tipo].valorMeta ?? 0), 0)

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">Meta mensal — {rotuloMes(mes)}</h2>
          <p className="text-xs text-zinc-500">
            Mês inteiro, nunca proporcional — todos os responsáveis. Independe do período de análise selecionado abaixo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {seletorMes}
          <Link href="/metas" className={botaoSecundarioClass}>
            Gerenciar metas →
          </Link>
        </div>
      </div>

      {progressoEmpresa && progressoFunis.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <AvisoDivergencia totalMeta={progressoEmpresa.tcv.valorMeta} somaMetasFunis={somaMetasFunis('tcv')} rotulo="TCV" />
          <AvisoDivergencia totalMeta={progressoEmpresa.mrr.valorMeta} somaMetasFunis={somaMetasFunis('mrr')} rotulo="MRR" />
        </div>
      )}

      {progressoEmpresa || progressoFunis.length > 0 ? (
        // Mesma lógica de `@container` da página (`/funil/metricas/page.tsx`):
        // colunas pela largura REAL do container, não pelo viewport.
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @5xl:grid-cols-4">
          {progressoEmpresa && (
            <>
              <CardMetaGeral titulo="TCV geral" dados={progressoEmpresa.tcv} cor="emerald" />
              <CardMetaGeral titulo="MRR geral" dados={progressoEmpresa.mrr} cor="sky" />
            </>
          )}
          {progressoFunis.map((p, i) => (
            <CardMetaFunil key={p.funilId} progresso={p} cor={PALETA_FUNIL[i % PALETA_FUNIL.length]} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Nenhuma meta visível para o seu papel.</p>
      )}
    </section>
  )
}

function CardMetaGeral({
  titulo,
  dados,
  cor,
}: {
  titulo: string
  dados: ProgressoEmpresa['tcv']
  cor: 'emerald' | 'sky'
}) {
  const trilho = cor === 'emerald' ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-sky-100 dark:bg-sky-950'
  const fill = cor === 'emerald' ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-sky-500 dark:bg-sky-400'
  const icone = cor === 'emerald' ? 'text-emerald-500 dark:text-emerald-400' : 'text-sky-500 dark:text-sky-400'

  return (
    <div className="flex min-h-[170px] flex-col justify-center space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="flex items-center gap-1.5 font-semibold">
        <IconeMoeda className={`size-4 ${icone}`} />
        {titulo}
      </p>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Meta</dt>
          <dd className="font-medium tabular-nums">
            {dados.valorMeta === null ? <span className="text-zinc-400">Não definida</span> : formatarMoeda(dados.valorMeta)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Realizado</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(dados.realizado)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Atingido</dt>
          <dd className="font-medium tabular-nums">
            {dados.percentual === null ? <span className="text-zinc-400">—</span> : formatarPercentual(dados.percentual)}
          </dd>
        </div>
      </dl>
      {dados.percentual === null ? (
        <div aria-hidden className={`h-2.5 rounded-full ${trilho}`} />
      ) : (
        <div
          role="progressbar"
          aria-label={`Progresso: ${titulo}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(dados.percentual, 1) * 100)}
          className={`h-2.5 overflow-hidden rounded-full ${trilho}`}
        >
          <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(dados.percentual, 1) * 100}%` }} />
        </div>
      )}
    </div>
  )
}

/**
 * Meta total × soma das metas dos funis podem divergir — por decisão de
 * produto, nunca bloqueia nem distribui/recalcula automaticamente nenhuma
 * das duas (ver migration 20261019180000); só avisa quando os números não
 * coincidem, para o gerente decidir se é intencional.
 */
function AvisoDivergencia({
  totalMeta,
  somaMetasFunis,
  rotulo,
}: {
  totalMeta: number | null
  somaMetasFunis: number
  rotulo: string
}) {
  if (totalMeta === null || somaMetasFunis === 0 || totalMeta === somaMetasFunis) return null
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      A soma das metas {rotulo} dos funis ({formatarMoeda(somaMetasFunis)}) difere da meta {rotulo} total (
      {formatarMoeda(totalMeta)}).
    </p>
  )
}
