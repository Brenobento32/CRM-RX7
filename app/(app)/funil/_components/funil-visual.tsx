import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { corDeFundoAgenda } from '@/lib/utils/etapas'
import { filtrarPipelinePrincipal, type MetricaEtapa, type MetricasFunil } from '@/lib/utils/funil-metricas'
import { formatarMoeda, formatarPercentual } from '@/lib/utils/formatacao'

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
export function FunilVisual({ metricas }: { metricas: MetricasFunil }) {
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

  return (
    <section aria-label="Funil de conversão visual" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Funil de conversão</h2>
        <p className="text-xs text-zinc-500">Conversão da coorte — evolução até o momento.</p>
      </div>

      <ol className="space-y-3">
        <LinhaFunilBase quantidade={resumo.totalEntraram} />
        {pipeline.map((etapa, i) => (
          <LinhaFunil
            key={etapa.etapaId}
            etapa={etapa}
            // A primeira etapa compara com a entrada (mesma base de
            // conversaoAcumulada); as demais comparam com a etapa anterior
            // da própria sequência (conversaoProxima DELA, não recalculado).
            percentualAnterior={i === 0 ? etapa.conversaoAcumulada : pipeline[i - 1].conversaoProxima}
          />
        ))}
      </ol>

      {(perdido || recuperacao.length > 0) && (
        <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
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

function LinhaFunilBase({ quantidade }: { quantidade: number }) {
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Leads entraram</span>
        <span className="text-lg font-semibold tabular-nums">{quantidade}</span>
      </div>
      <div aria-hidden className="h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full w-full rounded-full bg-zinc-800 dark:bg-zinc-300" />
      </div>
      <p className="text-xs text-zinc-500">Negociações criadas no período (coorte)</p>
    </li>
  )
}

function LinhaFunil({
  etapa,
  percentualAnterior,
}: {
  etapa: MetricaEtapa
  percentualAnterior: number | null
}) {
  const largura = Math.round(Math.max(Math.min(etapa.conversaoAcumulada ?? 0, 1), 0.02) * 100)

  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="flex items-center gap-2 font-medium">
          <PontoEtapa cor={etapa.cor} />
          {etapa.nome}
        </span>
        <span className="text-lg font-semibold tabular-nums">{etapa.alcancaram}</span>
      </div>
      <div aria-hidden className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${largura}%`, backgroundColor: corDeFundoAgenda(etapa.cor) }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500">
        {percentualAnterior !== null ? (
          <span>
            <strong className="tabular-nums">{formatarPercentual(percentualAnterior)}</strong> da etapa anterior
          </span>
        ) : (
          <span className="text-zinc-400">— da etapa anterior</span>
        )}
        {etapa.conversaoAcumulada !== null ? (
          <span>
            <strong className="tabular-nums">{formatarPercentual(etapa.conversaoAcumulada)}</strong> desde a entrada
          </span>
        ) : (
          <span className="text-zinc-400">— desde a entrada</span>
        )}
      </div>
    </li>
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
