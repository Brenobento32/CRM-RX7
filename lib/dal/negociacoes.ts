import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import type { Servico } from '@/lib/dal/servicos'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { EtapaVisual, TipoEtapa } from '@/lib/utils/etapas'
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
  etapa: EtapaVisual & { tipo: TipoEtapa }
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

export type ResultadoArquivarNegociacao = { ok: true } | { ok: false; mensagem: string }

/**
 * "Desqualificar lead" — soft delete (`arquivada_em`), nunca apaga a
 * negociação, o cliente, conversas ou histórico. O card some do Kanban
 * porque `funil_cards` filtra `arquivada_em is null`. Motivo obrigatório
 * (pedido explícito do fluxo do drawer); o banco também recusa
 * (`negociacoes_motivo_arquivamento_obrigatorio`).
 */
export async function arquivarNegociacao(id: string, motivo: string): Promise<ResultadoArquivarNegociacao> {
  const motivoLimpo = motivo.trim()
  if (!motivoLimpo) return { ok: false, mensagem: 'Informe o motivo da desqualificação.' }

  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('negociacoes')
    .update({ arquivada_em: new Date().toISOString(), motivo_arquivamento: motivoLimpo })
    .eq('id', id)
    .is('arquivada_em', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    if (error.code === '23514') {
      return { ok: false, mensagem: 'Informe o motivo da desqualificação.' }
    }
    console.error('Erro ao arquivar negociação', error)
    return { ok: false, mensagem: 'Não foi possível desqualificar o lead. Tente novamente.' }
  }

  return data ? { ok: true } : { ok: false, mensagem: 'Lead não encontrado ou já está arquivado.' }
}

export type DadosComerciaisInput = {
  negociacaoId: string
  nichoId: string | null
  origem: Enums['origem_negociacao']
  temperatura: Temperatura | null
  valorEstimado: string | null
}

export type ResultadoDadosComerciais = { ok: true } | { ok: false; mensagem: string }

/**
 * "Dados comerciais" da ficha (item 3/4 do refinamento) — nicho, origem,
 * temperatura e proposta/valor num único UPDATE. `valor_estimado` e
 * `temperatura` são recusados pelo banco (trigger
 * `negociacoes_encerrada_somente_leitura`) quando a negociação já está
 * encerrada (ganha/perdida); a ficha também desabilita esses dois campos
 * nesse caso, então chegar aqui com eles alterados só acontece se o usuário
 * contornar a UI — o banco é quem garante a regra de qualquer forma.
 */
export async function atualizarDadosComerciaisNegociacao(
  input: DadosComerciaisInput,
): Promise<ResultadoDadosComerciais> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('negociacoes')
    .update({
      nicho_id: input.nichoId,
      origem: input.origem,
      temperatura: input.temperatura,
      valor_estimado: input.valorEstimado === null ? null : Number(input.valorEstimado),
    })
    .eq('id', input.negociacaoId)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para editar esta negociação.' }
    }
    if (error.code === '23514' && error.message.startsWith('Negociação encerrada')) {
      return { ok: false, mensagem: NEGOCIACAO_ENCERRADA }
    }
    console.error('Erro ao salvar dados comerciais', error)
    return { ok: false, mensagem: 'Não foi possível salvar os dados comerciais. Tente novamente.' }
  }

  return data ? { ok: true } : { ok: false, mensagem: 'Negociação não encontrada.' }
}

export type DetalhesLeadNegociacao = {
  clienteEmail: string | null
  clienteInstagram: string | null
  /** Valor da proposta comercial (`valor_proposta`) — diferente de `valor_estimado`, que já vem em `CardFunil`. */
  valorProposta: number | null
}

/**
 * Únicos campos do painel lateral do lead que `CardFunil` não traz:
 * e-mail/Instagram do cliente e o valor da proposta da negociação — uma
 * consulta só (join cliente ↔ negociação), sem repetir o que a view
 * `funil_cards` já buscou. RLS de `negociacoes`/`clientes` decide a
 * visibilidade, igual ao resto do módulo.
 */
export async function obterDetalhesLeadNegociacao(id: string): Promise<DetalhesLeadNegociacao | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('negociacoes')
    .select('valor_proposta, cliente:clientes!negociacoes_cliente_id_fkey(email, instagram, deleted_at)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error('Não foi possível carregar os detalhes do lead.', { cause: error })
  }
  if (!data || !data.cliente || data.cliente.deleted_at) return null

  return {
    clienteEmail: data.cliente.email,
    clienteInstagram: data.cliente.instagram,
    valorProposta: data.valor_proposta === null ? null : Number(data.valor_proposta),
  }
}

export type RespostaLead = { pergunta: string; resposta: string }

/** Qualificação de um lead, legível (pergunta + resposta) — nunca JSON cru. */
export async function listarRespostasLead(negociacaoId: string): Promise<RespostaLead[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('respostas_lead')
    .select('resposta_texto, resposta_opcao, pergunta:perguntas(texto, ordem)')
    .eq('negociacao_id', negociacaoId)

  if (error) {
    throw new Error('Não foi possível carregar a qualificação do lead.', { cause: error })
  }

  return data
    .flatMap((r) =>
      r.pergunta
        ? [{ pergunta: r.pergunta.texto, resposta: r.resposta_texto ?? r.resposta_opcao ?? '', ordem: r.pergunta.ordem }]
        : [],
    )
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ pergunta, resposta }) => ({ pergunta, resposta }))
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
