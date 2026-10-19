import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual, type UserRole } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { metaProporcionalPeriodo, type MetaPeriodo } from '@/lib/utils/financeiro-periodo'
import { primeiroDiaDoMes } from '@/lib/utils/periodo'
import {
  ALVO_EMPRESA,
  type CampoMeta,
  type CriarMetaInput,
  type EditarMetaInput,
} from '@/lib/validations/meta'

export type TipoMeta = Database['public']['Enums']['tipo_venda']

export type ProgressoMetaTipo = {
  metaId: string | null
  valorMeta: number | null
  realizado: number
  /** Realizado ÷ meta. Passa de 1 quando a meta é batida. `null` sem meta. */
  percentual: number | null
}

export type ProgressoEmpresa = { tcv: ProgressoMetaTipo; mrr: ProgressoMetaTipo }

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
 * Meta × realizado do mês (AAAA-MM), TCV e MRR nunca somados — são dois
 * totais independentes por alvo. O que cada um enxerga é decidido em
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
  // usuario_id, nome, role e ativo vêm nulos, e os valor_meta_* são nulos
  // sem meta definida para aquele tipo.
  for (const linha of data) {
    const valorMetaTcv = linha.valor_meta_tcv === null ? null : Number(linha.valor_meta_tcv)
    const valorMetaMrr = linha.valor_meta_mrr === null ? null : Number(linha.valor_meta_mrr)
    const realizadoTcv = Number(linha.realizado_tcv)
    const realizadoMrr = Number(linha.realizado_mrr)
    const base: ProgressoEmpresa = {
      tcv: {
        metaId: (linha.meta_id_tcv as string | null) ?? null,
        valorMeta: valorMetaTcv,
        realizado: realizadoTcv,
        percentual: percentualMeta(realizadoTcv, valorMetaTcv),
      },
      mrr: {
        metaId: (linha.meta_id_mrr as string | null) ?? null,
        valorMeta: valorMetaMrr,
        realizado: realizadoMrr,
        percentual: percentualMeta(realizadoMrr, valorMetaMrr),
      },
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

/**
 * Meta proporcionada a um período arbitrário (não necessariamente um mês
 * inteiro) — schema continua mensal (`metas.periodo_mes`), sem nenhuma
 * tabela/coluna nova: busca TODAS as metas do alvo (`usuario_id = null`
 * para a empresa, ou o uuid da pessoa — mesma RLS de `obterMeta`/`metas_select`:
 * `usuario_id = auth.uid() OR is_gerente()`) e deixa `metaProporcionalPeriodo`
 * (pura, `lib/utils/financeiro-periodo.ts`) somar a fração de cada mês que
 * o período toca. Mês completo = 100% da meta daquele mês; período
 * parcial = a fração de dias; vários meses somam a parcela de cada um.
 * Mês sem meta definida contribui 0 sem anular os demais; `null` só se
 * NENHUM mês tocado tiver meta.
 */
export async function obterMetaPeriodo(
  periodo: { inicio: string; fim: string },
  usuarioId: string | null,
): Promise<MetaPeriodo> {
  await getUsuarioAtual()
  const supabase = await createClient()

  let query = supabase.from('metas').select('periodo_mes, tipo_meta, valor_meta')
  query = usuarioId === null ? query.is('usuario_id', null) : query.eq('usuario_id', usuarioId)
  const { data, error } = await query
  if (error) throw new Error('Não foi possível carregar a meta do período.', { cause: error })

  const paraMensal = (tipo: TipoMeta) =>
    data
      .filter((m) => m.tipo_meta === tipo)
      .map((m) => ({ mes: m.periodo_mes.slice(0, 7), valorMeta: Number(m.valor_meta) }))

  return {
    tcv: metaProporcionalPeriodo(paraMensal('tcv'), periodo),
    mrr: metaProporcionalPeriodo(paraMensal('mrr'), periodo),
  }
}

export type RealizadoGeral = { tcv: number; mrr: number }

/**
 * `realizado_periodo` já está nos tipos gerados, mas o gerador não consegue
 * expressar que a linha da EMPRESA (a primeira do `union all`, no corpo da
 * função) devolve `usuario_id`/`nome`/`role`/`ativo` como `null` — ele
 * marca as 4 colunas como não nulas (olhando só a segunda metade do
 * `union all`, a de cada pessoa). Por isso este tipo local, baseado no
 * tipo oficial (`Database['public']['Functions']`), só relaxando essas 4
 * colunas pra refletir o `null::uuid`/`null::text`/... reais do SQL.
 */
type LinhaRealizadoPeriodo = Omit<
  Database['public']['Functions']['realizado_periodo']['Returns'][number],
  'usuario_id' | 'nome' | 'role' | 'ativo'
> & {
  usuario_id: string | null
  nome: string | null
  role: UserRole | null
  ativo: boolean | null
}

/**
 * Realizado (TCV/MRR) de TODOS os funis, no período, pra par com
 * `obterMetaPeriodo` — juntos formam o "meta geral/individual" correto de
 * `/funil/metricas`. NUNCA usar `obterRealizadoFunil` pra isso: ela filtra
 * por um funil só (certo pro que ELA representa — vendido/ticket médio
 * daquele funil — errado pra comparar com uma meta que nunca é por funil).
 *
 * Chama `realizado_periodo` (SECURITY DEFINER, mesma atribuição por
 * `responsavel_id` de `metas_progresso`) e filtra a UMA linha que importa
 * pro alvo pedido (`null` = empresa, ou o uuid da pessoa) — a RPC já só
 * devolve as linhas que o chamador pode ver (closer só a própria).
 */
export async function obterRealizadoGeral(
  periodo: { inicio: string; fim: string },
  usuarioId: string | null,
): Promise<RealizadoGeral> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('realizado_periodo', {
    p_inicio: periodo.inicio,
    p_fim: periodo.fim,
  })
  if (error) throw new Error('Não foi possível carregar o realizado do período.', { cause: error })

  const linhas = data as unknown as LinhaRealizadoPeriodo[]
  const linha = linhas.find((l) => l.usuario_id === usuarioId)
  if (!linha) return { tcv: 0, mrr: 0 }

  return { tcv: Number(linha.realizado_tcv), mrr: Number(linha.realizado_mrr) }
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
  /** `null` só em metas criadas antes desta funcionalidade — nunca em uma nova. */
  tipoMeta: TipoMeta | null
  /** AAAA-MM */
  mes: string
  valorMeta: number
}

export async function obterMeta(id: string): Promise<Meta | null> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('metas')
    .select('id, usuario_id, periodo_mes, valor_meta, tipo_meta, usuario:profiles!metas_usuario_id_fkey(nome)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('Não foi possível carregar a meta.', { cause: error })
  if (!data) return null

  return {
    id: data.id,
    usuarioId: data.usuario_id,
    alvo: data.usuario_id === null ? 'Empresa' : (data.usuario?.nome ?? 'Closer'),
    tipoMeta: data.tipo_meta,
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
    tipo_meta: input.tipo_meta,
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
      return {
        ok: false,
        campo: 'alvo',
        mensagem: 'Já existe uma meta deste tipo (TCV/MRR) para este alvo neste mês. Edite a existente.',
      }
    case '23514':
      // Mensagens dos triggers de `metas` já são para o usuário.
      return { ok: false, mensagem: error.message }
    case '42501':
      return { ok: false, mensagem: 'Sem permissão para alterar metas.' }
    default:
      return { ok: false, mensagem: 'Não foi possível salvar a meta. Tente novamente.' }
  }
}
