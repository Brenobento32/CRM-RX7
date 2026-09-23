import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import type { AtividadeInput, ProximaAcaoInput, TipoAtividade } from '@/lib/validations/atividade'

/** Quantas atividades a timeline carrega. */
export const LIMITE_TIMELINE = 100

export type ItemTimeline = {
  id: string
  tipo: TipoAtividade
  descricao: string
  data: string
  usuario: string | null
}

export type ProximaAcao = {
  id: string
  titulo: string
  data: string
  observacao: string | null
  negociacaoId: string | null
}

/**
 * Timeline do cliente, mais recente primeiro. A RLS de atividades segue o
 * cliente: quem vê o cliente vê toda a timeline, inclusive o que outra
 * pessoa registrou.
 */
export async function listarTimeline(clienteId: string): Promise<ItemTimeline[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('atividades')
    .select('id, tipo, descricao, data, usuario_id')
    .eq('cliente_id', clienteId)
    .order('data', { ascending: false })
    .limit(LIMITE_TIMELINE)

  if (error) {
    throw new Error('Não foi possível carregar a timeline.', { cause: error })
  }

  const nomes = await nomesDeUsuarios(data.map((a) => a.usuario_id))

  return data.map((a) => ({
    id: a.id,
    tipo: a.tipo,
    descricao: a.descricao,
    data: a.data,
    usuario: nomes.get(a.usuario_id) ?? null,
  }))
}

/** Próximas ações pendentes do cliente, da mais próxima para a mais distante. */
export async function listarProximasAcoes(clienteId: string): Promise<ProximaAcao[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('proximas_acoes')
    .select('id, titulo, data, observacao, negociacao_id')
    .eq('cliente_id', clienteId)
    .is('concluida_em', null)
    .order('data', { ascending: true })

  if (error) {
    throw new Error('Não foi possível carregar as próximas ações.', { cause: error })
  }

  return data.map((a) => ({
    id: a.id,
    titulo: a.titulo,
    data: a.data,
    observacao: a.observacao,
    negociacaoId: a.negociacao_id,
  }))
}

export type ResultadoAtividade =
  | { ok: true }
  | { ok: false; mensagem: string; campo?: 'negociacao_id' }

/** O autor (`usuario_id`) é preenchido pelo banco com `auth.uid()`. */
export async function registrarAtividade(
  clienteId: string,
  input: AtividadeInput,
): Promise<ResultadoAtividade> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase.from('atividades').insert({
    cliente_id: clienteId,
    negociacao_id: input.negociacao_id,
    tipo: input.tipo,
    descricao: input.descricao,
    data: input.data,
  })

  return error ? traduzirErro(error) : { ok: true }
}

export async function criarProximaAcao(
  clienteId: string,
  input: ProximaAcaoInput,
): Promise<ResultadoAtividade> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase.from('proximas_acoes').insert({
    cliente_id: clienteId,
    negociacao_id: input.negociacao_id,
    titulo: input.titulo,
    data: input.data,
    observacao: input.observacao,
  })

  return error ? traduzirErro(error) : { ok: true }
}

export async function concluirProximaAcao(id: string): Promise<ResultadoAtividade> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('proximas_acoes')
    .update({ concluida_em: new Date().toISOString() })
    .eq('id', id)
    .is('concluida_em', null)
    .select('id')
    .maybeSingle()

  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Próxima ação não encontrada.' }
}

function traduzirErro(error: PostgrestError): ResultadoAtividade {
  switch (error.code) {
    case '42501':
      return { ok: false, mensagem: 'Você não tem permissão para registrar neste cliente.' }
    case '23514':
      return {
        ok: false,
        campo: 'negociacao_id',
        mensagem: 'A negociação escolhida não é deste cliente.',
      }
    case '23503':
      return { ok: false, mensagem: 'Cliente ou negociação não encontrados.' }
  }

  console.error('Erro ao gravar atividade', error)
  return { ok: false, mensagem: 'Não foi possível salvar. Tente novamente.' }
}
