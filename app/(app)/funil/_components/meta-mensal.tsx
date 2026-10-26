import Link from 'next/link'

import { botaoPrimarioClass } from '@/components/ui/estilos'
import { CORES_PROGRESSO, IconBadge, PremiumCard, ProgressBarPremium, StatValue, type CorProgresso } from '@/components/ui/premium'
import type { ProgressoEmpresa, ProgressoFunilMeta } from '@/lib/dal/metas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'
import { rotuloMes } from '@/lib/utils/periodo'

import { IconeFunil, IconeMoeda, IconeTrofeu } from './icones-metricas'

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
 *
 * Cards próprios deste arquivo (`CardMetaGeral`/`CardMetaFunilPremium`), NÃO
 * os de `components/metas/cards-meta-funil.tsx`: aquele componente é
 * compartilhado com `/metas` — `/metas` agora também adotou o visual
 * premium (ver `app/(app)/metas/page.tsx`), mas por telas diferentes
 * montarem o grid de forma diferente (aqui junto dos cards gerais, lá numa
 * grade própria), cada um mantém seus próprios cards.
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
    <section className="space-y-5 rounded-2xl border border-premium-borda bg-premium-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-premium-texto">
            <IconeTrofeu className="size-4 text-amber-700 dark:text-amber-400" />
            Meta mensal — {rotuloMes(mes)}
          </h2>
          <p className="text-xs text-premium-mudo">
            Acompanhe o desempenho geral e por origem de funil. Mês inteiro, nunca proporcional — independe do período
            de análise selecionado acima.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {seletorMes}
          <Link
            href="/metas"
            className={botaoPrimarioClass}
          >
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
              <CardMetaGeral titulo="TCV geral" dados={progressoEmpresa.tcv} cor={CORES_PROGRESSO.verde} />
              <CardMetaGeral titulo="MRR geral" dados={progressoEmpresa.mrr} cor={CORES_PROGRESSO.azul} />
            </>
          )}
          {progressoFunis.map((p, i) => (
            <CardMetaFunilPremium key={p.funilId} progresso={p} cor={PALETA_FUNIL_PREMIUM[i % PALETA_FUNIL_PREMIUM.length]} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-premium-mudo">Nenhuma meta visível para o seu papel.</p>
      )}
    </section>
  )
}

/** Paleta por POSIÇÃO (ciclo) dos cards de funil — nunca pelo nome do funil, um funil novo recicla a partir do início. */
const PALETA_FUNIL_PREMIUM: CorProgresso[] = [
  CORES_PROGRESSO.roxo,
  CORES_PROGRESSO.rosa,
  CORES_PROGRESSO.ambar,
  CORES_PROGRESSO.teal,
  CORES_PROGRESSO.laranja,
  CORES_PROGRESSO.azul,
]

function CardMetaGeral({ titulo, dados, cor }: { titulo: string; dados: ProgressoEmpresa['tcv']; cor: CorProgresso }) {
  return (
    <PremiumCard
      as={Link}
      href="/metas"
      className="flex min-h-[180px] flex-col justify-center gap-3 bg-premium-bg/40 p-4 transition hover:border-premium-mudo/40"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold text-premium-texto">
          <IconBadge icone={IconeMoeda} cor={cor.texto} fundo={cor.trilho} />
          {titulo}
        </p>
        <span className="text-premium-mudo">›</span>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <StatValue rotulo="Meta" cor="text-premium-texto" valor={dados.valorMeta === null ? <span className="text-premium-mudo">Não definida</span> : formatarMoeda(dados.valorMeta)} />
        <StatValue rotulo="Realizado" cor="text-premium-texto" valor={formatarMoeda(dados.realizado)} />
        <StatValue
          rotulo="Atingido"
          cor={cor.texto}
          valor={dados.percentual === null ? <span className="text-premium-mudo">—</span> : formatarPercentual(dados.percentual)}
        />
      </dl>
      <ProgressBarPremium percentual={dados.percentual} cor={cor} rotulo={`Progresso: ${titulo}`} />
      <p className="text-xs text-premium-mudo">
        {dados.percentual === null ? 'Sem meta' : formatarPercentual(dados.percentual)} da meta ·{' '}
        <span className="tabular-nums">{dados.valorMeta === null ? '—' : formatarMoeda(dados.valorMeta)}</span>
      </p>
    </PremiumCard>
  )
}

/**
 * Card de funil do dashboard escuro — TCV e MRR SEMPRE em barras separadas
 * (nunca somadas, mesma regra de `/metas`), mesmos dados de
 * `ProgressoFunilMeta` (RPC `metas_funis_progresso`).
 */
function CardMetaFunilPremium({ progresso, cor }: { progresso: ProgressoFunilMeta; cor: CorProgresso }) {
  return (
    <PremiumCard className="flex min-h-[180px] flex-col justify-center gap-3 bg-premium-bg/40 p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold text-premium-texto">
          <IconBadge icone={IconeFunil} cor={cor.texto} fundo={cor.trilho} />
          {progresso.funilNome}
        </p>
        <span className="text-premium-mudo">›</span>
      </div>
      <LinhaMetaFunilPremium titulo="TCV" dados={progresso.tcv} cor={cor} />
      <LinhaMetaFunilPremium titulo="MRR" dados={progresso.mrr} cor={cor} />
    </PremiumCard>
  )
}

function LinhaMetaFunilPremium({ titulo, dados, cor }: { titulo: string; dados: ProgressoFunilMeta['tcv']; cor: CorProgresso }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-premium-secundario">{titulo}</span>
        <span className={`font-semibold tabular-nums ${cor.texto}`}>
          {dados.percentual === null ? '—' : formatarPercentual(dados.percentual)}
        </span>
      </div>
      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span className="font-medium text-premium-texto">{formatarMoeda(dados.realizado)}</span>
        <span className="text-xs text-premium-mudo">{dados.valorMeta === null ? 'Sem meta' : `de ${formatarMoeda(dados.valorMeta)}`}</span>
      </div>
      <ProgressBarPremium percentual={dados.percentual} cor={cor} rotulo={`Progresso: ${titulo}`} />
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
