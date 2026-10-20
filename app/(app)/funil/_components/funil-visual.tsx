import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { classeTextoAgenda, corDeFundoAgenda } from '@/lib/utils/etapas'
import { filtrarPipelinePrincipal, type MetricaEtapa, type MetricasFunil } from '@/lib/utils/funil-metricas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'
import { larguraDegrauFunil, temEntradaDireta } from '@/lib/utils/painel-metricas'

import { IconeFunil } from './icones-metricas'

/**
 * Funil visual — números absolutos e percentuais, lado a lado com a tabela
 * detalhada (que continua existindo para leitura precisa). REGRA CRÍTICA:
 * nenhum número aqui é recalculado — tudo vem pronto de `MetricasFunil`
 * (RPC `funil_metricas` → `lib/dal/funil-metricas.ts` →
 * `lib/utils/funil-metricas.ts`). Este componente só decide COMO exibir,
 * nunca O QUE calcular: `filtrarPipelinePrincipal` é a mesma função que já
 * decide a sequência usada para `conversaoProxima`/`conversaoAcumulada` —
 * se a tabela diz "MQL = 70", o gráfico usa exatamente o mesmo `70`.
 *
 * Números são sempre `alcancaram` (coorte, evolução até o momento) — nunca
 * `quantidade` (estado presente) — porque um funil visual de conversão
 * responde "de quem entrou, quantos chegaram aqui", não "quantos estão
 * aqui agora". Ver "Conversão da coorte — evolução até o momento" na tabela.
 */
export function FunilVisual({ metricas, funilNome }: { metricas: MetricasFunil; funilNome: string }) {
  const { resumo, etapas } = metricas
  const pipeline = filtrarPipelinePrincipal(etapas)
  const recuperacao = etapas.filter((e) => e.posFechamento)
  const perdido = etapas.find((e) => e.tipo === 'perdida')

  if (pipeline.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Este funil ainda não tem etapas configuradas.
      </p>
    )
  }

  // Largura de cada degrau, pré-calculada (pura, `larguraDegrauFunil`) para
  // que cada trapezoide saiba a largura do degrau ANTERIOR (seu topo) sem
  // recalcular nada — a primeira etapa afunila a partir de 100% (a "boca"
  // do funil, a própria entrada).
  const larguras = pipeline.map((etapa) => larguraDegrauFunil(etapa.conversaoAcumulada))

  return (
    <section aria-label="Funil de conversão visual" className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-zinc-800 dark:text-zinc-200">
            <IconeFunil className="size-4 shrink-0 text-zinc-400" />
            Funil de vendas
          </h2>
          <p className="truncate text-sm text-zinc-600 dark:text-zinc-400" title={funilNome}>
            {funilNome}
          </p>
          <p
            className="text-[11px] text-zinc-400"
            title="Leads de origens diferentes podem entrar direto numa etapa mais avançada — por isso os números nem sempre diminuem etapa a etapa."
          >
            Conversão da coorte — evolução até o momento.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Leads entraram <span className="tabular-nums">{resumo.totalEntraram}</span>
        </span>
      </div>

      <ol className="space-y-1">
        <LinhaFunilBase quantidade={resumo.totalEntraram} />
        {pipeline.map((etapa, i) => (
          <LinhaFunil
            key={etapa.etapaId}
            etapa={etapa}
            // A primeira etapa compara com a entrada (mesma base de
            // conversaoAcumulada); as demais comparam com a etapa anterior
            // da própria sequência (conversaoProxima DELA, não recalculado).
            percentualAnterior={i === 0 ? etapa.conversaoAcumulada : pipeline[i - 1].conversaoProxima}
            larguraAnterior={i === 0 ? 100 : larguras[i - 1]}
          />
        ))}
      </ol>

      {(perdido || recuperacao.length > 0) && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="w-full text-xs text-zinc-500">
            Fora da sequência principal — não são &ldquo;próxima etapa&rdquo;:
          </p>
          {perdido && <BadgeLateral etapa={perdido} />}
          {recuperacao.map((r) => (
            <BadgeLateral key={r.etapaId} etapa={r} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Altura (px) de cada degrau/trapezoide do funil — mesma para todos, só a largura varia. */
const ALTURA_DEGRAU = 56

/** `clip-path: polygon(...)` de um trapezoide CENTRALIZADO: `topo`/`base` em % (0–100) da largura total do container. */
function trapezoide(topo: number, base: number): string {
  const inset = (pct: number) => (100 - pct) / 2
  return `polygon(${inset(topo)}% 0, ${100 - inset(topo)}% 0, ${100 - inset(base)}% 100%, ${inset(base)}% 100%)`
}

function LinhaFunilBase({ quantidade }: { quantidade: number }) {
  return (
    <li className="space-y-1">
      <div
        className="mx-auto flex w-full items-center justify-center gap-2 rounded-t-lg bg-zinc-800 text-white dark:bg-zinc-300 dark:text-zinc-900"
        style={{ height: ALTURA_DEGRAU }}
      >
        <span className="text-sm font-medium">Leads entraram</span>
        <span className="text-lg font-bold tabular-nums">{quantidade}</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-center text-[11px] text-zinc-500">
        <span>
          <strong className="tabular-nums">100%</strong> desde a entrada
        </span>
        <span>Negociações criadas no período (coorte)</span>
      </div>
    </li>
  )
}

/**
 * Um degrau do funil — trapezoide CENTRALIZADO (nunca um retângulo
 * alinhado à esquerda): o topo tem a largura do degrau ANTERIOR, a base
 * tem a largura PRÓPRIA (`larguraDegrauFunil(conversaoAcumulada)`, já
 * calculada, nunca recalculada aqui) — a transição entre os dois é o que dá
 * a aparência real de funil, em vez de barras horizontais empilhadas.
 * Como existem entradas diretas em etapas avançadas (origens diferentes
 * entram em pontos diferentes do funil — auditado: `empresa`/
 * `etapa_inicial` configurável por nicho), um degrau pode ser MAIS largo
 * que o anterior; em vez de forçar uma sequência sempre decrescente, isso
 * fica marcado com o selo "inclui entradas diretas".
 */
function LinhaFunil({
  etapa,
  percentualAnterior,
  larguraAnterior,
}: {
  etapa: MetricaEtapa
  percentualAnterior: number | null
  larguraAnterior: number
}) {
  const largura = larguraDegrauFunil(etapa.conversaoAcumulada)
  const entradaDireta = temEntradaDireta(etapa.conversaoAcumulada, percentualAnterior)
  const corTexto = classeTextoAgenda(etapa.cor)

  return (
    <li className="space-y-1">
      <div
        className="relative mx-auto flex w-full items-center justify-center transition-[clip-path]"
        style={{
          height: ALTURA_DEGRAU,
          clipPath: trapezoide(larguraAnterior, largura),
          backgroundColor: corDeFundoAgenda(etapa.cor),
        }}
      >
        <div className={`flex w-full max-w-[94%] items-center justify-between gap-2 px-2 ${corTexto}`}>
          <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
            <span className="truncate">{etapa.nome}</span>
            <span className="shrink-0 text-lg font-bold tabular-nums">{etapa.alcancaram}</span>
          </span>
          {percentualAnterior !== null && (
            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatarPercentual(percentualAnterior)}</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 pt-0.5 text-center text-[11px] text-zinc-500">
        {etapa.conversaoAcumulada !== null ? (
          <span>
            <strong className="tabular-nums">{formatarPercentual(etapa.conversaoAcumulada)}</strong> desde a entrada
          </span>
        ) : (
          <span className="text-zinc-400">— desde a entrada</span>
        )}
        {entradaDireta && (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 font-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="Esta etapa alcançou mais negociações que a etapa anterior — algumas entraram direto aqui, sem passar pela anterior"
          >
            inclui entradas diretas
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * Resumo "Entrada → Ganho" de cada funil disponível, no mesmo período de
 * análise — mesma definição de coorte do funil visual (nunca estado atual):
 * é a `conversaoAcumulada` da própria etapa "ganha" de cada funil
 * (`alcancaram(ganha) ÷ totalEntraram`), já calculada por
 * `processarMetricasFunil`; nada recalculado aqui, só uma lista compacta
 * pra comparar funis sem abrir um de cada vez.
 */
export function TaxaPorFunil({ resumos }: { resumos: { funilId: string; nome: string; metricas: MetricasFunil }[] }) {
  if (resumos.length < 2) return null

  return (
    <section aria-label="Taxa de conversão por funil" className="space-y-2">
      <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Entrada → Ganho, por funil</h3>
      <div className="flex flex-wrap gap-3">
        {resumos.map(({ funilId, nome, metricas }) => {
          const ganha = metricas.etapas.find((e) => e.tipo === 'ganha')
          const taxa = ganha?.conversaoAcumulada ?? null
          return (
            <div
              key={funilId}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <p className="font-medium">{nome}</p>
              <dl className="mt-1 grid grid-cols-3 gap-x-3 text-xs">
                <div>
                  <dt className="text-zinc-500">Entraram</dt>
                  <dd className="font-semibold tabular-nums">{metricas.resumo.totalEntraram}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Ganhos</dt>
                  <dd className="font-semibold tabular-nums">{ganha?.alcancaram ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Conversão</dt>
                  <dd className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                    {taxa === null ? '—' : formatarPercentual(taxa)}
                  </dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Perdido/Recuperação: quantidade real, nunca como etapa de avanço do funil principal. */
function BadgeLateral({ etapa }: { etapa: MetricaEtapa }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <PontoEtapa cor={etapa.cor} />
      <span>{etapa.nome}</span>
      <span className="font-semibold tabular-nums">{etapa.quantidade}</span>
      {etapa.tipo === 'perdida' && (
        <span className="text-xs text-zinc-400" title="Valor estimado atual, aproximado — sem histórico de valor na época da perda">
          ≈ {formatarMoeda(etapa.valor)}
        </span>
      )}
    </div>
  )
}
