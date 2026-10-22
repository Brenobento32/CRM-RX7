import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { getUsuarioAtual, type UserRole } from '@/lib/dal/auth'
import { getEmpresaAtual, membrosDaEmpresa } from '@/lib/dal/empresa'
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
  /** Quantidade de vendas deste tipo no mês — para o ticket médio (realizado ÷ quantidade). */
  quantidade: number
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
 * O gerador de tipos marca `meta_id_tcv`/`meta_id_mrr`/`usuario_id`/`nome`/
 * `role`/`ativo`/`valor_meta_tcv`/`valor_meta_mrr` como não-nulos (ele só
 * "vê" o formato geral do `union all`, não que a linha da EMPRESA devolve
 * `usuario_id`/`nome`/`role`/`ativo` como `null::...` explícito no SQL, e
 * que `valor_meta_tcv`/`valor_meta_mrr` vêm de um `left join` que pode não
 * casar). Tipo local, baseado no oficial, só relaxando essas colunas.
 */
type LinhaMetasProgressoRpc = Omit<
  Database['public']['Functions']['metas_progresso']['Returns'][number],
  'meta_id_tcv' | 'meta_id_mrr' | 'usuario_id' | 'nome' | 'role' | 'ativo' | 'valor_meta_tcv' | 'valor_meta_mrr'
> & {
  meta_id_tcv: string | null
  meta_id_mrr: string | null
  usuario_id: string | null
  nome: string | null
  role: UserRole | null
  ativo: boolean | null
  valor_meta_tcv: number | string | null
  valor_meta_mrr: number | string | null
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

  const linhas = data as unknown as LinhaMetasProgressoRpc[]
  for (const linha of linhas) {
    const valorMetaTcv = linha.valor_meta_tcv === null ? null : Number(linha.valor_meta_tcv)
    const valorMetaMrr = linha.valor_meta_mrr === null ? null : Number(linha.valor_meta_mrr)
    const realizadoTcv = Number(linha.realizado_tcv)
    const realizadoMrr = Number(linha.realizado_mrr)
    const base: ProgressoEmpresa = {
      tcv: {
        metaId: linha.meta_id_tcv,
        valorMeta: valorMetaTcv,
        realizado: realizadoTcv,
        percentual: percentualMeta(realizadoTcv, valorMetaTcv),
        quantidade: Number(linha.qtd_tcv),
      },
      mrr: {
        metaId: linha.meta_id_mrr,
        valorMeta: valorMetaMrr,
        realizado: realizadoMrr,
        percentual: percentualMeta(realizadoMrr, valorMetaMrr),
        quantidade: Number(linha.qtd_mrr),
      },
    }

    if (linha.usuario_id === null) {
      empresa = base
    } else {
      pessoas.push({ ...base, usuarioId: linha.usuario_id, nome: linha.nome ?? '', role: linha.role!, ativo: linha.ativo! })
    }
  }

  pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  return { empresa, pessoas }
}

export type ProgressoFunilMeta = {
  funilId: string
  funilNome: string
  tcv: Omit<ProgressoMetaTipo, 'quantidade'>
  mrr: Omit<ProgressoMetaTipo, 'quantidade'>
}

/**
 * `meta_id_tcv`/`meta_id_mrr`/`valor_meta_tcv`/`valor_meta_mrr` vêm de um
 * `left join` que pode não casar (funil sem meta definida naquele mês) —
 * mesma imprecisão do gerador de `LinhaMetasProgressoRpc`, relaxada aqui.
 */
type LinhaMetasFunisProgressoRpc = Omit<
  Database['public']['Functions']['metas_funis_progresso']['Returns'][number],
  'meta_id_tcv' | 'meta_id_mrr' | 'valor_meta_tcv' | 'valor_meta_mrr'
> & {
  meta_id_tcv: string | null
  valor_meta_tcv: number | string | null
  meta_id_mrr: string | null
  valor_meta_mrr: number | string | null
}

/**
 * Meta × realizado mensal (TCV/MRR) de cada funil ATIVO — uma linha por
 * funil, nunca hardcoded (`metas_funis_progresso` já devolve um funil novo
 * automaticamente). Sem distinção por papel: a RPC não expõe nenhum dado
 * individual (é um agregado por funil, "visão de equipe" como a meta da
 * empresa), então GERENTE/SDR/CLOSER recebem exatamente as mesmas linhas.
 * Segue o MÊS da Meta Mensal (`mes`), nunca o período operacional do funil
 * visual/resultados.
 */
export async function obterProgressoMetasFunis(mes: string): Promise<ProgressoFunilMeta[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('metas_funis_progresso', { p_mes: primeiroDiaDoMes(mes) })
  if (error) throw new Error('Não foi possível carregar as metas por funil.', { cause: error })

  const linhas = data as unknown as LinhaMetasFunisProgressoRpc[]
  return linhas.map((linha) => {
    const valorMetaTcv = linha.valor_meta_tcv === null ? null : Number(linha.valor_meta_tcv)
    const valorMetaMrr = linha.valor_meta_mrr === null ? null : Number(linha.valor_meta_mrr)
    const realizadoTcv = Number(linha.realizado_tcv)
    const realizadoMrr = Number(linha.realizado_mrr)
    return {
      funilId: linha.funil_id,
      funilNome: linha.funil_nome,
      tcv: {
        metaId: linha.meta_id_tcv,
        valorMeta: valorMetaTcv,
        realizado: realizadoTcv,
        percentual: percentualMeta(realizadoTcv, valorMetaTcv),
      },
      mrr: {
        metaId: linha.meta_id_mrr,
        valorMeta: valorMetaMrr,
        realizado: realizadoMrr,
        percentual: percentualMeta(realizadoMrr, valorMetaMrr),
      },
    }
  })
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

  const [{ data, error }, membros] = await Promise.all([
    supabase.from('profiles').select('id, nome').eq('ativo', true).order('nome'),
    membrosDaEmpresa(),
  ])

  if (error) throw new Error('Não foi possível carregar os closers.', { cause: error })
  // Closer na empresa da requisição (o papel não é mais o global do perfil).
  const closers = data.filter((p) => {
    const membro = membros.get(p.id)
    return membro?.ativo && membro.role === 'closer'
  })
  return [
    { valor: ALVO_EMPRESA, rotulo: 'Empresa (meta geral)' },
    ...closers.map((p) => ({ valor: p.id, rotulo: p.nome })),
  ]
}

export type ResultadoMeta = { ok: true } | { ok: false; mensagem: string; campo?: CampoMeta }

export async function criarMeta(input: CriarMetaInput): Promise<ResultadoMeta> {
  await exigirGerente()
  const [supabase, empresa] = await Promise.all([createClient(), getEmpresaAtual()])

  const { error } = await supabase.from('metas').insert({
    tenant_id: empresa.id,
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

export type ItemMetaFunil = { funilId: string; tipoMeta: TipoMeta; valorMeta: number }

/**
 * Salva (upsert) a meta mensal (TCV/MRR) de um ou mais funis numa ÚNICA
 * operação ATÔMICA — tudo-ou-nada. Nunca faz upsert item a item em
 * chamadas `.rpc()`/`.upsert()` separadas: isso permitiria salvamento
 * PARCIAL se um item no meio da lista falhasse (ex.: terceiro campo
 * inválido depois dos dois primeiros já gravados). A RPC
 * `salvar_metas_funis` (migration 20261019180000) valida TODOS os itens
 * antes de escrever qualquer linha, dentro da MESMA transação desta
 * chamada — qualquer erro aborta a função inteira no banco, nenhum efeito
 * parcial é possível.
 *
 * `itens`: só os campos PREENCHIDOS no formulário (decidido pela action
 * antes de chamar esta função) — nunca um array vazio faz sentido aqui (a
 * action nem chama se não houver nenhum item válido). `usuario_id` nunca é
 * parâmetro: a RPC sempre grava `usuario_id = null` (meta por funil é
 * sempre da empresa).
 */
export async function salvarMetasFunis(mes: string, itens: ItemMetaFunil[]): Promise<ResultadoMeta> {
  await exigirGerente()
  const supabase = await createClient()

  const payload = itens.map((item) => ({
    funil_id: item.funilId,
    tipo_meta: item.tipoMeta,
    valor_meta: item.valorMeta,
  }))

  const { error } = await supabase.rpc('salvar_metas_funis', {
    p_mes: primeiroDiaDoMes(mes),
    p_itens: payload,
  })
  return error ? traduzirErro(error) : { ok: true }
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
