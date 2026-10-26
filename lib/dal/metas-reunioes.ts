import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { percentualMeta } from '@/lib/dal/metas'
import { createClient } from '@/lib/supabase/server'
import { primeiroDiaDoMes } from '@/lib/utils/periodo'

/**
 * Metas de reuniões do SDR — separadas das metas financeiras (TCV/MRR).
 * A contagem é do banco (`metas_reunioes_progresso`): reunião/apresentação
 * criada pelo SDR (para um Closer ou com cliente), uma vez por série,
 * agendadas pela data em que foram marcadas (sem as canceladas) e realizadas
 * pela data da reunião. Gerente vê todos os SDRs da empresa; SDR, só a própria
 * linha; os demais cargos não recebem nada.
 */
export type ProgressoReunioesSdr = {
  usuarioId: string
  nome: string
  ativo: boolean
  agendadas: { meta: number; realizado: number; percentual: number | null }
  realizadas: { meta: number; realizado: number; percentual: number | null }
}

function linha(meta: number, realizado: number) {
  return { meta, realizado, percentual: percentualMeta(realizado, meta > 0 ? meta : null) }
}

export async function obterProgressoReunioes(mes: string): Promise<ProgressoReunioesSdr[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('metas_reunioes_progresso', { p_mes: primeiroDiaDoMes(mes) })
  if (error) throw new Error('Não foi possível carregar as metas de reuniões.')

  return (data ?? []).map((r) => ({
    usuarioId: r.usuario_id,
    nome: r.nome,
    ativo: r.ativo,
    agendadas: linha(Number(r.meta_agendadas), Number(r.agendadas)),
    realizadas: linha(Number(r.meta_realizadas), Number(r.realizadas)),
  }))
}

export type ItemMetaReunioes = { usuarioId: string; metaAgendadas: number; metaRealizadas: number }

/**
 * Grava as metas do mês num único upsert (tudo ou nada). Só Gerente; o banco
 * confere de novo (policy de `metas_reunioes` e trigger que só aceita SDR da
 * própria empresa).
 */
export async function salvarMetasReunioes(
  mes: string,
  itens: ItemMetaReunioes[],
): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') return { ok: false, mensagem: 'Somente administradores definem metas.' }
  if (itens.length === 0) return { ok: true }

  const empresa = await getEmpresaAtual()
  const supabase = await createClient()
  const periodo = primeiroDiaDoMes(mes)

  const { error } = await supabase.from('metas_reunioes').upsert(
    itens.map((i) => ({
      tenant_id: empresa.id,
      usuario_id: i.usuarioId,
      periodo_mes: periodo,
      meta_agendadas: i.metaAgendadas,
      meta_realizadas: i.metaRealizadas,
    })),
    { onConflict: 'tenant_id,usuario_id,periodo_mes' },
  )
  if (!error) return { ok: true }
  if (error.code === '42501') return { ok: false, mensagem: 'Sem permissão para alterar metas.' }
  if (error.code === '23514') return { ok: false, mensagem: error.message }
  return { ok: false, mensagem: 'Não foi possível salvar as metas de reuniões. Tente novamente.' }
}
