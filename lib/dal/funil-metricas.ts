import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import { agregarRealizado, type RealizadoFunil } from '@/lib/utils/financeiro-periodo'
import { processarMetricasFunil, type MetricasFunil } from '@/lib/utils/funil-metricas'

export type { RealizadoFunil } from '@/lib/utils/financeiro-periodo'

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

/**
 * Vendido no funil e período selecionados, por tipo (TCV/MRR), com
 * quantidade (para ticket médio) — `fechamentos.valor_vendido`, pela data
 * de fechamento, sobre as negociações do funil escolhido. NUNCA usa
 * `metas_progresso` (que é sempre mês corrente, sem filtro de funil) — é
 * uma query própria, sem RPC nova e sem migration, no mesmo padrão já
 * usado por `listarPropostasFechadas` (`lib/dal/propostas.ts`): SELECT
 * direto, `fechamentos` RLS decide o que cada papel enxerga (igual ao
 * resto da tela). A agregação em si (`agregarRealizado`) é pura, em
 * `lib/utils/financeiro-periodo.ts`.
 *
 * ACHADO (teste manual em produção): esta função não tinha filtro de
 * `responsavel_id` — `fechamentos_select` (RLS) deixa um SDR/CLOSER com
 * `pode_ver` configurado em várias etapas do funil enxergar TODOS os
 * fechamentos visíveis ali, não só os próprios. Resultado: "vendido neste
 * funil" somava o fechamento de QUALQUER colega visível (ex.: SDR que só
 * qualifica e nunca fecha via própria carteira, mas vê o funil inteiro),
 * enquanto o "realizado geral/individual" (`obterRealizadoGeral`, por
 * `responsavel_id`) mostrava o número certo da PRÓPRIA pessoa — os dois
 * lado a lado pareciam contradição ("vendi 4.800 no funil mas minha meta
 * mostra 0"), quando na verdade cada um somava um CONJUNTO de pessoas
 * diferente. Corrigido: `usuarioId` (`null` = empresa/gerente, sem
 * filtro — vê o funil inteiro, mesma regra de `metas_progresso`/
 * `realizado_periodo`; um uuid = só os fechamentos daquele
 * `responsavel_id`) alinha esta função com a MESMA pessoa que o card de
 * meta já usa — a única diferença entre os dois números continua sendo o
 * filtro de `funil_id`, nunca "de quem são as vendas".
 */
export async function obterRealizadoFunil(
  periodo: { inicio: string; fim: string },
  funilId: string,
  usuarioId: string | null,
): Promise<RealizadoFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  let query = supabase
    .from('fechamentos')
    .select(
      `valor_vendido, tipo_venda,
       negociacao:negociacoes!fechamentos_negociacao_id_fkey!inner(funil_id)`,
    )
    .eq('negociacao.funil_id', funilId)
    .gte('data_fechamento', periodo.inicio)
    .lte('data_fechamento', periodo.fim)

  if (usuarioId !== null) query = query.eq('responsavel_id', usuarioId)

  const { data, error } = await query

  if (error) throw new Error('Não foi possível carregar o realizado do período.', { cause: error })

  return agregarRealizado(data)
}
