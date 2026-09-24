import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual, type UserRole } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import { primeiroDiaDoMes } from '@/lib/utils/periodo'
import {
  ALVO_EMPRESA,
  type CampoMeta,
  type CriarMetaInput,
  type EditarMetaInput,
} from '@/lib/validations/meta'

export type ProgressoEmpresa = {
  metaId: string | null
  valorMeta: number | null
  realizado: number
  /** Realizado ÷ meta. Passa de 1 quando a meta é batida. `null` sem meta. */
  percentual: number | null
}

export type ProgressoPessoa = ProgressoEmpresa & {
  usuarioId: string
  nome: string
  role: UserRole
  ativo: boolean
}

export type ProgressoMetas = {
  /** Só para o gerente. */
  empresa: ProgressoEmpresa | null
  /** Gerente: a equipe, por nome. Closer: só ele. */
  pessoas: ProgressoPessoa[]
}

export function percentualMeta(realizado: number, meta: number | null): number | null {
  return meta === null || meta <= 0 ? null : realizado / meta
}

/**
 * Meta × realizado do mês (AAAA-MM). O que cada um enxerga é decidido em
 * `metas_progresso`, no banco: o gerente recebe a empresa e a equipe, o
 * closer só a própria linha.
 */
export async function obterProgressoMetas(mes: string): Promise<ProgressoMetas> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('metas_progresso', { p_mes: primeiroDiaDoMes(mes) })
  if (error) throw new Error('Não foi possível carregar as metas.', { cause: error })

  let empresa: ProgressoEmpresa | null = null
  const pessoas: ProgressoPessoa[] = []

  // Os tipos gerados marcam as colunas como não nulas; na linha da empresa
  // usuario_id, nome, role e ativo vêm nulos, e valor_meta é nulo sem meta.
  for (const linha of data) {
    const valorMeta = linha.valor_meta === null ? null : Number(linha.valor_meta)
    const realizado = Number(linha.realizado)
    const base = {
      metaId: (linha.meta_id as string | null) ?? null,
      valorMeta,
      realizado,
      percentual: percentualMeta(realizado, valorMeta),
    }

    if ((linha.usuario_id as string | null) === null) {
      empresa = base
    } else {
      pessoas.push({ ...base, usuarioId: linha.usuario_id, nome: linha.nome, role: linha.role, ativo: linha.ativo })
    }
  }

  pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  return { empresa, pessoas }
}

// ---------------------------------------------------------------------------
// Gestão — somente gerente. A RLS de `metas` é quem garante; a checagem aqui
// evita a viagem e dá mensagem clara.
// ---------------------------------------------------------------------------

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente gerentes definem metas.')
}

export type Meta = {
  id: string
  /** `null` = meta da empresa. */
  usuarioId: string | null
  /** Nome do closer, ou "Empresa". */
  alvo: string
  /** AAAA-MM */
  mes: string
  valorMeta: number
}

export async function obterMeta(id: string): Promise<Meta | null> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('metas')
    .select('id, usuario_id, periodo_mes, valor_meta, usuario:profiles!metas_usuario_id_fkey(nome)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('Não foi possível carregar a meta.', { cause: error })
  if (!data) return null

  return {
    id: data.id,
    usuarioId: data.usuario_id,
    alvo: data.usuario_id === null ? 'Empresa' : (data.usuario?.nome ?? 'Closer'),
    mes: data.periodo_mes.slice(0, 7),
    valorMeta: Number(data.valor_meta),
  }
}

export type OpcaoAlvo = { valor: string; rotulo: string }

/** Empresa + closers ativos, para o formulário de nova meta. */
export async function listarAlvosDeMeta(): Promise<OpcaoAlvo[]> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome')
    .eq('role', 'closer')
    .eq('ativo', true)
    .order('nome')

  if (error) throw new Error('Não foi possível carregar os closers.', { cause: error })
  return [
    { valor: ALVO_EMPRESA, rotulo: 'Empresa (meta geral)' },
    ...data.map((p) => ({ valor: p.id, rotulo: p.nome })),
  ]
}

export type ResultadoMeta = { ok: true } | { ok: false; mensagem: string; campo?: CampoMeta }

export async function criarMeta(input: CriarMetaInput): Promise<ResultadoMeta> {
  await exigirGerente()
  const supabase = await createClient()

  const { error } = await supabase.from('metas').insert({
    usuario_id: input.alvo === ALVO_EMPRESA ? null : input.alvo,
    periodo_mes: primeiroDiaDoMes(input.mes),
    valor_meta: Number(input.valor_meta),
  })
  return error ? traduzirErro(error) : { ok: true }
}

export async function editarMeta(id: string, input: EditarMetaInput): Promise<ResultadoMeta> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('metas')
    .update({ valor_meta: Number(input.valor_meta) })
    .eq('id', id)
    .select('id')

  if (error) return traduzirErro(error)
  return data.length === 0 ? { ok: false, mensagem: 'Meta não encontrada.' } : { ok: true }
}

export async function removerMeta(id: string): Promise<ResultadoMeta> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase.from('metas').delete().eq('id', id).select('id')
  if (error) return traduzirErro(error)
  return data.length === 0 ? { ok: false, mensagem: 'Meta não encontrada.' } : { ok: true }
}

function traduzirErro(error: PostgrestError): Extract<ResultadoMeta, { ok: false }> {
  switch (error.code) {
    case '23505':
      return { ok: false, campo: 'alvo', mensagem: 'Já existe uma meta para este alvo neste mês. Edite a existente.' }
    case '23514':
      // Mensagens dos triggers de `metas` já são para o usuário.
      return { ok: false, mensagem: error.message }
    case '42501':
      return { ok: false, mensagem: 'Sem permissão para alterar metas.' }
    default:
      return { ok: false, mensagem: 'Não foi possível salvar a meta. Tente novamente.' }
  }
}
