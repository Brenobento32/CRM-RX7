import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { CriarFunilInput } from '@/lib/validations/funis'

export type Funil = {
  id: string
  nome: string
  descricao: string | null
  padrao: boolean
  ativo: boolean
  ordem: number
  /** Libera a seção/drawer de conversa WhatsApp no Kanban deste funil. */
  whatsappHabilitado: boolean
}

export type FunilComUso = Funil & { negociacoesAtuais: number }

const COLUNAS = 'id, nome, descricao, padrao, ativo, ordem, whatsapp_habilitado'

function paraFunil(f: {
  id: string
  nome: string
  descricao: string | null
  padrao: boolean
  ativo: boolean
  ordem: number
  whatsapp_habilitado: boolean
}): Funil {
  return {
    id: f.id,
    nome: f.nome,
    descricao: f.descricao,
    padrao: f.padrao,
    ativo: f.ativo,
    ordem: Number(f.ordem),
    whatsappHabilitado: f.whatsapp_habilitado,
  }
}

/**
 * Funis visíveis pro usuário atual, na ordem da lista.
 *
 * Gerente: todos (RLS de `funis` é `select = true` pra todo autenticado,
 * mas a lista que oferecemos pra escolher é filtrada aqui — "não mostrar
 * funis não autorizados", item do Kanban).
 *
 * Closer/SDR: SOMENTE os funis com acesso explícito em
 * `permissoes_colaborador` (linha `etapa_id is null`) — owner_id NÃO conta
 * mais pra esta lista; é a mesma mudança de modelo da RLS de `negociacoes`
 * (permissão é a única fonte de verdade de acesso, owner_id só segue
 * existindo pra atribuição/responsável). Sem nenhuma permissão, a lista
 * vem vazia — `resolverFunilSelecionado` trata isso sem quebrar.
 */
export async function listarFunis(): Promise<Funil[]> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()
  const { data, error } = await supabase.from('funis').select(COLUNAS).order('ordem')
  if (error) throw new Error('Não foi possível carregar os funis.', { cause: error })
  const funis = data.map(paraFunil)

  if (usuario.role === 'gerente') return funis

  const { data: permitidos, error: erroPermitidos } = await supabase
    .from('permissoes_colaborador')
    .select('funil_id')
    .eq('usuario_id', usuario.id)
    .is('etapa_id', null)
  if (erroPermitidos) throw new Error('Não foi possível carregar os funis.', { cause: erroPermitidos })

  const visiveis = new Set(permitidos.map((p) => p.funil_id))
  return funis.filter((f) => visiveis.has(f.id))
}

export async function obterFunil(id: string): Promise<Funil | null> {
  await getUsuarioAtual()
  const supabase = await createClient()
  const { data, error } = await supabase.from('funis').select(COLUNAS).eq('id', id).maybeSingle()
  if (error) throw new Error('Não foi possível carregar o funil.', { cause: error })
  return data ? paraFunil(data) : null
}

/**
 * Resolve qual funil está selecionado: `?funil=` na URL (se ativo, existente
 * e VISÍVEL pro usuário) → preferência salva em cookie (idem) → Funil
 * Principal, se visível → o primeiro funil visível, se houver algum.
 *
 * `null`: usuário sem nenhum funil visível (nem carteira própria, nem
 * permissão configurada em nenhum) — a página decide o que mostrar (nunca
 * mais lança erro genérico aqui; antes do sistema de permissões, isso era
 * impossível, porque o Funil Principal sempre aparecia pra todo mundo).
 */
export async function resolverFunilSelecionado(
  funilParam: unknown,
  cookieFunilId: unknown,
): Promise<Funil | null> {
  const funis = await listarFunis()
  const ativos = new Map(funis.filter((f) => f.ativo).map((f) => [f.id, f]))

  if (typeof funilParam === 'string' && ativos.has(funilParam)) return ativos.get(funilParam)!
  if (typeof cookieFunilId === 'string' && ativos.has(cookieFunilId)) return ativos.get(cookieFunilId)!

  const padrao = funis.find((f) => f.padrao && f.ativo)
  if (padrao) return padrao

  return [...ativos.values()][0] ?? null
}

// ---------------------------------------------------------------------------
// Configuração — somente gerente. RLS e triggers de `funis`/`etapas_funil`
// garantem as regras; a checagem aqui só evita a viagem e dá mensagem clara.
// ---------------------------------------------------------------------------

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente gerentes configuram funis.')
}

/** Todos os funis com quantas negociações cada um tem — pra tela decidir se pode excluir. */
export async function listarFunisComUso(): Promise<FunilComUso[]> {
  await exigirGerente()
  const supabase = await createClient()

  const [funis, uso] = await Promise.all([
    supabase.from('funis').select(COLUNAS).order('ordem'),
    supabase.rpc('funis_uso'),
  ])
  if (funis.error) throw new Error('Não foi possível carregar os funis.', { cause: funis.error })
  if (uso.error) throw new Error('Não foi possível carregar o uso dos funis.', { cause: uso.error })

  const porFunil = new Map(uso.data.map((u) => [u.funil_id, u]))
  return funis.data.map((f) => ({
    ...paraFunil(f),
    negociacoesAtuais: Number(porFunil.get(f.id)?.negociacoes_atuais ?? 0),
  }))
}

export type ResultadoFunil = { ok: true; id?: string } | { ok: false; mensagem: string; campo?: 'nome' }

/** Funil + etapa ganha + etapa perdida (+ abertas opcionais) numa transação só (`criar_funil`). */
export async function criarFunil(input: CriarFunilInput): Promise<ResultadoFunil> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('criar_funil', {
    p_nome: input.nome,
    p_etapa_ganha_nome: input.etapaGanhaNome,
    p_etapa_ganha_cor: input.etapaGanhaCor,
    p_etapa_perdida_nome: input.etapaPerdidaNome,
    p_etapa_perdida_cor: input.etapaPerdidaCor,
    p_etapas_abertas: input.etapasAbertas,
  })

  if (error) return traduzirErro(error)
  return { ok: true, id: data }
}

/** Copia nome/cor/tipo/ordem das etapas; nunca copia negociação, histórico ou fechamento. */
export async function duplicarFunil(id: string, novoNome: string): Promise<ResultadoFunil> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('duplicar_funil', { p_funil_id: id, p_novo_nome: novoNome })
  if (error) return traduzirErro(error)
  return { ok: true, id: data }
}

export async function editarFunil(
  id: string,
  input: { nome: string; descricao: string | null; whatsappHabilitado: boolean },
): Promise<ResultadoFunil> {
  await exigirGerente()
  const supabase = await createClient()
  const { error } = await supabase
    .from('funis')
    .update({
      nome: input.nome,
      descricao: input.descricao,
      whatsapp_habilitado: input.whatsappHabilitado,
    })
    .eq('id', id)
  return error ? traduzirErro(error) : { ok: true }
}

/**
 * Ativar/desativar. O banco ainda não impede desativar o Funil Principal
 * (regra de aplicação só, até uma migration cobrir isso) — por isso a
 * checagem aqui é a única proteção contra deixar o sistema sem funil padrão
 * ativo; não confiar só nela se este código for chamado de outro lugar.
 */
export async function definirAtivoFunil(id: string, ativo: boolean): Promise<ResultadoFunil> {
  await exigirGerente()
  if (!ativo) {
    const funil = await obterFunil(id)
    if (funil?.padrao) return { ok: false, mensagem: 'O Funil Principal não pode ser desativado.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('funis')
    .update({ ativo })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Funil não encontrado.' }
}

/** Só funciona com funil vazio — o trigger `funis_regras` garante isso no banco. */
export async function excluirFunil(id: string): Promise<ResultadoFunil> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('funis').delete().eq('id', id).select('id').maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Funil não encontrado.' }
}

function traduzirErro(error: PostgrestError): Extract<ResultadoFunil, { ok: false }> {
  if (error.code === '23514') return { ok: false, mensagem: error.message }
  if (error.code === '23505') {
    return { ok: false, campo: 'nome', mensagem: 'Já existe um funil ativo com esse nome.' }
  }
  if (error.code === '42501') return { ok: false, mensagem: 'Somente gerentes configuram funis.' }
  if (error.code === 'P0002') return { ok: false, mensagem: 'Funil não encontrado.' }

  console.error('Erro em funis', error)
  return { ok: false, mensagem: 'Não foi possível salvar o funil. Tente novamente.' }
}
