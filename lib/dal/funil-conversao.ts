import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import type { Etapa } from '@/lib/dal/etapas'
import { createClient } from '@/lib/supabase/server'

export type ConversaoEtapa = {
  etapaId: string
  entradas: number
  /** `null` quando a etapa não tem próxima (última do pipeline). */
  avancaram: number | null
  /** `avancaram / entradas`; `null` sem próxima etapa ou sem entradas. */
  taxaProximaEtapa: number | null
  chegaramFechado: number
  /** `null` só quando o funil não tem etapa ganha (configuração inconsistente). */
  taxaFechado: number | null
}

/**
 * Conversão etapa → etapa do pipeline normal (fora da zona de recuperação,
 * mesmo recorte de {@link import('./etapas').limiteDeOrdemPipeline}), a
 * partir de `historico_etapas` — sem tabela nova, sem RPC.
 *
 * Para cada negociação do funil, guarda a primeira vez (mais antiga) que ela
 * entrou em cada etapa. "Avançou" e "chegou em Fechado" comparam esse
 * instante com o de entrada na etapa seguinte / na etapa ganha — assim uma
 * negociação que volta para trás (zona de recuperação, reabertura) não conta
 * como conversão só por ter passado pela etapa alguma vez.
 */
export async function listarConversaoFunil(funilId: string, etapas: Etapa[]): Promise<ConversaoEtapa[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const pipeline = etapas
    .filter((e) => e.tipo === 'aberta' && !e.posFechamento)
    .sort((a, b) => a.ordem - b.ordem)
  const etapaGanha = etapas.find((e) => e.tipo === 'ganha')

  if (pipeline.length === 0) return []

  const { data: negociacoes, error: erroNegociacoes } = await supabase
    .from('negociacoes')
    .select('id')
    .eq('funil_id', funilId)
  if (erroNegociacoes) {
    throw new Error('Não foi possível carregar as negociações do funil.', { cause: erroNegociacoes })
  }

  const ids = negociacoes.map((n) => n.id)
  if (ids.length === 0) return pipeline.map((e, i) => semDados(e.id, i < pipeline.length - 1))

  const { data: historico, error: erroHistorico } = await supabase
    .from('historico_etapas')
    .select('negociacao_id, etapa_nova_id, created_at')
    .in('negociacao_id', ids)
    .order('created_at', { ascending: true })
  if (erroHistorico) {
    throw new Error('Não foi possível carregar o histórico do funil.', { cause: erroHistorico })
  }

  // Por negociação, o instante (ms) da primeira vez que ela entrou em cada
  // etapa. `historico` já vem em ordem crescente de `created_at`, então o
  // primeiro registro de cada etapa é sempre o mais antigo.
  const primeiraEntrada = new Map<string, Map<string, number>>()
  for (const linha of historico) {
    const porEtapa = primeiraEntrada.get(linha.negociacao_id) ?? new Map<string, number>()
    if (!porEtapa.has(linha.etapa_nova_id)) {
      porEtapa.set(linha.etapa_nova_id, new Date(linha.created_at).getTime())
    }
    primeiraEntrada.set(linha.negociacao_id, porEtapa)
  }

  return pipeline.map((etapa, i) => {
    const proxima = pipeline[i + 1]
    let entradas = 0
    let avancaram = 0
    let chegaramFechado = 0

    for (const porEtapa of primeiraEntrada.values()) {
      const entrou = porEtapa.get(etapa.id)
      if (entrou === undefined) continue
      entradas++

      if (proxima) {
        const entrouProxima = porEtapa.get(proxima.id)
        if (entrouProxima !== undefined && entrouProxima > entrou) avancaram++
      }
      if (etapaGanha) {
        const entrouFechado = porEtapa.get(etapaGanha.id)
        if (entrouFechado !== undefined && entrouFechado > entrou) chegaramFechado++
      }
    }

    return {
      etapaId: etapa.id,
      entradas,
      avancaram: proxima ? avancaram : null,
      taxaProximaEtapa: proxima && entradas > 0 ? avancaram / entradas : null,
      chegaramFechado,
      taxaFechado: etapaGanha && entradas > 0 ? chegaramFechado / entradas : null,
    }
  })
}

function semDados(etapaId: string, temProxima: boolean): ConversaoEtapa {
  return {
    etapaId,
    entradas: 0,
    avancaram: temProxima ? 0 : null,
    taxaProximaEtapa: null,
    chegaramFechado: 0,
    taxaFechado: null,
  }
}
