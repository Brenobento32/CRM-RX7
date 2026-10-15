import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { cache } from 'react'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { EtapaVisual, TipoEtapa } from '@/lib/utils/etapas'
import type { CampoCliente, ClienteInput } from '@/lib/validations/cliente'
import type { FormaPagamento, Temperatura } from '@/lib/validations/negociacao'

type TipoCliente = Database['public']['Enums']['tipo_cliente']

export const CLIENTES_POR_PAGINA = 25

export type ClienteResumo = {
  id: string
  tipo_cliente: TipoCliente
  nome: string
  empresa: string | null
  telefone: string | null
  whatsapp: string | null
  email: string | null
  dono: string | null
  created_at: string
}

export type ClienteDetalhe = ClienteResumo & {
  cpf: string | null
  cnpj: string | null
  responsavel: string | null
  cargo: string | null
  instagram: string | null
  observacoes: string | null
  owner_id: string
  updated_at: string
  negociacoes: NegociacaoDoCliente[]
}

export type NegociacaoDoCliente = {
  id: string
  etapa: EtapaVisual & { tipo: TipoEtapa }
  created_at: string
  valor_estimado: number | null
  temperatura: Temperatura | null
  valor_proposta: number | null
  forma_pagamento: FormaPagamento | null
  /** Inclui serviços desativados depois do vínculo (histórico). */
  servicos: { nome: string; ativo: boolean }[]
}

export type OpcaoResponsavel = { id: string; nome: string; role: string }

/**
 * Lista clientes visíveis ao usuário.
 *
 * Não há filtro por `owner_id` aqui: quem decide o que um closer enxerga é a
 * RLS. Se este código filtrasse, a regra existiria em dois lugares e um dia
 * eles divergiriam.
 */
export type StatusCliente = 'ativos' | 'arquivados' | 'excluidos'

export async function listarClientes({
  busca,
  pagina,
  status = 'ativos',
}: {
  busca?: string
  pagina: number
  /**
   * 'ativos' (padrão, `deleted_at is null`), 'arquivados' (`deleted_at is
   * not null and excluido_em is null`) ou 'excluidos' (`excluido_em is not
   * null`).
   */
  status?: StatusCliente
}): Promise<{ clientes: ClienteResumo[]; total: number }> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const inicio = (pagina - 1) * CLIENTES_POR_PAGINA

  let query = supabase
    .from('clientes')
    .select(
      'id, tipo_cliente, nome, empresa, telefone, whatsapp, email, created_at, dono:profiles!clientes_owner_id_fkey(nome)',
      { count: 'exact' },
    )
    .order('nome', { ascending: true })
    .range(inicio, inicio + CLIENTES_POR_PAGINA - 1)

  if (status === 'excluidos') query = query.not('excluido_em', 'is', null)
  else if (status === 'arquivados') query = query.not('deleted_at', 'is', null).is('excluido_em', null)
  else query = query.is('deleted_at', null)

  const filtro = filtroDeBusca(busca)
  if (filtro) query = query.or(filtro)

  const { data, count, error } = await query

  if (error) {
    throw new Error('Não foi possível carregar os clientes.', { cause: error })
  }

  return {
    clientes: data.map(({ dono, ...c }) => ({ ...c, dono: dono?.nome ?? null })),
    total: count ?? 0,
  }
}

export type OpcaoClienteBusca = { id: string; nome: string; empresa: string | null }

export const LIMITE_BUSCA_CLIENTES = 20

/**
 * Busca de cliente pra selecionar (ex.: "Nova entrada" do Kanban) —
 * pensada pra um campo de digitação, não pra popular uma lista inteira:
 * sem termo, não consulta nada (retorna vazio, nunca a tabela toda); com
 * termo, reaproveita `filtroDeBusca` (mesmo filtro/sanitização de
 * `listarClientes`) e devolve só id/nome/empresa — nenhuma negociação
 * embutida, ao contrário de `listarOpcoesClientes` (que carrega até 1000
 * linhas com o histórico inteiro, pra um `<select>` estático). RLS de
 * `clientes` decide o que cada papel enxerga, igual a toda outra consulta.
 */
export async function buscarClientesParaSelecao(busca: string): Promise<OpcaoClienteBusca[]> {
  await getUsuarioAtual()

  const filtro = filtroDeBusca(busca)
  if (!filtro) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome, empresa')
    .is('deleted_at', null)
    .or(filtro)
    .order('nome')
    .limit(LIMITE_BUSCA_CLIENTES)

  if (error) throw new Error('Não foi possível buscar clientes.', { cause: error })
  return data
}

/**
 * `null` quando o cliente não existe, foi excluído, ou — pra SDR/CLOSER,
 * desde `20261014160000_permissoes_colaborador.sql` — quando a RLS de
 * `clientes` não encontra nenhuma negociação visível dele
 * (`pode_ver_etapa`, nunca mais `owner_id`).
 *
 * LIMITAÇÃO CONHECIDA E ACEITA (documentada, não contornada): `clientes` não
 * tem nenhuma coluna de funil/origem (confirmado: `tipo_cliente, nome,
 * empresa, cpf, cnpj, telefone, whatsapp, email, responsavel, cargo,
 * instagram, observacoes, owner_id, created_at, updated_at, deleted_at` —
 * `origem` é texto livre, não uma referência a funil). Por isso, se um
 * cliente algum dia chegar a ter ZERO negociações, não há nenhum dado pra
 * inferir "em qual funil ele deveria aparecer" e decidir uma permissão —
 * continuaria indisponível pra SDR/CLOSER (nunca pra gerente) até ganhar
 * uma negociação visível. NÃO abrir uma exceção de acesso global pra esse
 * caso, e NÃO voltar a usar owner_id como bypass aqui — a instrução
 * explícita foi documentar a limitação, não inventar uma regra nova.
 *
 * Na prática isso quase nunca acontece: `criar_cliente` (cadastro manual) e
 * `criar_cliente_whatsapp` (webhook) sempre criam cliente + a negociação
 * inicial na MESMA transação — nunca existe um cliente "órfão" recém-criado
 * por esses caminhos. A única forma de um cliente ficar com zero
 * negociações seria um hard delete de todas elas fora do fluxo normal
 * (`excluirNegociacaoPermanente` é soft-delete — a linha continua existindo
 * e `pode_ver_etapa` continua valendo pra ela normalmente).
 *
 * Em `cache` porque `generateMetadata` e a página pedem o mesmo cliente.
 */
export const obterCliente = cache(async (id: string): Promise<ClienteDetalhe | null> => {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select(
      `id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
       responsavel, cargo, instagram, observacoes, owner_id, created_at, updated_at,
       dono:profiles!clientes_owner_id_fkey(nome),
       negociacoes(
         id, created_at, valor_estimado, temperatura, valor_proposta, forma_pagamento,
         etapa:etapas_funil!negociacoes_etapa_id_fkey(nome, cor, tipo),
         vinculos:negociacao_servicos(servico:servicos(nome, ativo))
       )`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .order('created_at', { referencedTable: 'negociacoes', ascending: false })
    .maybeSingle()

  if (error) {
    throw new Error('Não foi possível carregar o cliente.', { cause: error })
  }
  if (!data) return null

  const { dono, negociacoes, ...cliente } = data
  return {
    ...cliente,
    dono: dono?.nome ?? null,
    negociacoes: negociacoes.map(({ vinculos, ...n }) => ({
      ...n,
      valor_estimado: n.valor_estimado === null ? null : Number(n.valor_estimado),
      valor_proposta: n.valor_proposta === null ? null : Number(n.valor_proposta),
      servicos: vinculos
        .flatMap((v) => (v.servico ? [v.servico] : []))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    })),
  }
})

/**
 * Pessoas que podem receber uma carteira. Só faz sentido para gerente — para
 * um closer a RLS devolveria apenas o próprio perfil.
 */
export async function listarResponsaveis(): Promise<OpcaoResponsavel[]> {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome, role')
    .eq('ativo', true)
    .order('nome')

  if (error) {
    throw new Error('Não foi possível carregar os usuários.', { cause: error })
  }
  return data
}

export type ResultadoEscrita =
  | { ok: true; id: string }
  | {
      ok: false
      mensagem: string
      campo?: CampoCliente
    }

/**
 * Cria o cliente e a negociação inicial (`reuniao_agendada`) numa única
 * transação, via `public.criar_cliente`.
 *
 * Closer sempre cria na própria carteira; o `owner_id` do formulário só é
 * considerado para gerente. Mesmo que alguém forje o campo, a RLS recusa.
 */
/**
 * `funilId`: funil onde a negociação inicial entra — obrigatório pra SDR/
 * CLOSER (a tela sempre manda um, escolhido entre os que `listarFunis()` já
 * filtra por permissão); `undefined`/`null` cai no funil padrão (RPC
 * resolve sozinha), mantendo o comportamento de antes pra quem não manda
 * nada. A permissão de verdade é checada no banco (trigger
 * `negociacoes_protege_criacao_por_permissao`) — se o funil/etapa inicial
 * não tiver `pode_mover` pra quem chama, a RPC falha com 42501, traduzido
 * abaixo.
 */
export async function criarCliente(
  input: ClienteInput,
  funilId?: string | null,
): Promise<ResultadoEscrita> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const ownerId =
    usuario.role === 'gerente' && input.owner_id ? input.owner_id : usuario.id

  const { data, error } = await supabase.rpc('criar_cliente', {
    p_tipo_cliente: input.tipo_cliente,
    p_nome: input.nome,
    p_empresa: input.empresa ?? undefined,
    p_cpf: input.cpf ?? undefined,
    p_cnpj: input.cnpj ?? undefined,
    p_telefone: input.telefone ?? undefined,
    p_whatsapp: input.whatsapp ?? undefined,
    p_email: input.email ?? undefined,
    p_responsavel: input.responsavel ?? undefined,
    p_cargo: input.cargo ?? undefined,
    p_observacoes: input.observacoes ?? undefined,
    p_owner_id: ownerId,
    p_instagram: input.instagram ?? undefined,
    p_funil_id: funilId ?? undefined,
  })

  if (error) return traduzirErro(error)
  return { ok: true, id: data }
}

/**
 * Atualiza o cadastro. Só o gerente troca o dono da carteira — a troca leva
 * as negociações junto (trigger `clientes_propaga_owner`).
 */
export async function atualizarCliente(
  id: string,
  input: ClienteInput,
): Promise<ResultadoEscrita> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { owner_id, ...cadastro } = input
  const alteracoes =
    usuario.role === 'gerente' && owner_id ? { ...cadastro, owner_id } : cadastro

  const { data, error } = await supabase
    .from('clientes')
    .update(alteracoes)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) return traduzirErro(error)

  // RLS: cliente de outra carteira é invisível, então 0 linhas afetadas.
  if (!data) {
    return { ok: false, mensagem: 'Cliente não encontrado.' }
  }
  return { ok: true, id: data.id }
}

export type ResultadoArquivar = { ok: true } | { ok: false; mensagem: string }

/**
 * Soft delete (`deleted_at`) — nunca `delete`. Negociações, fechamentos e
 * histórico continuam intactos; a DAL de cada um deles já filtra clientes
 * arquivados. Recusa se houver negociação fechada (ganha): o histórico de
 * venda/comissão fica preso a um cliente que sumiria das listagens.
 */
export async function arquivarCliente(id: string): Promise<ResultadoArquivar> {
  await getUsuarioAtual()

  const cliente = await obterCliente(id)
  if (!cliente) return { ok: false, mensagem: 'Cliente não encontrado.' }
  if (cliente.negociacoes.some((n) => n.etapa.tipo === 'ganha')) {
    return {
      ok: false,
      mensagem: 'Cliente possui negociação fechada (ganha) e não pode ser arquivado.',
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clientes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    console.error('Erro ao arquivar cliente', error)
    return { ok: false, mensagem: 'Não foi possível arquivar o cliente. Tente novamente.' }
  }

  // RLS ou já arquivado por outra aba: 0 linhas afetadas.
  return data ? { ok: true } : { ok: false, mensagem: 'Cliente não encontrado.' }
}

/** Desfaz o arquivamento (`deleted_at = null`) — só grava se estiver atualmente arquivado. */
export async function restaurarCliente(id: string): Promise<ResultadoArquivar> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .update({ deleted_at: null })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    console.error('Erro ao restaurar cliente', error)
    return { ok: false, mensagem: 'Não foi possível restaurar o cliente. Tente novamente.' }
  }

  return data ? { ok: true } : { ok: false, mensagem: 'Cliente não encontrado ou já está ativo.' }
}

/**
 * "Exclusão" com auditoria — nunca `DELETE` físico. Só preenche
 * `excluido_em`/`excluido_por`/`motivo_exclusao`; negociações, fechamentos e
 * histórico continuam intactos e vinculados ao cliente. Só grava se o
 * cliente já estiver arquivado (o botão também só existe lá, mas a DAL
 * confere de novo). Motivo é obrigatório — o banco também recusa
 * (`clientes_motivo_exclusao_obrigatorio`), esta checagem só evita a viagem.
 */
export async function excluirCliente(id: string, motivo: string): Promise<ResultadoArquivar> {
  const motivoLimpo = motivo.trim()
  if (!motivoLimpo) return { ok: false, mensagem: 'Informe o motivo da exclusão.' }

  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .update({ excluido_em: new Date().toISOString(), excluido_por: usuario.id, motivo_exclusao: motivoLimpo })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .is('excluido_em', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    if (error.code === '23514') {
      return { ok: false, mensagem: 'Informe o motivo da exclusão.' }
    }
    console.error('Erro ao excluir cliente', error)
    return { ok: false, mensagem: 'Não foi possível excluir o cliente. Tente novamente.' }
  }

  return data
    ? { ok: true }
    : { ok: false, mensagem: 'Cliente precisa estar arquivado para ser excluído.' }
}

/**
 * Desfaz a exclusão — volta pra arquivado, não direto pra ativo (é o
 * `restaurarCliente` que tira do arquivado). Só grava se estiver excluído.
 */
export async function restaurarClienteExcluido(id: string): Promise<ResultadoArquivar> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .update({ excluido_em: null, excluido_por: null, motivo_exclusao: null })
    .eq('id', id)
    .not('excluido_em', 'is', null)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
    }
    console.error('Erro ao restaurar cliente excluído', error)
    return { ok: false, mensagem: 'Não foi possível restaurar o cliente. Tente novamente.' }
  }

  return data ? { ok: true } : { ok: false, mensagem: 'Cliente não encontrado ou não está excluído.' }
}

function traduzirErro(error: PostgrestError): ResultadoEscrita {
  if (error.code === '23505') {
    if (error.message.includes('clientes_cpf_unico')) {
      return { ok: false, campo: 'cpf', mensagem: 'Já existe um cliente com este CPF.' }
    }
    if (error.message.includes('clientes_cnpj_unico')) {
      return { ok: false, campo: 'cnpj', mensagem: 'Já existe um cliente com este CNPJ.' }
    }
  }

  if (error.code === '42501') {
    return { ok: false, mensagem: 'Você não tem permissão para esta operação.' }
  }

  console.error('Erro ao gravar cliente', error)
  return { ok: false, mensagem: 'Não foi possível salvar o cliente. Tente novamente.' }
}

/**
 * Monta o filtro `or` do PostgREST para a busca.
 *
 * Vírgula, parênteses e aspas têm significado na sintaxe do `or` — deixar
 * passar permitiria ao usuário injetar condições no filtro. `%`, `_` e `*`
 * são curingas do `ilike`. Tudo isso é removido do termo.
 */
function filtroDeBusca(busca?: string): string | null {
  const termo = busca?.replace(/[,()"'\\%_*:]/g, ' ').trim()
  if (!termo) return null

  const condicoes = [
    `nome.ilike.*${termo}*`,
    `empresa.ilike.*${termo}*`,
    `email.ilike.*${termo}*`,
    `responsavel.ilike.*${termo}*`,
  ]

  const digitos = termo.replace(/\D/g, '')
  if (digitos.length >= 3) {
    for (const coluna of ['cpf', 'cnpj', 'telefone', 'whatsapp']) {
      condicoes.push(`${coluna}.like.*${digitos}*`)
    }
  }

  return condicoes.join(',')
}
