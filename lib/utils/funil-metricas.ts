import type { CorEtapa, TipoEtapa } from '@/lib/utils/etapas'

/**
 * Linha bruta devolvida por `public.funil_metricas` (RPC). Tipo próprio —
 * não `Database['public']['Functions']['funil_metricas']['Returns']` —
 * porque `lib/types/database.ts` só é regenerado depois que a migration
 * roda contra um banco real; este tipo descreve o contrato da função como
 * ela está definida em
 * `supabase/migrations/20261015100000_funil_metricas_entidade_unica.sql`.
 */
export type LinhaFunilMetricasRpc = {
  etapa_id: string
  nome: string
  cor: CorEtapa
  tipo: TipoEtapa
  ordem: number | string
  pos_fechamento: boolean
  quantidade: number | string
  valor: number | string
  alcancaram: number | string
  tempo_medio_segundos: number | string | null
  permanencias: number | string
  parados_medio_segundos: number | string | null
  parados_7_dias: number | string
  total_entraram: number | string
}

export type MetricaEtapa = {
  etapaId: string
  nome: string
  cor: CorEtapa
  tipo: TipoEtapa
  ordem: number
  /** true = zona de recuperação (depois de ganha/perdida) — nunca é "próxima" de etapa normal. */
  posFechamento: boolean
  /** Abertas: agora (exclui arquivada/excluída/cliente-excluído). Ganha/perdida: evento histórico completo. */
  quantidade: number
  /**
   * Abertas: valor estimado atual. Ganha: valor vendido real
   * (`fechamentos.valor_vendido`). Perdida: valor estimado ATUAL (sem
   * histórico de alterações) — aproximado, não é o valor real no momento
   * da perda. Nunca apresentar isoladamente como indicador financeiro
   * confiável sem indicar que é estimado.
   */
  valor: number
  /** Negociações da coorte que alcançaram esta etapa — evolução até agora, nunca inferido por etapa pulada. */
  alcancaram: number
  /** Etapa seguinte do pipeline normal (exclui recuperação); `null` em ganha/perdida/recuperação. */
  proxima: { nome: string; alcancaram: number } | null
  /** alcancaram(próxima) ÷ alcancaram(esta). `null` sem base. */
  conversaoProxima: number | null
  /** alcancaram(esta) ÷ totalEntraram da coorte. `null` sem base. */
  conversaoAcumulada: number | null
  /** Média das permanências concluídas no período. `null` sem nenhuma. */
  tempoMedioSegundos: number | null
  permanencias: number
  /** Abertas: há quanto tempo, em média, os cards atuais estão na etapa. */
  paradosMedioSegundos: number | null
  /** Abertas: cards atuais há mais de DIAS_PARADO dias na etapa. */
  parados: number
}

export type ResumoFunil = {
  /** Tamanho da coorte do período — toda negociação criada nele, sem exclusões. */
  totalEntraram: number
  /** Etapas abertas do pipeline normal, agora (exclui recuperação e arquivada/excluída/cliente-excluído). */
  oportunidades: number
  pipelineValor: number
  /** Valor vendido no período (venda histórica real, `fechamentos.data_fechamento`). */
  fechadoValor: number
  ganhos: number
  perdidos: number
  /** Ganhos ÷ (ganhos + perdidos) no período. */
  conversao: number | null
  parados: number
}

export type MetricasFunil = { resumo: ResumoFunil; etapas: MetricaEtapa[] }

/**
 * Mesma fórmula de `taxaConversao` em `lib/dal/dashboard.ts` — duplicada
 * aqui (3 linhas) em vez de importada, porque aquele arquivo é
 * `server-only` e este precisa ficar puro/testável sem Supabase.
 */
function taxaConversao(ganhos: number, perdidos: number): number | null {
  const encerradas = ganhos + perdidos
  return encerradas === 0 ? null : ganhos / encerradas
}

/**
 * A sequência do pipeline NORMAL de um funil: etapas abertas com
 * `posFechamento = false`, pela ordem, seguidas da etapa ganha — nunca a
 * de recuperação, nunca a perdida. Usada tanto para calcular
 * `conversaoProxima`/`conversaoAcumulada` quanto para o funil visual —
 * MESMA função, para que o gráfico e a tabela nunca divirjam em "o que
 * conta como pipeline principal".
 *
 * Genérica (`T`) porque é chamada tanto sobre as linhas cruas (antes de
 * `conversaoProxima` existir, para calculá-lo) quanto sobre `MetricaEtapa[]`
 * já pronto (pela UI) — mesmo filtro, nenhuma lógica duplicada.
 */
export function filtrarPipelinePrincipal<T extends { tipo: TipoEtapa; posFechamento: boolean }>(
  etapas: T[],
): T[] {
  return [
    ...etapas.filter((e) => e.tipo === 'aberta' && !e.posFechamento),
    ...etapas.filter((e) => e.tipo === 'ganha'),
  ]
}

/**
 * Processa o resultado bruto de `funil_metricas` em `MetricasFunil`.
 * Lógica pura — nenhuma chamada de rede, testável direto com fixtures.
 */
export function processarMetricasFunil(data: LinhaFunilMetricasRpc[]): MetricasFunil {
  const linhas = data
    .map((l) => ({
      etapaId: l.etapa_id,
      nome: l.nome,
      cor: l.cor,
      tipo: l.tipo,
      ordem: Number(l.ordem),
      posFechamento: l.pos_fechamento,
      quantidade: Number(l.quantidade),
      valor: Number(l.valor),
      alcancaram: Number(l.alcancaram),
      tempoMedioSegundos: l.tempo_medio_segundos === null ? null : Number(l.tempo_medio_segundos),
      permanencias: Number(l.permanencias),
      paradosMedioSegundos: l.parados_medio_segundos === null ? null : Number(l.parados_medio_segundos),
      parados: Number(l.parados_7_dias),
      totalEntraram: Number(l.total_entraram),
    }))
    .sort((a, b) => a.ordem - b.ordem)

  const totalEntraram = linhas[0]?.totalEntraram ?? 0

  const sequencia = filtrarPipelinePrincipal(linhas)

  const etapas: MetricaEtapa[] = linhas.map((l) => {
    const i = sequencia.findIndex((s) => s.etapaId === l.etapaId)
    const temProxima = l.tipo === 'aberta' && !l.posFechamento
    const proxima = temProxima ? sequencia[i + 1] : undefined
    return {
      ...l,
      proxima: proxima ? { nome: proxima.nome, alcancaram: proxima.alcancaram } : null,
      conversaoProxima: proxima && l.alcancaram > 0 ? proxima.alcancaram / l.alcancaram : null,
      conversaoAcumulada: totalEntraram > 0 ? l.alcancaram / totalEntraram : null,
    }
  })

  const abertasNormais = etapas.filter((e) => e.tipo === 'aberta' && !e.posFechamento)
  const ganhos = etapas.find((e) => e.tipo === 'ganha')
  const perdidos = etapas.find((e) => e.tipo === 'perdida')

  return {
    etapas,
    resumo: {
      totalEntraram,
      oportunidades: abertasNormais.reduce((s, e) => s + e.quantidade, 0),
      pipelineValor: abertasNormais.reduce((s, e) => s + e.valor, 0),
      fechadoValor: ganhos?.valor ?? 0,
      ganhos: ganhos?.quantidade ?? 0,
      perdidos: perdidos?.quantidade ?? 0,
      conversao: taxaConversao(ganhos?.quantidade ?? 0, perdidos?.quantidade ?? 0),
      parados: abertasNormais.reduce((s, e) => s + e.parados, 0),
    },
  }
}
