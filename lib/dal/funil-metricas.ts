import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { taxaConversao } from '@/lib/dal/dashboard'
import { createClient } from '@/lib/supabase/server'
import type { CorEtapa, TipoEtapa } from '@/lib/utils/etapas'
import type { Periodo } from '@/lib/utils/periodo'

export type MetricaEtapa = {
  etapaId: string
  nome: string
  cor: CorEtapa
  tipo: TipoEtapa
  ordem: number
  /** Abertas: agora. Ganha/perdida: encerradas no período. */
  quantidade: number
  valor: number
  /** Negociações criadas no período que passaram por esta etapa ou além. */
  alcancaram: number
  /** Etapa seguinte pela ordem do funil; `null` em ganha/perdida. */
  proxima: { nome: string; alcancaram: number } | null
  /** alcancaram(próxima) ÷ alcancaram(esta), de 0 a 1. `null` sem base. */
  conversaoProxima: number | null
  /** Média das permanências concluídas no período. `null` sem nenhuma. */
  tempoMedioSegundos: number | null
  permanencias: number
  /** Abertas: há quanto tempo, em média, os cards atuais estão na etapa. */
  paradosMedioSegundos: number | null
  /** Abertas: cards atuais há mais de DIAS_PARADO dias na etapa. */
  parados: number
}

export type ResumoFunil = {
  /** Negociações em etapas abertas, agora. */
  oportunidades: number
  pipelineValor: number
  /** Valor vendido no período. */
  fechadoValor: number
  ganhos: number
  perdidos: number
  /** Ganhos ÷ (ganhos + perdidos) no período — mesma regra do dashboard. */
  conversao: number | null
  parados: number
}

export type MetricasFunil = { resumo: ResumoFunil; etapas: MetricaEtapa[] }

/**
 * Métricas do funil. `public.funil_metricas` é SECURITY INVOKER: o closer
 * recebe só os próprios números, o gerente os da equipe — sem filtro aqui.
 *
 * A conversão para a próxima etapa segue a ordem de `etapas_funil`: as
 * abertas em sequência e, depois da última aberta, a etapa ganha.
 */
export async function obterMetricasFunil(periodo: Periodo): Promise<MetricasFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('funil_metricas', {
    p_inicio: periodo.inicio,
    p_fim: periodo.fim,
  })
  if (error) throw new Error('Não foi possível carregar as métricas do funil.', { cause: error })

  const linhas = data
    .map((l) => ({
      etapaId: l.etapa_id,
      nome: l.nome,
      cor: l.cor,
      tipo: l.tipo,
      ordem: Number(l.ordem),
      quantidade: Number(l.quantidade),
      valor: Number(l.valor),
      alcancaram: Number(l.alcancaram),
      tempoMedioSegundos: l.tempo_medio_segundos === null ? null : Number(l.tempo_medio_segundos),
      permanencias: Number(l.permanencias),
      paradosMedioSegundos: l.parados_medio_segundos === null ? null : Number(l.parados_medio_segundos),
      parados: Number(l.parados_7_dias),
    }))
    .sort((a, b) => a.ordem - b.ordem)

  // Sequência do funil: abertas pela ordem, depois a ganha. A perdida não é
  // "próxima" de ninguém.
  const sequencia = [
    ...linhas.filter((l) => l.tipo === 'aberta'),
    ...linhas.filter((l) => l.tipo === 'ganha'),
  ]

  const etapas: MetricaEtapa[] = linhas.map((l) => {
    const i = sequencia.findIndex((s) => s.etapaId === l.etapaId)
    const proxima = l.tipo === 'aberta' ? sequencia[i + 1] : undefined
    return {
      ...l,
      proxima: proxima ? { nome: proxima.nome, alcancaram: proxima.alcancaram } : null,
      conversaoProxima: proxima && l.alcancaram > 0 ? proxima.alcancaram / l.alcancaram : null,
    }
  })

  const abertas = etapas.filter((e) => e.tipo === 'aberta')
  const ganhos = etapas.find((e) => e.tipo === 'ganha')
  const perdidos = etapas.find((e) => e.tipo === 'perdida')

  return {
    etapas,
    resumo: {
      oportunidades: abertas.reduce((s, e) => s + e.quantidade, 0),
      pipelineValor: abertas.reduce((s, e) => s + e.valor, 0),
      fechadoValor: ganhos?.valor ?? 0,
      ganhos: ganhos?.quantidade ?? 0,
      perdidos: perdidos?.quantidade ?? 0,
      conversao: taxaConversao(ganhos?.quantidade ?? 0, perdidos?.quantidade ?? 0),
      parados: abertas.reduce((s, e) => s + e.parados, 0),
    },
  }
}
