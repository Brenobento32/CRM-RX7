import { PontoEtapa } from '@/components/ui/ponto-etapa'
import type { MetricaEtapa, MetricasFunil } from '@/lib/dal/funil-metricas'
import { filtrarPipelinePrincipal } from '@/lib/utils/funil-metricas'
import { DIAS_PARADO } from '@/lib/utils/etapas'
import {
  formatarDuracao,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
} from '@/lib/utils/formatacao'
import { theadClass, tbodyClass } from '@/components/ui/estilos'

/**
 * Indicadores e tabela por etapa. Só apresentação: toda regra (o que conta
 * como aberto, conversão, tempo) vem pronta do DAL.
 */
export function MetricasFunilPainel({ metricas }: { metricas: MetricasFunil }) {
  const { resumo, etapas } = metricas
  const encerradas = resumo.ganhos + resumo.perdidos

  // Mesma separação do funil visual/badges laterais: "sequência principal"
  // (o que `filtrarPipelinePrincipal` já considera pipeline — abertas
  // normais + ganha) nunca misturada com "estados fora do funil" (perdida,
  // No Show, recuperação) — reusa a MESMA função, nenhuma comparação de
  // nome nova aqui.
  const pipelinePrincipal = filtrarPipelinePrincipal(etapas)
  const idsPipeline = new Set(pipelinePrincipal.map((e) => e.etapaId))
  const foraDoFunil = etapas.filter((e) => !idsPipeline.has(e.etapaId))

  const cards = [
    {
      rotulo: 'Total entraram',
      valor: String(resumo.totalEntraram),
      detalhe: 'Negociações criadas no período (coorte)',
    },
    {
      rotulo: 'Oportunidades',
      valor: String(resumo.oportunidades),
      detalhe: 'Negociações em etapas abertas, agora',
    },
    {
      rotulo: 'Valor em pipeline',
      valor: formatarMoedaCompacta(resumo.pipelineValor),
      titulo: formatarMoeda(resumo.pipelineValor),
      detalhe: 'Estimado das oportunidades abertas',
    },
    {
      rotulo: 'Valor fechado',
      valor: formatarMoedaCompacta(resumo.fechadoValor),
      titulo: formatarMoeda(resumo.fechadoValor),
      detalhe: `${resumo.ganhos} ${resumo.ganhos === 1 ? 'negócio' : 'negócios'} no período`,
    },
    {
      rotulo: 'Conversão geral',
      valor: resumo.conversao === null ? '—' : formatarPercentual(resumo.conversao),
      detalhe:
        encerradas === 0
          ? 'Nenhuma encerrada no período'
          : `${resumo.ganhos} ganhas de ${encerradas} encerradas`,
    },
    {
      rotulo: `Parados há +${DIAS_PARADO} dias`,
      valor: String(resumo.parados),
      detalhe: 'Cards sem mudar de etapa aberta',
      alerta: resumo.parados > 0,
    },
  ]

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.rotulo}
            className={`rounded-lg border bg-premium-card p-4 text-premium-texto ${c.alerta ? 'border-amber-800' : 'border-premium-borda'}`}
          >
            <dt className="text-sm text-premium-secundario">
              {c.alerta && <span aria-hidden>⏱ </span>}
              {c.rotulo}
            </dt>
            <dd className="mt-1 text-2xl font-semibold" title={c.titulo}>
              {c.valor}
            </dd>
            <dd className="mt-1 text-xs text-premium-mudo">{c.detalhe}</dd>
          </div>
        ))}
      </dl>

      <details open className="rounded-lg border border-premium-borda bg-premium-card text-premium-secundario">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-premium-texto">Tabela detalhada por etapa</summary>

        {/* Duas tabelas separadas, nunca misturadas (pedido explícito): a
            sequência principal de conversão primeiro, depois os estados
            FORA do cone (Perdido/No Show/Recuperação) — mesma classificação
            de `filtrarPipelinePrincipal`, a mesma usada pelo funil visual. */}
        <TabelaEtapas titulo="Sequência principal" etapas={pipelinePrincipal} totalEntraram={resumo.totalEntraram} />
        {foraDoFunil.length > 0 && (
          <TabelaEtapas
            titulo="Estados fora do funil (não avançam o pipeline)"
            etapas={foraDoFunil}
            totalEntraram={resumo.totalEntraram}
            borda
          />
        )}

        <p className="border-t border-premium-borda px-4 py-2.5 text-xs text-premium-mudo">
          Cards e valor: etapas abertas, agora (exclui arquivadas e excluídas). Fechado: vendas reais no
          período, pela data de fechamento — mesmo que a negociação tenha sido arquivada depois. Perdido:
          entrou na etapa no período; valor é estimativa atual, não o valor real da época. &ldquo;Desde a
          entrada&rdquo; e &ldquo;Avançam para a próxima&rdquo; são sobre as negociações que entraram no funil no período
          selecionado, mas mostram o avanço delas até agora — podem ter avançado depois do período, e
          isso ainda conta. Tempo médio: passagens concluídas no período, pelo histórico de etapas. Estados
          fora do funil (Perdido/No Show/Recuperação) nunca são &ldquo;etapa anterior&rdquo; de ninguém — por isso não
          têm &ldquo;Avançam para a próxima&rdquo;.
        </p>
      </details>
    </div>
  )
}

/** Uma tabela de etapas — reusada pela sequência principal e pelos estados fora do funil, mesmas colunas nas duas. */
function TabelaEtapas({
  titulo,
  etapas,
  totalEntraram,
  borda = false,
}: {
  titulo: string
  etapas: MetricaEtapa[]
  totalEntraram: number
  /** `true`: separador visual de cima — pra distinguir da tabela anterior sem duplicar o `<details>` inteiro. */
  borda?: boolean
}) {
  if (etapas.length === 0) return null

  return (
    <div className={borda ? 'border-t border-premium-borda' : ''}>
      <p className="px-4 pt-3 pb-1 text-xs font-semibold text-premium-secundario">{titulo}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className="px-4 py-2 text-left font-medium">Etapa</th>
              <th className="px-4 py-2 text-right font-medium">Cards</th>
              <th className="px-4 py-2 text-right font-medium">Valor</th>
              <th className="px-4 py-2 text-right font-medium">Desde a entrada</th>
              <th className="px-4 py-2 text-left font-medium">Avançam para a próxima</th>
              <th className="px-4 py-2 text-right font-medium">Tempo médio na etapa</th>
              <th className="px-4 py-2 text-right font-medium">Cards atuais, em média há</th>
              <th className="px-4 py-2 text-right font-medium">+{DIAS_PARADO} dias</th>
            </tr>
          </thead>
          <tbody className={`${tbodyClass} tabular-nums`}>
            {etapas.map((e) => (
              <LinhaEtapa key={e.etapaId} etapa={e} totalEntraram={totalEntraram} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LinhaEtapa({ etapa: e, totalEntraram }: { etapa: MetricaEtapa; totalEntraram: number }) {
  const aberta = e.tipo === 'aberta'
  return (
    <tr>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <PontoEtapa cor={e.cor} />
          {e.nome}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">{e.quantidade}</td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        {e.tipo === 'perdida' ? (
          <span title="Valor estimado atual das negociações perdidas — o campo não guarda histórico, é aproximado, não o valor real no momento da perda">
            ≈ {formatarMoeda(e.valor)}
          </span>
        ) : (
          formatarMoeda(e.valor)
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {e.conversaoAcumulada === null ? (
          <span className="text-premium-mudo" title="Nenhuma negociação entrou no funil neste período">—</span>
        ) : (
          <span title={`${e.alcancaram} de ${totalEntraram} que entraram no período`}>
            {formatarPercentual(e.conversaoAcumulada)}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {e.proxima ? (
          <Conversao fracao={e.conversaoProxima} detalhe={`${e.proxima.alcancaram} de ${e.alcancaram} → ${e.proxima.nome}`} />
        ) : (
          <span className="text-premium-mudo">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        {aberta && e.tempoMedioSegundos !== null ? (
          <span title={`${e.permanencias} ${e.permanencias === 1 ? 'passagem' : 'passagens'} concluída(s) no período`}>
            {formatarDuracao(e.tempoMedioSegundos)}
          </span>
        ) : (
          <span className="text-premium-mudo">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        {aberta && e.paradosMedioSegundos !== null ? formatarDuracao(e.paradosMedioSegundos) : <span className="text-premium-mudo">—</span>}
      </td>
      <td className="px-4 py-2.5 text-right">
        {!aberta ? (
          <span className="text-premium-mudo">—</span>
        ) : e.parados > 0 ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">{e.parados}</span>
        ) : (
          0
        )}
      </td>
    </tr>
  )
}

/** Percentual com barra no mesmo tom; o número sempre visível. */
function Conversao({ fracao, detalhe }: { fracao: number | null; detalhe: string }) {
  if (fracao === null) {
    return <span className="text-premium-mudo" title="Nenhuma negociação do período chegou a esta etapa">—</span>
  }
  return (
    <span className="flex items-center gap-2" title={detalhe}>
      <span className="w-12 text-right font-medium">{formatarPercentual(fracao)}</span>
      <span className="h-1.5 w-20 rounded-full bg-premium-borda" aria-hidden>
        <span className="block h-full rounded-full bg-premium-acento" style={{ width: `${Math.min(fracao, 1) * 100}%` }} />
      </span>
      <span className="truncate text-xs text-premium-mudo">{detalhe}</span>
    </span>
  )
}
