import type { CorEtapa, TipoEtapa } from '@/lib/utils/etapas'

/**
 * Linha bruta devolvida por `public.funil_metricas` (RPC). Tipo próprio —
 * não `Database['public']['Functions']['funil_metricas']['Returns']` — não
 * por falta da migration (`20261020140000_funil_metricas_alcance_cumulativo.sql`
 * já está aplicada e os tipos já foram regenerados), mas porque o gerador
 * tipa `bigint`/`numeric` como `number`, enquanto PostgREST de fato serializa
 * esses tipos como STRING em JSON (perda de precisão de `bigint` em `number`
 * puro) — `ordem`/`quantidade`/`valor`/`alcancaram`/etc. chegam como
 * `number | string` na prática; `processarMetricasFunil` sempre usa
 * `Number(...)` para normalizar. Essa diferença é uma limitação real do
 * gerador, não um cast temporário desta rodada. `alcancaram` de etapa
 * PRINCIPAL já vem CUMULATIVO da RPC (nunca recalculado aqui).
 */
export type LinhaFunilMetricasRpc = {
  etapa_id: string
  nome: string
  cor: CorEtapa
  tipo: TipoEtapa
  ordem: number | string
  pos_fechamento: boolean
  participa_conversao: boolean
  quantidade: number | string
  valor: number | string
  alcancaram: number | string
  tempo_medio_segundos: number | string | null
  permanencias: number | string
  parados_medio_segundos: number | string | null
  parados_7_dias: number | string
  total_entraram: number | string
  /** Total ÚNICO da coorte (repetido em toda linha, mesmo padrão de `total_entraram`). */
  desqualificados: number | string
}

export type MetricaEtapa = {
  etapaId: string
  nome: string
  cor: CorEtapa
  tipo: TipoEtapa
  ordem: number
  /** true = zona de recuperação (depois de ganha/perdida) — nunca é "próxima" de etapa normal. */
  posFechamento: boolean
  /** Marcador estruturado (`etapas_funil.participa_conversao`): false = estado lateral (ex.: No Show), nunca um degrau do pipeline principal. */
  participaConversao: boolean
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
  /** Etapas abertas do pipeline normal, agora (exclui recuperação, No Show e arquivada/excluída/cliente-excluído). */
  oportunidades: number
  /** Mesma base de `oportunidades` (exclui recuperação e No Show). */
  pipelineValor: number
  /** Valor vendido no período (venda histórica real, `fechamentos.data_fechamento`). */
  fechadoValor: number
  ganhos: number
  perdidos: number
  /** Ganhos ÷ (ganhos + perdidos) no período. */
  conversao: number | null
  /** Cards parados há +DIAS_PARADO dias (`lib/utils/etapas.ts`), mesma base de `oportunidades` (exclui recuperação e No Show). */
  parados: number
  /** Total da coorte com `arquivada_em is not null` (ação "Desqualificar lead") — nunca por etapa, desqualificar não move a negociação. */
  desqualificados: number
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
 * `posFechamento = false` que PARTICIPAM da conversão (`participaConversao`
 * — marcador estruturado, `etapas_funil.participa_conversao`), pela ordem,
 * seguidas da etapa ganha — nunca a de recuperação, nunca a perdida, nunca
 * um estado lateral tipo No Show. Usada tanto para calcular
 * `conversaoProxima`/`conversaoAcumulada` quanto para o funil visual —
 * MESMA função, para que o gráfico e a tabela nunca divirjam em "o que
 * conta como pipeline principal".
 *
 * CÁLCULO DEFINITIVO: não depende de nome nenhum — só `participaConversao`
 * decide, sempre (nenhum fallback por nome, nem para "No Show"). Migration
 * `20261020140000_funil_metricas_alcance_cumulativo.sql` aplicada — a RPC em
 * produção já devolve `participa_conversao` de verdade.
 *
 * Estados laterais (No Show e outros estados abertos laterais, Perdido,
 * Recuperação) continuam disponíveis no `etapas` completo (nunca removidos
 * do funil/Kanban) — só não participam desta sequência.
 *
 * Genérica (`T`) porque é chamada tanto sobre as linhas cruas (antes de
 * `conversaoProxima` existir, para calculá-lo) quanto sobre `MetricaEtapa[]`
 * já pronto (pela UI) — mesmo filtro, nenhuma lógica duplicada.
 */
export function filtrarPipelinePrincipal<
  T extends { tipo: TipoEtapa; posFechamento: boolean; participaConversao: boolean },
>(etapas: T[]): T[] {
  return [
    ...etapas.filter((e) => e.tipo === 'aberta' && !e.posFechamento && e.participaConversao),
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
      participaConversao: l.participa_conversao,
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

  // `?? 0`: funil sem nenhuma etapa — `data` vem vazio, `linhas[0]`/`data[0]`
  // são `undefined` (nunca por migration pendente: a RPC sempre devolve
  // `total_entraram`/`desqualificados` quando existe ao menos uma linha).
  const totalEntraram = linhas[0]?.totalEntraram ?? 0
  const desqualificados = Number(data[0]?.desqualificados ?? 0)

  const sequencia = filtrarPipelinePrincipal(linhas)

  const etapas: MetricaEtapa[] = linhas.map((l) => {
    const i = sequencia.findIndex((s) => s.etapaId === l.etapaId)
    // Estados laterais nunca estão em `sequencia` (ver
    // `filtrarPipelinePrincipal`): sem este `&& participaConversao`, `i`
    // daria -1 e `sequencia[i + 1]` viraria `sequencia[0]` — a PRIMEIRA
    // etapa do pipeline, por acidente de índice, não por regra de negócio
    // nenhuma.
    const temProxima = l.tipo === 'aberta' && !l.posFechamento && l.participaConversao
    const proxima = temProxima ? sequencia[i + 1] : undefined
    return {
      ...l,
      proxima: proxima ? { nome: proxima.nome, alcancaram: proxima.alcancaram } : null,
      conversaoProxima: proxima && l.alcancaram > 0 ? proxima.alcancaram / l.alcancaram : null,
      conversaoAcumulada: totalEntraram > 0 ? l.alcancaram / totalEntraram : null,
    }
  })

  // "Pipeline aberto" pros AGREGADOS do resumo (oportunidades/pipelineValor/
  // parados) — MESMA condição de `filtrarPipelinePrincipal` (etapa aberta,
  // não pós-fechamento, participa da conversão), repetida aqui porque esta
  // função soma direto sobre `etapas`, sem passar por aquela. Estado
  // lateral nunca é oportunidade aberta de verdade (No Show = não
  // compareceu, não "negócio em andamento").
  const abertasNormais = etapas.filter((e) => e.tipo === 'aberta' && !e.posFechamento && e.participaConversao)
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
      desqualificados,
    },
  }
}
