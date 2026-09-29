import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { subDays } from 'date-fns'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { DIAS_PARADO, tipoExigeModal } from '@/lib/utils/etapas'
import type { FechamentoInput, PerdaInput } from '@/lib/validations/funil'
import type { NovaNegociacaoInput } from '@/lib/validations/funis'

type Enums = Database['public']['Enums']

/** Quantos dias um card em etapa ganha/perdida continua visível no quadro. */
export const DIAS_VISIVEIS_ENCERRADOS = 30

export type CardFunil = {
  id: string
  etapaId: string
  posicao: number
  clienteId: string
  clienteNome: string
  clienteEmpresa: string | null
  valorEstimado: number | null
  temperatura: Enums['temperatura_negociacao'] | null
  responsavel: string | null
  /** Dias inteiros na etapa atual, calculados no servidor (sem divergir na hidratação). */
  diasNaEtapa: number
  /** Etapa aberta e há mais de DIAS_PARADO dias nela — mesma regra de `funil_metricas`. */
  parado: boolean
  /** `data` é AAAA-MM-DD (dia, sem hora). */
  proximaAcao: { titulo: string; data: string } | null
  ultimaAtividade: { tipo: Enums['tipo_atividade']; data: string; descricao: string } | null
}

/**
 * Cards do funil visíveis ao usuário. Como em clientes, não há filtro por
 * dono aqui: a view `funil_cards` é `security_invoker` e a RLS decide.
 *
 * Cards em etapa ganha ou perdida saem do quadro após
 * {@link DIAS_VISIVEIS_ENCERRADOS} dias na etapa — senão essas duas colunas
 * crescem para sempre.
 */
export async function listarCardsFunil(funilId: string): Promise<CardFunil[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const agora = Date.now()
  const corte = subDays(agora, DIAS_VISIVEIS_ENCERRADOS).toISOString()

  const { data, error } = await supabase
    .from('funil_cards')
    .select('*')
    .eq('funil_id', funilId)
    .or(`etapa_tipo.eq.aberta,data_entrada_etapa.gte."${corte}"`)
    // `id` desempata: sem ele, cards com a mesma posição trocam de lugar a
    // cada carregamento.
    .order('posicao', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    throw new Error('Não foi possível carregar o funil.', { cause: error })
  }

  // Colunas de view vêm todas como anuláveis nos tipos gerados; as que são
  // NOT NULL nas tabelas de origem nunca chegam nulas.
  return data.flatMap((r) =>
    r.id && r.etapa_id && r.cliente_id && r.cliente_nome && r.posicao !== null && r.data_entrada_etapa
      ? [
          {
            id: r.id,
            etapaId: r.etapa_id,
            posicao: r.posicao,
            clienteId: r.cliente_id,
            clienteNome: r.cliente_nome,
            clienteEmpresa: r.cliente_empresa,
            valorEstimado: r.valor_estimado,
            temperatura: r.temperatura,
            responsavel: r.responsavel_nome,
            diasNaEtapa: Math.floor((agora - new Date(r.data_entrada_etapa).getTime()) / 86_400_000),
            parado:
              r.etapa_tipo === 'aberta' &&
              agora - new Date(r.data_entrada_etapa).getTime() > DIAS_PARADO * 86_400_000,
            proximaAcao:
              r.proxima_acao_titulo && r.proxima_acao_data
                ? { titulo: r.proxima_acao_titulo, data: r.proxima_acao_data }
                : null,
            ultimaAtividade:
              r.ultima_atividade_tipo && r.ultima_atividade_data && r.ultima_atividade_descricao
                ? {
                    tipo: r.ultima_atividade_tipo,
                    data: r.ultima_atividade_data,
                    descricao: r.ultima_atividade_descricao,
                  }
                : null,
          },
        ]
      : [],
  )
}

export type ResultadoFunil = { ok: true } | { ok: false; mensagem: string }

const NAO_ENCONTRADA: ResultadoFunil = {
  ok: false,
  mensagem: 'Negociação não encontrada ou sem permissão para movê-la.',
}

/**
 * Move entre etapas abertas ou reordena dentro da coluna.
 *
 * O tipo da etapa de destino é lido do banco. Em etapa ganha/perdida só a
 * posição muda, e apenas se o card já estiver lá (`.eq('etapa_id', ...)`):
 * entrar nelas é com `fecharNegociacao` / `marcarPerdida`. Mesmo que esta
 * checagem falhasse, o banco recusaria ganha sem fechamento e perdida sem
 * motivo, e também etapa desativada.
 *
 * Closer só move o que é dele: a RLS esconde a linha e o UPDATE afeta 0.
 *
 * `reposicionar` traz os outros cards da coluna quando ela foi renumerada.
 * Esses UPDATEs mudam só a posição e só de cards que já estão na etapa —
 * nunca servem para trocar a etapa de ninguém.
 */
export async function moverNegociacao(
  id: string,
  etapaId: string,
  posicao: number,
  reposicionar: { id: string; posicao: number }[] = [],
): Promise<ResultadoFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data: etapa, error: erroEtapa } = await supabase
    .from('etapas_funil')
    .select('tipo, ativo')
    .eq('id', etapaId)
    .maybeSingle()
  if (erroEtapa) return traduzirErro(erroEtapa)
  if (!etapa || !etapa.ativo) return { ok: false, mensagem: 'Etapa não encontrada ou desativada.' }

  const query = tipoExigeModal(etapa.tipo)
    ? supabase.from('negociacoes').update({ posicao }).eq('id', id).eq('etapa_id', etapaId)
    : supabase.from('negociacoes').update({ etapa_id: etapaId, posicao }).eq('id', id)

  const { data, error } = await query.select('id').maybeSingle()

  if (error) return traduzirErro(error)
  if (!data) return NAO_ENCONTRADA

  const outros = reposicionar.filter((r) => r.id !== id)
  if (outros.length > 0) {
    const resultados = await Promise.all(
      outros.map((r) =>
        supabase.from('negociacoes').update({ posicao: r.posicao }).eq('id', r.id).eq('etapa_id', etapaId),
      ),
    )
    // Falha aqui só afeta a ordem visual; o movimento principal já foi gravado.
    const falhas = resultados.filter((r) => r.error)
    if (falhas.length > 0) console.error('Renumerar coluna do funil', falhas[0].error)
  }

  return { ok: true }
}

/** Fechamento + mudança de etapa numa transação (`public.fechar_negociacao`). */
export async function fecharNegociacao(f: FechamentoInput): Promise<ResultadoFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase.rpc('fechar_negociacao', {
    p_negociacao_id: f.negociacao_id,
    p_posicao: f.posicao,
    p_valor_vendido: Number(f.valor_vendido),
    p_data_fechamento: f.data_fechamento,
    p_contrato_enviado: f.contrato_enviado,
    p_contrato_assinado: f.contrato_assinado,
    p_link_contrato: f.link_contrato ?? undefined,
    p_status_pagamento: f.status_pagamento,
    p_status_onboarding: f.status_onboarding,
  })

  if (error) return traduzirErro(error)
  return { ok: true }
}

/**
 * Um único UPDATE; o trigger do banco exige o motivo junto com a etapa
 * perdida. A etapa "perdida" é buscada no MESMO funil da negociação — cada
 * funil tem a sua própria (`etapas_funil_tipo_final_unico` garante uma só
 * por funil); sem esse filtro, `.single()` encontra mais de uma linha assim
 * que existe mais de um funil no sistema, e a chamada falha.
 */
export async function marcarPerdida(p: PerdaInput): Promise<ResultadoFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data: negociacao, error: erroNegociacao } = await supabase
    .from('negociacoes')
    .select('funil_id')
    .eq('id', p.negociacao_id)
    .maybeSingle()
  if (erroNegociacao) return traduzirErro(erroNegociacao)
  if (!negociacao) return NAO_ENCONTRADA

  const { data: perdida, error: erroEtapa } = await supabase
    .from('etapas_funil')
    .select('id')
    .eq('funil_id', negociacao.funil_id)
    .eq('tipo', 'perdida')
    .single()
  if (erroEtapa) return traduzirErro(erroEtapa)

  const { data, error } = await supabase
    .from('negociacoes')
    .update({ etapa_id: perdida.id, motivo_perda: p.motivo_perda, posicao: p.posicao })
    .eq('id', p.negociacao_id)
    .select('id')
    .maybeSingle()

  if (error) return traduzirErro(error)
  return data ? { ok: true } : NAO_ENCONTRADA
}

export type ResultadoCriarNegociacao = { ok: true; id: string } | { ok: false; mensagem: string }

/**
 * Nova entrada do Kanban: negociação nova pra um cliente já existente
 * (`criar_negociacao`). Nunca cria cliente; entra na primeira etapa aberta
 * do funil escolhido; o responsável é sempre o dono do cliente.
 */
export async function criarNegociacao(input: NovaNegociacaoInput): Promise<ResultadoCriarNegociacao> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('criar_negociacao', {
    p_cliente_id: input.cliente_id,
    p_funil_id: input.funil_id,
    p_valor_estimado: input.valor_estimado === null ? undefined : Number(input.valor_estimado),
    p_temperatura: input.temperatura ?? undefined,
  })

  if (error) return traduzirErroNovaNegociacao(error)
  return { ok: true, id: data }
}

function traduzirErroNovaNegociacao(error: PostgrestError): Extract<ResultadoCriarNegociacao, { ok: false }> {
  if (error.code === 'P0002') return { ok: false, mensagem: error.message }
  if (error.code === '23514') return { ok: false, mensagem: error.message }
  if (error.code === '42501') {
    return { ok: false, mensagem: 'Você não tem permissão para criar uma negociação para esse cliente.' }
  }

  console.error('Erro ao criar negociação', error)
  return { ok: false, mensagem: 'Não foi possível criar a negociação. Tente novamente.' }
}

function traduzirErro(error: PostgrestError): ResultadoFunil {
  switch (error.code) {
    case 'P0002':
      return NAO_ENCONTRADA
    case '42501':
      return { ok: false, mensagem: 'Você não tem permissão para mover esta negociação.' }
    case '23514':
      // Constraints e triggers de regra de negócio (fechamento, motivo, datas).
      return { ok: false, mensagem: 'Os dados não atendem às regras da negociação.' }
  }

  console.error('Erro no funil', error)
  return { ok: false, mensagem: 'Não foi possível mover a negociação. Tente novamente.' }
}
