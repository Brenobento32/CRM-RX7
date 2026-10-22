import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { CampoNicho, NichoInput } from '@/lib/validations/nicho'

type Enums = Database['public']['Enums']

export type Nicho = { id: string; nome: string; cor: Enums['cor_etapa'] }

/**
 * Nichos ativos para o seletor da ficha (item 3 do refinamento) — nunca
 * texto livre: o usuário só escolhe entre o que está cadastrado no banco.
 * "Outros" não é uma linha aqui: é a ausência de `nicho_id` (null), montada
 * pela própria UI do seletor.
 */
export async function listarNichosAtivos(): Promise<Nicho[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('nichos')
    .select('id, nome, cor')
    .eq('ativo', true)
    .order('ordem')
    .order('created_at')

  if (error) throw new Error('Não foi possível carregar os nichos.', { cause: error })
  return data
}

// ---------------------------------------------------------------------------
// Configuração (/configuracoes/nichos) — somente gerente. A RLS de `nichos`
// e o trigger `nichos_regras` (nunca exclui fisicamente um nicho em uso)
// garantem as regras; a checagem aqui evita a viagem e dá mensagem clara.
// Excluir não existe aqui: a aplicação nunca tem essa opção (RLS/grant de
// DELETE removidos — ver 20261008130000) — só ativar/desativar.
// ---------------------------------------------------------------------------

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente gerentes configuram nichos.')
}

export type NichoComUso = {
  id: string
  nome: string
  slug: string
  cor: Enums['cor_etapa']
  ativo: boolean
  ordem: number
  /** Já usado por alguma negociação ou formulário — nunca mais pode ser excluído, só desativado. */
  emUso: boolean
}

/** Todos os nichos (ativos e desativados), na ordem configurada, com o uso de cada um. */
export async function listarNichosComUso(): Promise<NichoComUso[]> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('nichos')
    .select('id, nome, slug, cor, ativo, ordem, negociacoes:negociacoes(count), formularios:formularios(count)')
    .order('ordem')
    .order('created_at')

  if (error) throw new Error('Não foi possível carregar os nichos.', { cause: error })
  return data.map(({ negociacoes, formularios, ordem, ...n }) => ({
    ...n,
    ordem: Number(ordem),
    emUso: Number(negociacoes[0]?.count ?? 0) > 0 || Number(formularios[0]?.count ?? 0) > 0,
  }))
}

export type ResultadoNicho = { ok: true } | { ok: false; mensagem: string; campo?: CampoNicho }

/**
 * `slug` é o identificador estável do payload de ingestão (nunca o nome, que
 * pode ser editado) — gerado a partir do nome na criação e nunca mais
 * tocado. Sem acento, só `[a-z0-9-]` (mesma regra da constraint do banco).
 */
function slugificar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function criarNicho(input: NichoInput): Promise<ResultadoNicho> {
  await exigirGerente()
  const [supabase, empresa] = await Promise.all([createClient(), getEmpresaAtual()])
  const base = slugificar(input.nome) || 'nicho'

  const { data: maiorOrdem } = await supabase
    .from('nichos')
    .select('ordem')
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle()
  const ordem = Number(maiorOrdem?.ordem ?? 0) + 1000

  // Colisão de slug (nomes muito parecidos): tenta um sufixo numérico antes
  // de desistir — o usuário nunca vê nem edita o slug.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const slug = tentativa === 0 ? base : `${base}-${tentativa + 1}`
    const { error } = await supabase
      .from('nichos')
      .insert({ tenant_id: empresa.id, nome: input.nome, cor: input.cor, ativo: input.ativo, slug, ordem })

    if (!error) return { ok: true }
    if (error.code === '23505' && error.message.includes('slug')) continue
    return traduzirErro(error)
  }
  return {
    ok: false,
    campo: 'nome',
    mensagem: 'Não foi possível gerar um identificador único para este nome. Tente um nome diferente.',
  }
}

export async function editarNicho(id: string, input: NichoInput): Promise<ResultadoNicho> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('nichos')
    .update({ nome: input.nome, cor: input.cor, ativo: input.ativo })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Nicho não encontrado.' }
}

export async function definirAtivoNicho(id: string, ativo: boolean): Promise<ResultadoNicho> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('nichos')
    .update({ ativo })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Nicho não encontrado.' }
}

/** Troca de posição com o vizinho imediato (lista completa, ativos e desativados juntos). */
export async function moverNicho(id: string, direcao: 'cima' | 'baixo'): Promise<ResultadoNicho> {
  await exigirGerente()
  const supabase = await createClient()

  const { data: todos, error: erroLista } = await supabase
    .from('nichos')
    .select('id, ordem')
    .order('ordem')
    .order('created_at')
  if (erroLista) return traduzirErro(erroLista)

  const i = todos.findIndex((n) => n.id === id)
  if (i === -1) return { ok: false, mensagem: 'Nicho não encontrado.' }

  const j = direcao === 'cima' ? i - 1 : i + 1
  if (j < 0 || j >= todos.length) {
    return { ok: false, mensagem: direcao === 'cima' ? 'Já é o primeiro.' : 'Já é o último.' }
  }

  const atual = todos[i]
  const vizinho = todos[j]
  const { error } = await supabase.from('nichos').update({ ordem: vizinho.ordem }).eq('id', atual.id)
  if (error) return traduzirErro(error)
  const { error: erro2 } = await supabase.from('nichos').update({ ordem: atual.ordem }).eq('id', vizinho.id)
  if (erro2) return traduzirErro(erro2)
  return { ok: true }
}

function traduzirErro(error: PostgrestError): Extract<ResultadoNicho, { ok: false }> {
  if (error.code === '23505') {
    if (error.message.includes('nome')) {
      return { ok: false, campo: 'nome', mensagem: 'Já existe um nicho ativo com esse nome.' }
    }
    return { ok: false, mensagem: 'Conflito ao salvar o nicho. Tente novamente.' }
  }
  if (error.code === '23514') return { ok: false, mensagem: 'Dados inválidos para o nicho.' }
  if (error.code === '42501') return { ok: false, mensagem: 'Somente gerentes configuram nichos.' }

  console.error('Erro em nichos', error)
  return { ok: false, mensagem: 'Não foi possível salvar o nicho. Tente novamente.' }
}
