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
export async function listarClientes({
  busca,
  pagina,
}: {
  busca?: string
  pagina: number
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
    .is('deleted_at', null)
    .order('nome', { ascending: true })
    .range(inicio, inicio + CLIENTES_POR_PAGINA - 1)

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

/**
 * `null` quando o cliente não existe ou não pertence à carteira do usuário.
 * Em `cache` porque `generateMetadata` e a página pedem o mesmo cliente.
 */
export const obterCliente = cache(async (id: string): Promise<ClienteDetalhe | null> => {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select(
      `id, tipo_cliente, nome, empresa, cpf, cnpj, telefone, whatsapp, email,
       responsavel, cargo, observacoes, owner_id, created_at, updated_at,
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
export async function criarCliente(input: ClienteInput): Promise<ResultadoEscrita> {
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
