import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { createClient } from '@/lib/supabase/server'
import type { CampoServico, ServicoInput } from '@/lib/validations/servico'

export type Servico = {
  id: string
  nome: string
  categoria: string | null
  ativo: boolean
}

export type ServicoComUso = Servico & { negociacoes: number }

const COLUNAS = 'id, nome, categoria, ativo'

/** Por categoria (sem categoria por último), depois por nome. */
export function ordenarServicos<T extends Servico>(servicos: T[]): T[] {
  return servicos.sort((a, b) => {
    if (a.categoria !== b.categoria) {
      if (a.categoria === null) return 1
      if (b.categoria === null) return -1
      return a.categoria.localeCompare(b.categoria, 'pt-BR')
    }
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

/**
 * Catálogo ativo. Todo usuário logado lê (RLS): é o que o closer consulta e
 * o que as negociações oferecem para escolha.
 */
export async function listarServicosAtivos(): Promise<Servico[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.from('servicos').select(COLUNAS).eq('ativo', true)
  if (error) throw new Error('Não foi possível carregar os serviços.', { cause: error })
  return ordenarServicos(data)
}

// ---------------------------------------------------------------------------
// Configuração — somente gerente. A RLS de `servicos` e a FK RESTRICT de
// `negociacao_servicos` garantem as regras; a checagem aqui evita a viagem e
// dá mensagem clara.
// ---------------------------------------------------------------------------

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente gerentes configuram serviços.')
}

/**
 * Todos os serviços (ativos e desativados) e em quantas negociações cada um
 * aparece. O gerente enxerga todos os vínculos pela RLS, então a contagem é
 * da empresa inteira.
 */
export async function listarServicosComUso(): Promise<ServicoComUso[]> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('servicos')
    .select(`${COLUNAS}, uso:negociacao_servicos!negociacao_servicos_servico_id_tenant_fkey(count)`)

  if (error) throw new Error('Não foi possível carregar os serviços.', { cause: error })
  return ordenarServicos(
    data.map(({ uso, ...s }) => ({ ...s, negociacoes: Number(uso[0]?.count ?? 0) })),
  )
}

export async function obterServico(id: string): Promise<Servico | null> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('servicos').select(COLUNAS).eq('id', id).maybeSingle()
  if (error) throw new Error('Não foi possível carregar o serviço.', { cause: error })
  return data
}

/** Categorias já usadas, para sugerir no formulário. */
export async function listarCategoriasDeServico(): Promise<string[]> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('servicos').select('categoria').not('categoria', 'is', null)
  if (error) throw new Error('Não foi possível carregar as categorias.', { cause: error })
  return [...new Set(data.flatMap((s) => (s.categoria ? [s.categoria] : [])))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )
}

export type ResultadoServico = { ok: true } | { ok: false; mensagem: string; campo?: CampoServico }

export async function criarServico(input: ServicoInput): Promise<ResultadoServico> {
  await exigirGerente()
  const [supabase, empresa] = await Promise.all([createClient(), getEmpresaAtual()])
  const { error } = await supabase
    .from('servicos')
    .insert({ tenant_id: empresa.id, nome: input.nome, categoria: input.categoria })
  return error ? traduzirErro(error) : { ok: true }
}

export async function editarServico(id: string, input: ServicoInput): Promise<ResultadoServico> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('servicos')
    .update({ nome: input.nome, categoria: input.categoria })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Serviço não encontrado.' }
}

export async function definirAtivoServico(id: string, ativo: boolean): Promise<ResultadoServico> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('servicos')
    .update({ ativo })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Serviço não encontrado.' }
}

/** Só passa para serviço nunca usado: a FK de negociacao_servicos é RESTRICT. */
export async function excluirServico(id: string): Promise<ResultadoServico> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('servicos').delete().eq('id', id).select('id').maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Serviço não encontrado.' }
}

function traduzirErro(error: PostgrestError): Extract<ResultadoServico, { ok: false }> {
  switch (error.code) {
    case '23505':
      return { ok: false, campo: 'nome', mensagem: 'Já existe um serviço com este nome.' }
    case '23503':
      return { ok: false, mensagem: 'Serviço em uso em negociações. Desative em vez de excluir.' }
    case '23514':
      return { ok: false, mensagem: 'Dados inválidos para o serviço.' }
    case '42501':
      return { ok: false, mensagem: 'Somente gerentes configuram serviços.' }
  }

  console.error('Erro em servicos', error)
  return { ok: false, mensagem: 'Não foi possível salvar o serviço. Tente novamente.' }
}
