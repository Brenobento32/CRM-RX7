import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import type { Servico } from '@/lib/dal/servicos'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { EtapaKanban } from '@/lib/utils/etapas'
import type {
  CampoEdicaoNegociacao,
  EdicaoNegociacaoInput,
  FormaPagamento,
  Temperatura,
} from '@/lib/validations/negociacao'

type Enums = Database['public']['Enums']

export type FechamentoEdicao = {
  valorVendido: number
  dataFechamento: string
  contratoEnviado: boolean
  contratoAssinado: boolean
  linkContrato: string | null
  statusPagamento: Enums['status_pagamento']
  statusOnboarding: Enums['status_onboarding']
  observacoes: string | null
}

export type NegociacaoEdicao = {
  id: string
  clienteId: string
  clienteNome: string
  etapa: Omit<EtapaKanban, 'id'>
  valorEstimado: number | null
  temperatura: Temperatura | null
  dataPrimeiraReuniao: string | null
  dataProposta: string | null
  objecaoPrincipal: string | null
  valorProposta: number | null
  formaPagamento: FormaPagamento | null
  /** Vinculados, inclusive os desativados depois do vínculo. */
  servicos: Servico[]
  /** Só não nulo quando `etapa.tipo === 'ganha'`. */
  fechamento: FechamentoEdicao | null
}

/**
 * Negociação para a tela de edição. `null` quando não existe, quando a RLS a
 * esconde (closer abrindo negociação de outro) ou quando o cliente foi
 * excluído.
 */
export async function obterNegociacaoParaEdicao(id: string): Promise<NegociacaoEdicao | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('negociacoes')
    .select(
      `id, cliente_id, valor_estimado, temperatura, data_primeira_reuniao, data_proposta,
       objecao_principal, valor_proposta, forma_pagamento,
       etapa:etapas_funil!negociacoes_etapa_id_fkey(nome, cor, tipo),
       cliente:clientes!negociacoes_cliente_id_fkey(nome, deleted_at),
       vinculos:negociacao_servicos(servico:servicos(id, nome, categoria, ativo)),
       fechamento:fechamentos(valor_vendido, data_fechamento, contrato_enviado, contrato_assinado,
         link_contrato, status_pagamento, status_onboarding, observacoes)`,
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('Não foi possível carregar a negociação.', { cause: error })
  if (!data || !data.cliente || data.cliente.deleted_at) return null

  return {
    id: data.id,
    clienteId: data.cliente_id,
    clienteNome: data.cliente.nome,
    etapa: data.etapa,
    valorEstimado: data.valor_estimado === null ? null : Number(data.valor_estimado),
    temperatura: data.temperatura,
    dataPrimeiraReuniao: data.data_primeira_reuniao,
    dataProposta: data.data_proposta,
    objecaoPrincipal: data.objecao_principal,
    valorProposta: data.valor_proposta === null ? null : Number(data.valor_proposta),
    formaPagamento: data.forma_pagamento,
    servicos: data.vinculos.flatMap((v) => (v.servico ? [v.servico] : [])),
    fechamento: data.fechamento
      ? {
          valorVendido: Number(data.fechamento.valor_vendido),
          dataFechamento: data.fechamento.data_fechamento,
          contratoEnviado: data.fechamento.contrato_enviado,
          contratoAssinado: data.fechamento.contrato_assinado,
          linkContrato: data.fechamento.link_contrato,
          statusPagamento: data.fechamento.status_pagamento,
          statusOnboarding: data.fechamento.status_onboarding,
          observacoes: data.fechamento.observacoes,
        }
      : null,
  }
}

/** Mesma frase do banco (triggers e `salvar_negociacao`). */
export const NEGOCIACAO_ENCERRADA = 'Negociação encerrada: dados comerciais não podem ser alterados.'

export function negociacaoEncerrada(n: Pick<NegociacaoEdicao, 'etapa'>): boolean {
  return n.etapa.tipo !== 'aberta'
}

export type ResultadoNegociacao =
  | { ok: true }
  | { ok: false; mensagem: string; campo?: CampoEdicaoNegociacao }

type ArgsSalvar = Database['public']['Functions']['salvar_negociacao']['Args']

/**
 * Qualificação, proposta e serviços numa transação (`public.salvar_negociacao`,
 * SECURITY INVOKER): closer que tente salvar negociação alheia recebe "não
 * encontrada", e negociação encerrada é recusada pelo banco. Etapa, dono e
 * motivo de perda não passam por aqui.
 */
export async function salvarNegociacao(id: string, n: EdicaoNegociacaoInput): Promise<ResultadoNegociacao> {
  await getUsuarioAtual()
  const supabase = await createClient()

  // A função não tem defaults: campo vazio precisa ir como NULL explícito.
  // O gerador de tipos declara os argumentos como não nulos, daí o cast.
  const args: { [K in keyof ArgsSalvar]: ArgsSalvar[K] | null } = {
    p_negociacao_id: id,
    p_valor_estimado: n.valor_estimado === null ? null : Number(n.valor_estimado),
    p_temperatura: n.temperatura,
    p_data_primeira_reuniao: n.data_primeira_reuniao,
    p_data_proposta: n.data_proposta,
    p_objecao_principal: n.objecao_principal,
    p_valor_proposta: n.valor_proposta === null ? null : Number(n.valor_proposta),
    p_forma_pagamento: n.forma_pagamento,
    p_servico_ids: n.servico_ids,
  }

  const { error } = await supabase.rpc('salvar_negociacao', args as ArgsSalvar)
  return error ? traduzirErro(error) : { ok: true }
}

function traduzirErro(error: PostgrestError): Extract<ResultadoNegociacao, { ok: false }> {
  switch (error.code) {
    case 'P0002':
      return { ok: false, mensagem: 'Negociação não encontrada.' }
    case '42501':
      return { ok: false, mensagem: 'Você não tem permissão para editar esta negociação.' }
    case '23514':
      if (error.message.startsWith('Negociação encerrada')) {
        return { ok: false, mensagem: NEGOCIACAO_ENCERRADA }
      }
      if (error.message.includes('negociacoes_datas_ordem')) {
        return {
          ok: false,
          campo: 'data_proposta',
          mensagem: 'A proposta não pode ser anterior à primeira reunião.',
        }
      }
      if (error.message.includes('Serviço desativado')) {
        return {
          ok: false,
          campo: 'servico_ids',
          mensagem: 'Um dos serviços escolhidos foi desativado. Recarregue a página.',
        }
      }
      return { ok: false, mensagem: 'Dados inválidos para a negociação.' }
    case '23503':
      return { ok: false, campo: 'servico_ids', mensagem: 'Um dos serviços escolhidos não existe mais.' }
  }

  console.error('Erro ao salvar negociação', error)
  return { ok: false, mensagem: 'Não foi possível salvar a negociação. Tente novamente.' }
}
