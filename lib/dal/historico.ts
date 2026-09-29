import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import type { LinhaHistoricoBruta } from '@/lib/utils/historico'

/**
 * Histórico de movimentação de UMA negociação, na ordem em que aconteceram.
 * A RLS de `historico_etapas` (dono da negociação ou gerente) decide quem lê
 * — sem filtro extra aqui. `etapa_anterior_id` da primeira linha é sempre
 * `null` (é a criação); as demais linhas têm as duas.
 */
export async function listarHistoricoDaNegociacao(negociacaoId: string): Promise<LinhaHistoricoBruta[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('historico_etapas')
    .select(
      `id, created_at, usuario_id,
       nova:etapas_funil!historico_etapas_etapa_nova_id_fkey(nome, cor)`,
    )
    .eq('negociacao_id', negociacaoId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error('Não foi possível carregar o histórico da negociação.', { cause: error })

  const nomes = await nomesDeUsuarios(data.flatMap((h) => (h.usuario_id ? [h.usuario_id] : [])))

  return data.flatMap((h) =>
    h.nova
      ? [
          {
            id: h.id,
            etapaNome: h.nova.nome,
            etapaCor: h.nova.cor,
            usuarioNome: h.usuario_id ? (nomes.get(h.usuario_id) ?? null) : null,
            criadoEm: h.created_at,
          },
        ]
      : [],
  )
}
