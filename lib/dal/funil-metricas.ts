import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import { processarMetricasFunil, type MetricasFunil } from '@/lib/utils/funil-metricas'

export type { MetricaEtapa, MetricasFunil, ResumoFunil } from '@/lib/utils/funil-metricas'

/**
 * Métricas do funil. `public.funil_metricas` é SECURITY INVOKER: o closer
 * recebe só os próprios números, o gerente os da equipe — sem filtro aqui.
 * Toda a matemática (coorte, alcance, conversão, ganhos/perdidos
 * históricos) é da RPC; esta função só chama e repassa para a camada pura.
 *
 * `periodo` é só `{ inicio, fim }` (AAAA-MM-DD) — deliberadamente não o tipo
 * `Periodo` do dashboard (que carrega uma `chave` de outro domínio); quem
 * chama hoje é `resolverPeriodoFunil` (`lib/utils/periodo.ts`), com seus
 * próprios atalhos (7/30/90 dias, ano, personalizado).
 */
export async function obterMetricasFunil(
  periodo: { inicio: string; fim: string },
  funilId: string,
): Promise<MetricasFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('funil_metricas', {
    p_inicio: periodo.inicio,
    p_fim: periodo.fim,
    p_funil_id: funilId,
  })
  if (error) throw new Error('Não foi possível carregar as métricas do funil.', { cause: error })

  return processarMetricasFunil(data)
}

export type RealizadoFunil = { tcv: number; mrr: number }

/**
 * Vendido no funil e período selecionados, por tipo (TCV/MRR) —
 * `fechamentos.valor_vendido`, pela data de fechamento, sobre as
 * negociações do funil escolhido. NUNCA usa `metas_progresso` (que é
 * sempre mês corrente, sem filtro de funil) — é uma query própria, sem
 * RPC nova e sem migration, no mesmo padrão já usado por
 * `listarPropostasFechadas` (`lib/dal/propostas.ts`): SELECT direto,
 * `fechamentos` RLS decide o que cada papel enxerga (igual ao resto da
 * tela — nunca um filtro de dono aqui).
 *
 * `tipo_venda` nulo (vendas registradas antes da classificação TCV/MRR
 * existir) não entra em nenhum dos dois totais — mesma regra de
 * `metas_progresso`.
 */
export async function obterRealizadoFunil(
  periodo: { inicio: string; fim: string },
  funilId: string,
): Promise<RealizadoFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fechamentos')
    .select(
      `valor_vendido, tipo_venda,
       negociacao:negociacoes!fechamentos_negociacao_id_fkey!inner(funil_id)`,
    )
    .eq('negociacao.funil_id', funilId)
    .gte('data_fechamento', periodo.inicio)
    .lte('data_fechamento', periodo.fim)

  if (error) throw new Error('Não foi possível carregar o realizado do período.', { cause: error })

  return data.reduce<RealizadoFunil>(
    (acc, f) => {
      if (f.tipo_venda === 'tcv') acc.tcv += Number(f.valor_vendido)
      if (f.tipo_venda === 'mrr') acc.mrr += Number(f.valor_vendido)
      return acc
    },
    { tcv: 0, mrr: 0 },
  )
}
