import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { verificarPermissaoMovimento } from '@/lib/dal/funil'
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
  /** `null` só em fechamentos anteriores à classificação TCV/MRR — "não classificado". */
  tipoVenda: Enums['tipo_venda'] | null
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
         link_contrato, status_pagamento, status_onboarding, observacoes, tipo_venda)`,
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
          tipoVenda: data.fechamento.tipo_venda,
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

export type NegociacaoArquivada = {
  id: string
  clienteId: string
  clienteNome: string
  clienteEmpresa: string | null
  nichoNome: string | null
  origem: Enums['origem_negociacao']
  responsavel: string | null
  motivoArquivamento: string
  arquivadaEm: string
  temperatura: Temperatura | null
}

/**
 * Leads arquivados (desqualificados) visíveis ao usuário — RLS decide, sem
 * filtro de dono aqui. `funilId` filtra pela mesma coluna já denormalizada
 * em `negociacoes` — uma consulta só, nunca N por linha.
 */
export async function listarNegociacoesArquivadas(funilId?: string | null): Promise<NegociacaoArquivada[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  let query = supabase
    .from('negociacoes')
    .select(
      `id, cliente_id, motivo_arquivamento, arquivada_em, temperatura, origem,
       cliente:clientes!negociacoes_cliente_id_fkey(nome, empresa),
       nicho:nichos(nome),
       responsavel:profiles!negociacoes_owner_id_fkey(nome)`,
    )
    .not('arquivada_em', 'is', null)
    .is('excluida_em', null)
    .order('arquivada_em', { ascending: false })

  if (funilId) query = query.eq('funil_id', funilId)

  const { data, error } = await query

  if (error) {
    throw new Error('Não foi possível carregar os leads arquivados.', { cause: error })
  }

  return data.flatMap((n) =>
    n.cliente && n.motivo_arquivamento && n.arquivada_em
      ? [
          {
            id: n.id,
            clienteId: n.cliente_id,
            clienteNome: n.cliente.nome,
            clienteEmpresa: n.cliente.empresa,
            nichoNome: n.nicho?.nome ?? null,
            origem: n.origem,
            responsavel: n.responsavel?.nome ?? null,
            motivoArquivamento: n.motivo_arquivamento,
            arquivadaEm: n.arquivada_em,
            temperatura: n.temperatura,
          },
        ]
      : [],
  )
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

/**
 * Reativa: volta explicitamente para a etapa INICIAL do MESMO funil — pela
 * flag `etapa_inicial`, nunca mais pelo nome "Lead Novo" (produto
 * configurável: cada funil tem a sua, com o nome que quiser). Sem fallback:
 * se o funil não tiver etapa inicial ativa, a reativação falha com mensagem
 * clara em vez de mover o lead pra outra coluna silenciosamente. Dois passos
 * (achar a etapa, depois `update`) em vez de uma função SQL: é lógica de uma
 * tabela só, mesmo estilo de `marcarPerdida` em lib/dal/funil.ts.
 *
 * Mesma pré-checagem de `moverNegociacao`/`marcarPerdida`: o UPDATE abaixo
 * muda etapa_id, então passa pela RLS de sempre (owner_id/gerente) MAIS o
 * trigger `negociacoes_protege_movimentacao_por_permissao`
 * (20261014170000) — a pré-checagem aqui só evita o round-trip e dá a
 * mensagem certa.
 */
export async function reativarNegociacao(id: string): Promise<ResultadoArquivarNegociacao> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data: negociacao, error: erroNegociacao } = await supabase
    .from('negociacoes')
    .select('funil_id, arquivada_em')
    .eq('id', id)
    .maybeSingle()

  if (erroNegociacao) {
    console.error('Erro ao reativar negociação', erroNegociacao)
    return { ok: false, mensagem: 'Não foi possível reativar o lead. Tente novamente.' }
  }
  if (!negociacao || !negociacao.arquivada_em) {
    return { ok: false, mensagem: 'Lead não encontrado ou não está arquivado.' }
  }

  const { data: etapa, error: erroEtapa } = await supabase
    .from('etapas_funil')
    .select('id, nome, ordem')
    .eq('funil_id', negociacao.funil_id)
    .eq('etapa_inicial', true)
    .eq('ativo', true)
    .limit(1)
    .maybeSingle()

  if (erroEtapa) {
    console.error('Erro ao reativar negociação', erroEtapa)
    return { ok: false, mensagem: 'Não foi possível reativar o lead. Tente novamente.' }
  }
  if (!etapa) {
    return {
      ok: false,
      mensagem: 'O funil não tem uma etapa inicial ativa para receber o lead reativado.',
    }
  }

  if (usuario.role !== 'gerente') {
    const autorizado = await verificarPermissaoMovimento(
      supabase,
      usuario,
      id,
      negociacao.funil_id,
      etapa.id,
      Number(etapa.ordem),
    )
    if (!autorizado.ok) return autorizado
  }

  const { data, error } = await supabase
    .from('negociacoes')
    .update({ arquivada_em: null, motivo_arquivamento: null, etapa_id: etapa.id, posicao: 1000 })
    .eq('id', id)
    .not('arquivada_em', 'is', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    console.error('Erro ao reativar negociação', error)
    return { ok: false, mensagem: 'Não foi possível reativar o lead. Tente novamente.' }
  }

  return data ? { ok: true } : { ok: false, mensagem: 'Lead não encontrado ou já está ativo.' }
}

/**
 * Exclusão com auditoria — nunca `DELETE` físico: `fechamentos` e
 * `historico_etapas` têm FK `on delete cascade` a partir de `negociacoes`,
 * então um DELETE real apagaria venda e histórico de etapas. Só grava se o
 * lead já estiver arquivado (o botão também só existe lá, a DAL confere de
 * novo). Nunca toca `clientes`, `conversas` nem mensagens.
 */
export async function excluirNegociacaoPermanente(
  id: string,
  motivo: string,
): Promise<ResultadoArquivarNegociacao> {
  const motivoLimpo = motivo.trim()
  if (!motivoLimpo) return { ok: false, mensagem: 'Informe o motivo da exclusão.' }

  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('negociacoes')
    .update({
      excluida_em: new Date().toISOString(),
      excluida_por: usuario.id,
      motivo_exclusao: motivoLimpo,
    })
    .eq('id', id)
    .not('arquivada_em', 'is', null)
    .is('excluida_em', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    if (error.code === '23514') {
      return { ok: false, mensagem: 'Informe o motivo da exclusão.' }
    }
    console.error('Erro ao excluir negociação', error)
    return { ok: false, mensagem: 'Não foi possível excluir o lead. Tente novamente.' }
  }

  return data
    ? { ok: true }
    : { ok: false, mensagem: 'Lead precisa estar arquivado para ser excluído permanentemente.' }
}

export type DadosComerciaisInput = {
  negociacaoId: string
  nichoId: string | null
  temperatura: Temperatura | null
  valorEstimado: string | null
}

export type ResultadoDadosComerciais = { ok: true } | { ok: false; mensagem: string }

/**
 * Args de `atualizar_dados_operacionais_negociacao` (migration
 * 20261016160000) — fora do gerador de tipos porque a migration ainda não
 * foi aplicada no banco real (`npm run db:types` lê o schema remoto via
 * `--linked`). Remover os casts `as never` quando a migration for aplicada
 * e os tipos forem regerados.
 */
type ArgsDadosOperacionais = {
  p_negociacao_id: string
  p_nicho_id: string | null
  p_temperatura: Enums['temperatura_negociacao'] | null
  p_valor_estimado: number | null
  p_data_primeira_reuniao: string | null
  p_data_proposta: string | null
  p_objecao_principal: string | null
  p_valor_proposta: number | null
  p_forma_pagamento: Enums['forma_pagamento'] | null
}

/**
 * "Dados comerciais" da ficha (item 3/4 do refinamento) — nicho, temperatura
 * e proposta/valor. `origem` nunca passa por aqui: é fato histórico de como
 * o lead entrou, imutável depois da criação (trigger
 * `negociacoes_origem_imutavel`, proposta em
 * `supabase/migrations_propostas/20261015130000_...sql`) — a ficha só
 * mostra, nunca edita.
 *
 * Chama a RPC `atualizar_dados_operacionais_negociacao` (SECURITY DEFINER:
 * GERENTE ou `pode_mover_etapa` autoriza, owner_id nunca é consultado — a
 * mesma regra de `mover_negociacao`) em vez de um `.update()` direto, que
 * dependia de `negociacoes_update` (owner_id OR gerente) e por isso
 * bloqueava um CLOSER/SDR com `pode_mover` mas que não era o dono da
 * negociação. Como a RPC exige os 8 campos operacionais de uma vez, os 5 que
 * esta tela não edita (data_primeira_reuniao, data_proposta,
 * objecao_principal, valor_proposta, forma_pagamento — editados pelo modal
 * de edição rápida/tela `/negociacoes/[id]/editar`) são lidos antes e
 * repassados sem alteração, pra não apagar o que já estava salvo lá.
 */
export async function atualizarDadosComerciaisNegociacao(
  input: DadosComerciaisInput,
): Promise<ResultadoDadosComerciais> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data: atual, error: erroAtual } = await supabase
    .from('negociacoes')
    .select('data_primeira_reuniao, data_proposta, objecao_principal, valor_proposta, forma_pagamento')
    .eq('id', input.negociacaoId)
    .maybeSingle()

  if (erroAtual) {
    console.error('Erro ao carregar dados comerciais', erroAtual)
    return { ok: false, mensagem: 'Não foi possível salvar os dados comerciais. Tente novamente.' }
  }
  if (!atual) return { ok: false, mensagem: 'Negociação não encontrada.' }

  const args: ArgsDadosOperacionais = {
    p_negociacao_id: input.negociacaoId,
    p_nicho_id: input.nichoId,
    p_temperatura: input.temperatura,
    p_valor_estimado: input.valorEstimado === null ? null : Number(input.valorEstimado),
    p_data_primeira_reuniao: atual.data_primeira_reuniao,
    p_data_proposta: atual.data_proposta,
    p_objecao_principal: atual.objecao_principal,
    p_valor_proposta: atual.valor_proposta,
    p_forma_pagamento: atual.forma_pagamento,
  }

  const { error } = await supabase.rpc(
    'atualizar_dados_operacionais_negociacao' as never,
    args as never,
  )

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para editar esta negociação.' }
    }
    if (error.code === 'P0002') {
      return { ok: false, mensagem: 'Negociação não encontrada.' }
    }
    if (error.code === '23514' && error.message.startsWith('Negociação encerrada')) {
      return { ok: false, mensagem: NEGOCIACAO_ENCERRADA }
    }
    console.error('Erro ao salvar dados comerciais', error)
    return { ok: false, mensagem: 'Não foi possível salvar os dados comerciais. Tente novamente.' }
  }

  return { ok: true }
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
