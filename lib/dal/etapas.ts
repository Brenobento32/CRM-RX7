import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { cache } from 'react'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { CorEtapa, EtapaKanban, TipoEtapa } from '@/lib/utils/etapas'
import type { CriarEtapaInput, Direcao, EditarEtapaInput } from '@/lib/validations/etapa'

export type Etapa = EtapaKanban & {
  funilId: string
  ordem: number
  sistema: boolean
  chave: string | null
  ativo: boolean
  /** true = zona de recuperação (depois de ganha/perdida). false = fluxo comercial normal. */
  posFechamento: boolean
  /** Etapa onde leads automáticos (formulário) e reativação entram. No máximo uma por funil. */
  etapaInicial: boolean
}

export type EtapaComUso = Etapa & { negociacoesAtuais: number; jaUsada: boolean }

/** Distância padrão entre etapas quando não há vizinho de um dos lados. */
const PASSO = 1000

const COLUNAS = 'id, funil_id, nome, cor, tipo, ordem, sistema, chave, ativo, pos_fechamento, etapa_inicial'

function paraEtapa(e: {
  id: string
  funil_id: string
  nome: string
  cor: CorEtapa
  tipo: TipoEtapa
  ordem: number
  sistema: boolean
  chave: string | null
  ativo: boolean
  pos_fechamento: boolean
  etapa_inicial: boolean
}): Etapa {
  return {
    id: e.id,
    funilId: e.funil_id,
    nome: e.nome,
    cor: e.cor,
    tipo: e.tipo,
    ordem: Number(e.ordem),
    sistema: e.sistema,
    chave: e.chave,
    ativo: e.ativo,
    posFechamento: e.pos_fechamento,
    etapaInicial: e.etapa_inicial,
  }
}

/**
 * Etapas ativas de um funil, na ordem das colunas. Todo usuário logado lê
 * (RLS). Em `cache` porque layout, Kanban e formulários pedem a mesma lista.
 */
export const listarEtapas = cache(async (funilId: string): Promise<Etapa[]> => {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('etapas_funil')
    .select(COLUNAS)
    .eq('funil_id', funilId)
    .eq('ativo', true)
    .order('ordem')

  if (error) throw new Error('Não foi possível carregar as etapas do funil.', { cause: error })
  return data.map(paraEtapa)
})

// ---------------------------------------------------------------------------
// Configuração — somente gerente. A RLS e os triggers de `etapas_funil`
// garantem as regras; a checagem aqui só evita a viagem e dá mensagem clara.
// ---------------------------------------------------------------------------

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente gerentes configuram o funil.')
}

/** Todas as etapas (ativas e desativadas) de um funil, com o uso de cada uma. */
export async function listarEtapasComUso(funilId: string): Promise<EtapaComUso[]> {
  await exigirGerente()
  const supabase = await createClient()

  const [etapas, uso] = await Promise.all([
    supabase.from('etapas_funil').select(COLUNAS).eq('funil_id', funilId).order('ordem'),
    supabase.rpc('etapas_funil_uso'),
  ])
  if (etapas.error) throw new Error('Não foi possível carregar as etapas.', { cause: etapas.error })
  if (uso.error) throw new Error('Não foi possível carregar o uso das etapas.', { cause: uso.error })

  const porEtapa = new Map(uso.data.map((u) => [u.etapa_id, u]))
  return etapas.data.map((e) => ({
    ...paraEtapa(e),
    negociacoesAtuais: Number(porEtapa.get(e.id)?.negociacoes_atuais ?? 0),
    jaUsada: porEtapa.get(e.id)?.ja_usada ?? false,
  }))
}

export async function obterEtapa(id: string): Promise<Etapa | null> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('etapas_funil').select(COLUNAS).eq('id', id).maybeSingle()
  if (error) throw new Error('Não foi possível carregar a etapa.', { cause: error })
  return data ? paraEtapa(data) : null
}

export type ResultadoEtapa = { ok: true } | { ok: false; mensagem: string; campo?: 'nome' | 'cor' }

/**
 * Fronteira da zona normal (pipeline): a menor `ordem` entre ganha/perdida do
 * funil. Toda aberta normal (`posFechamento = false`) fica antes dela.
 * Mesma regra de `etapas_funil_regras()` no banco — se um dia divergir, vale
 * o banco. Exportada porque a tela de configuração usa a mesma conta pra
 * saber quais etapas podem subir/descer.
 */
export function limiteDeOrdemPipeline(etapas: Etapa[]): number {
  const fechamento = etapas.filter((e) => e.tipo === 'ganha' || e.tipo === 'perdida')
  if (fechamento.length === 0) {
    throw new Error('Funil sem etapa de fechamento (ganha/perdida) — configuração inconsistente.')
  }
  return Math.min(...fechamento.map((e) => e.ordem))
}

/**
 * Fronteira da zona de recuperação: a maior `ordem` entre ganha/perdida do
 * funil. Toda aberta de recuperação (`posFechamento = true`) fica depois
 * dela — simétrica a {@link limiteDeOrdemPipeline}.
 */
export function limiteDeOrdemRecuperacao(etapas: Etapa[]): number {
  const fechamento = etapas.filter((e) => e.tipo === 'ganha' || e.tipo === 'perdida')
  if (fechamento.length === 0) {
    throw new Error('Funil sem etapa de fechamento (ganha/perdida) — configuração inconsistente.')
  }
  return Math.max(...fechamento.map((e) => e.ordem))
}

/**
 * As abertas de cada zona que podem trocar de lugar entre si — uma normal
 * nunca troca de lugar com uma de recuperação, e vice-versa.
 */
function abertasPorZona(etapas: Etapa[]) {
  const limitePipeline = limiteDeOrdemPipeline(etapas)
  const limiteRecuperacao = limiteDeOrdemRecuperacao(etapas)
  return {
    pipeline: {
      limite: limitePipeline,
      lista: etapas.filter((e) => e.ativo && e.tipo === 'aberta' && !e.posFechamento && e.ordem < limitePipeline),
    },
    recuperacao: {
      limite: limiteRecuperacao,
      lista: etapas.filter((e) => e.ativo && e.tipo === 'aberta' && e.posFechamento && e.ordem > limiteRecuperacao),
    },
  }
}

/**
 * Nova personalizada entra na zona escolhida: logo antes do fechamento
 * (pipeline) ou logo depois dele (recuperação) — última posição da zona.
 */
export async function criarEtapa(funilId: string, input: CriarEtapaInput): Promise<ResultadoEtapa> {
  await exigirGerente()
  const supabase = await createClient()

  const { data: todas, error: erroLista } = await supabase
    .from('etapas_funil')
    .select(COLUNAS)
    .eq('funil_id', funilId)
    .order('ordem')
  if (erroLista) return traduzirErro(erroLista)

  const { pipeline, recuperacao } = abertasPorZona(todas.map(paraEtapa))
  const zona = input.posFechamento ? recuperacao : pipeline
  const ultima = zona.lista.at(-1)
  const ordem = ultima
    ? (ultima.ordem + zona.limite) / 2
    : input.posFechamento
      ? zona.limite + PASSO
      : zona.limite - PASSO

  const { error } = await supabase.from('etapas_funil').insert({
    funil_id: funilId,
    nome: input.nome,
    cor: input.cor,
    ordem,
    tipo: 'aberta',
    pos_fechamento: input.posFechamento,
  })

  return error ? traduzirErro(error) : { ok: true }
}

export async function editarEtapa(id: string, input: EditarEtapaInput): Promise<ResultadoEtapa> {
  await exigirGerente()
  const atual = await obterEtapa(id)
  if (!atual) return { ok: false, mensagem: 'Etapa não encontrada.' }

  // Sistema: só a cor. O trigger recusaria mudar o nome de qualquer jeito.
  const alteracoes = atual.sistema || !input.nome ? { cor: input.cor } : { nome: input.nome, cor: input.cor }

  const supabase = await createClient()
  const { error } = await supabase.from('etapas_funil').update(alteracoes).eq('id', id)
  return error ? traduzirErro(error) : { ok: true }
}

/**
 * Sobe ou desce uma personalizada uma posição entre as abertas da MESMA
 * zona do funil (pipeline ou recuperação — nunca cruza de uma pra outra).
 * Grava só a etapa movida: a nova ordem é o ponto médio entre os vizinhos
 * do lugar de destino.
 */
export async function moverEtapa(funilId: string, id: string, direcao: Direcao): Promise<ResultadoEtapa> {
  await exigirGerente()
  const supabase = await createClient()

  const { data: todas, error: erroLista } = await supabase
    .from('etapas_funil')
    .select(COLUNAS)
    .eq('funil_id', funilId)
  if (erroLista) return traduzirErro(erroLista)

  const etapas = todas.map(paraEtapa).sort((a, b) => a.ordem - b.ordem)
  const alvo = etapas.find((e) => e.id === id)
  if (!alvo || alvo.sistema) {
    return { ok: false, mensagem: 'Só etapas personalizadas ativas mudam de posição.' }
  }

  const { pipeline, recuperacao } = abertasPorZona(etapas)
  const { limite, lista } = alvo.posFechamento ? recuperacao : pipeline
  const i = lista.findIndex((e) => e.id === id)
  const etapa = lista[i]

  if (!etapa) {
    return { ok: false, mensagem: 'Só etapas personalizadas ativas mudam de posição.' }
  }

  // Nas duas zonas a lista está em ordem crescente de `ordem`. Na zona normal
  // o limite (fechamento) fica DEPOIS do último item — só "descer" precisa
  // dele. Na zona de recuperação o limite fica ANTES do primeiro item — só
  // "subir" precisa dele; o lado sem limite usa um passo livre qualquer.
  let ordem: number
  if (direcao === 'cima') {
    if (i === 0) {
      return {
        ok: false,
        mensagem: alvo.posFechamento
          ? 'Etapa de recuperação já é a primeira depois do fechamento.'
          : 'A etapa já é a primeira do funil.',
      }
    }
    const antesDoVizinho = lista[i - 2]?.ordem ?? (alvo.posFechamento ? limite : lista[i - 1].ordem - 2 * PASSO)
    ordem = (antesDoVizinho + lista[i - 1].ordem) / 2
  } else {
    if (i === lista.length - 1) {
      return {
        ok: false,
        mensagem: alvo.posFechamento
          ? 'Etapa de recuperação já é a última do funil.'
          : 'Etapas abertas ficam antes do fechamento do funil.',
      }
    }
    const depoisDoVizinho = lista[i + 2]?.ordem ?? (alvo.posFechamento ? lista[i + 1].ordem + 2 * PASSO : limite)
    ordem = (lista[i + 1].ordem + depoisDoVizinho) / 2
  }

  // Ordem é única por funil (inclui desativadas); o ponto médio de valores
  // distintos praticamente nunca colide, mas se colidir a mensagem é clara.
  const { error } = await supabase.from('etapas_funil').update({ ordem }).eq('id', id)
  return error ? traduzirErro(error) : { ok: true }
}

export async function definirAtivoEtapa(id: string, ativo: boolean): Promise<ResultadoEtapa> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('etapas_funil')
    .update({ ativo })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Etapa não encontrada.' }
}

export async function excluirEtapa(id: string): Promise<ResultadoEtapa> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('etapas_funil').delete().eq('id', id).select('id').maybeSingle()
  if (error) return traduzirErro(error)
  return data ? { ok: true } : { ok: false, mensagem: 'Etapa não encontrada ou não pode ser excluída.' }
}

/**
 * As regras vêm dos triggers de `etapas_funil`, que já escrevem a mensagem
 * para o usuário (código 23514).
 */
function traduzirErro(error: PostgrestError): ResultadoEtapa {
  if (error.code === '23514') return { ok: false, mensagem: error.message }
  if (error.code === '23505') {
    if (error.message.includes('nome')) {
      return { ok: false, campo: 'nome', mensagem: 'Já existe uma etapa ativa com esse nome.' }
    }
    return { ok: false, mensagem: 'Conflito de posição entre etapas. Tente de novo.' }
  }
  if (error.code === '23503') {
    return { ok: false, mensagem: 'A etapa já teve negociações. Desative-a em vez de excluir.' }
  }
  if (error.code === '42501') return { ok: false, mensagem: 'Somente gerentes configuram o funil.' }

  console.error('Erro em etapas_funil', error)
  return { ok: false, mensagem: 'Não foi possível salvar a etapa. Tente novamente.' }
}
