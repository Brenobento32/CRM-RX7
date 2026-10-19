import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { ordenarServicos, type Servico } from '@/lib/dal/servicos'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { Periodo } from '@/lib/utils/periodo'
import type { FormaPagamento } from '@/lib/validations/negociacao'

export type PropostaAberta = {
  negociacaoId: string
  clienteId: string
  clienteNome: string
  servicos: Servico[]
  valorProposta: number
  formaPagamento: FormaPagamento | null
  dataProposta: string | null
  /** Dono atual da negociação. */
  responsavel: string | null
}

export type PropostaFechada = {
  negociacaoId: string
  clienteId: string
  clienteNome: string
  servicos: Servico[]
  valorVendido: number
  valorProposta: number | null
  formaPagamento: FormaPagamento | null
  statusPagamento: Database['public']['Enums']['status_pagamento']
  dataFechamento: string
  /** Responsável no momento do fechamento (mesma regra das metas). */
  responsavel: string | null
}

const SERVICOS = 'vinculos:negociacao_servicos(servico:servicos(id, nome, categoria, ativo))'

function servicosDe(vinculos: { servico: Servico | null }[]): Servico[] {
  return ordenarServicos(vinculos.flatMap((v) => (v.servico ? [v.servico] : [])))
}

/**
 * Negociações em etapa aberta com valor de proposta. Sem filtro por dono: a
 * RLS entrega ao closer só as dele e ao gerente todas.
 */
export async function listarPropostasAbertas(): Promise<PropostaAberta[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('negociacoes')
    .select(
      `id, owner_id, valor_proposta, forma_pagamento, data_proposta,
       cliente:clientes!negociacoes_cliente_id_fkey!inner(id, nome, deleted_at),
       etapa:etapas_funil!negociacoes_etapa_id_fkey!inner(tipo),
       ${SERVICOS}`,
    )
    .not('valor_proposta', 'is', null)
    .eq('etapa.tipo', 'aberta')
    .is('cliente.deleted_at', null)
    .order('data_proposta', { ascending: false, nullsFirst: false })

  if (error) throw new Error('Não foi possível carregar as propostas.', { cause: error })

  // Nomes via função: depois de uma transferência a RLS de profiles pode
  // esconder o perfil do dono.
  const nomes = await nomesDeUsuarios(data.map((n) => n.owner_id))

  return data.map((n) => ({
    negociacaoId: n.id,
    clienteId: n.cliente.id,
    clienteNome: n.cliente.nome,
    servicos: servicosDe(n.vinculos),
    valorProposta: Number(n.valor_proposta),
    formaPagamento: n.forma_pagamento,
    dataProposta: n.data_proposta,
    responsavel: nomes.get(n.owner_id) ?? null,
  }))
}

/**
 * Fechamentos do período (pela data de fechamento) de negociações na etapa
 * ganha. A RLS de fechamentos vale para quem consulta.
 */
export async function listarPropostasFechadas(periodo: Periodo): Promise<PropostaFechada[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fechamentos')
    .select(
      `valor_vendido, data_fechamento, status_pagamento, responsavel_id,
       negociacao:negociacoes!fechamentos_negociacao_id_fkey!inner(
         id, valor_proposta, forma_pagamento,
         cliente:clientes!negociacoes_cliente_id_fkey!inner(id, nome, deleted_at),
         etapa:etapas_funil!negociacoes_etapa_id_fkey!inner(tipo),
         ${SERVICOS}
       )`,
    )
    .eq('negociacao.etapa.tipo', 'ganha')
    .is('negociacao.cliente.deleted_at', null)
    // Um fechamento anulado (20261019160000_fechamentos_anulacao.sql) nunca
    // é uma venda válida, nunca aparece como "fechado" neste relatório.
    .is('anulado_em', null)
    .gte('data_fechamento', periodo.inicio)
    .lte('data_fechamento', periodo.fim)
    .order('data_fechamento', { ascending: false })

  if (error) throw new Error('Não foi possível carregar os fechamentos.', { cause: error })

  const nomes = await nomesDeUsuarios(data.map((f) => f.responsavel_id))

  return data.map((f) => ({
    negociacaoId: f.negociacao.id,
    clienteId: f.negociacao.cliente.id,
    clienteNome: f.negociacao.cliente.nome,
    servicos: servicosDe(f.negociacao.vinculos),
    valorVendido: Number(f.valor_vendido),
    valorProposta: f.negociacao.valor_proposta === null ? null : Number(f.negociacao.valor_proposta),
    formaPagamento: f.negociacao.forma_pagamento,
    statusPagamento: f.status_pagamento,
    dataFechamento: f.data_fechamento,
    responsavel: nomes.get(f.responsavel_id) ?? null,
  }))
}
