import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { subDays } from 'date-fns'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { calcularDataChegada, DIAS_PARADO, sdrPodeMoverPara, tipoExigeModal } from '@/lib/utils/etapas'
import type { AtualizarFechamentoInput, FechamentoInput, PerdaInput } from '@/lib/validations/funil'
import type { NovaNegociacaoInput } from '@/lib/validations/funis'

type Enums = Database['public']['Enums']

/** Quantos dias um card em etapa ganha/perdida continua visível no quadro. */
export const DIAS_VISIVEIS_ENCERRADOS = 30

/**
 * Atribuição de campanha (Meta Ads/UTM) — chaves canônicas, não os headers
 * reais de nenhuma planilha específica (ver comentário em
 * 20261008120000_negociacoes_atribuicao.sql). Todas opcionais: a fonte
 * manda o que tiver.
 *
 * `gclid`/`fbclid`/`pontuacao`/`data_formulario`/`respondent_id`/`form_id`/
 * `form_name` vêm da integração direta com o Respondi (ver
 * `CHAVES_ATRIBUICAO` em supabase/functions/ingestao-lead/index.ts) — já
 * gravados em `negociacoes.atribuicao` desde essa integração, só não
 * tipados aqui ainda.
 */
export type AtribuicaoCampanha = {
  source?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  adset_id?: string | null
  adset_name?: string | null
  ad_id?: string | null
  ad_name?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  gclid?: string | null
  fbclid?: string | null
  pontuacao?: string | null
  data_formulario?: string | null
  respondent_id?: string | null
  form_id?: string | null
  form_name?: string | null
}

export type CardFunil = {
  id: string
  etapaId: string
  etapaTipo: Enums['tipo_etapa']
  posicao: number
  clienteId: string
  clienteNome: string
  clienteEmpresa: string | null
  valorEstimado: number | null
  /** Só não nulo na etapa ganha (vem de `fechamentos.valor_vendido`). */
  valorVendido: number | null
  /** Serviços já vinculados (`negociacao_servicos`) — nunca `null`, `[]` quando não há nenhum. */
  servicoIds: string[]
  temperatura: Enums['temperatura_negociacao'] | null
  responsavel: string | null
  clienteTelefone: string | null
  nichoId: string | null
  nichoNome: string | null
  nichoCor: Enums['cor_etapa'] | null
  origem: Enums['origem_negociacao']
  formularioId: string | null
  formularioNome: string | null
  funilNome: string | null
  atribuicao: AtribuicaoCampanha | null
  /** Milissegundos desde a entrada na etapa atual (`data_entrada_etapa`), calculados no servidor (sem divergir na hidratação). */
  msNaEtapa: number
  /** Etapa aberta e há mais de DIAS_PARADO dias nela — mesma regra de `funil_metricas`. */
  parado: boolean
  /** `data` é AAAA-MM-DD (dia, sem hora). */
  proximaAcao: { titulo: string; data: string } | null
  ultimaAtividade: { tipo: Enums['tipo_atividade']; data: string; descricao: string } | null
  /**
   * Chegada real do lead (ISO) — `atribuicao.data_formulario` quando válida,
   * senão `negociacoes.created_at` (ver `calcularDataChegada`). Nunca exibida
   * no card; só usada para ordenar a etapa inicial do funil por chegada em
   * vez de `posicao` (um lead importado hoje não deve parecer recém-chegado).
   */
  dataChegada: string
}

type LinhaFunilCards = Database['public']['Views']['funil_cards']['Row']

/**
 * Uma linha de `funil_cards` → `CardFunil`, compartilhado por
 * `listarCardsFunil` (Kanban) e `listarLeadsAtivos` (/funil/leads) — mesma
 * view, mesma forma, dois filtros diferentes por cima.
 *
 * Colunas de view vêm todas como anuláveis nos tipos gerados; as que são
 * NOT NULL nas tabelas de origem nunca chegam nulas — por isso o `flatMap`
 * defensivo em vez de assumir.
 */
function paraCardFunil(r: LinhaFunilCards, agora: number, criadoEm: Map<string, string>): CardFunil[] {
  if (!r.id || !r.etapa_id || !r.etapa_tipo || !r.cliente_id || !r.cliente_nome || r.posicao === null || !r.data_entrada_etapa) {
    return []
  }

  const atribuicao = (r.atribuicao as AtribuicaoCampanha | null) ?? null
  // Fallback final defensivo (r.data_entrada_etapa): só entraria em jogo se
  // a consulta em lote abaixo não trouxesse o id por algum motivo — nunca
  // deveria faltar, já que os ids vêm da mesma linha.
  const criadoEmLead = criadoEm.get(r.id) ?? r.data_entrada_etapa
  const msNaEtapa = agora - new Date(r.data_entrada_etapa).getTime()

  return [
    {
      id: r.id,
      etapaId: r.etapa_id,
      etapaTipo: r.etapa_tipo,
      posicao: r.posicao,
      clienteId: r.cliente_id,
      clienteNome: r.cliente_nome,
      clienteEmpresa: r.cliente_empresa,
      valorEstimado: r.valor_estimado,
      valorVendido: r.valor_vendido,
      // Coalesce defensivo: a view já garante array, nunca null, mas o
      // gerador de tipos marca toda coluna de view como anulável.
      servicoIds: r.servico_ids ?? [],
      temperatura: r.temperatura,
      responsavel: r.responsavel_nome,
      clienteTelefone: r.cliente_telefone,
      nichoId: r.nicho_id,
      nichoNome: r.nicho_nome,
      nichoCor: r.nicho_cor,
      origem: r.origem ?? 'manual',
      formularioId: r.formulario_id,
      formularioNome: r.formulario_nome,
      funilNome: r.funil_nome,
      atribuicao,
      dataChegada: calcularDataChegada(atribuicao?.data_formulario, criadoEmLead),
      msNaEtapa,
      parado: r.etapa_tipo === 'aberta' && msNaEtapa > DIAS_PARADO * 86_400_000,
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

  const criadoEm = await buscarCriadoEm(supabase, data)
  return data.flatMap((r) => paraCardFunil(r, agora, criadoEm))
}

/**
 * `negociacoes.created_at` de todos os cards, numa consulta só (nunca uma
 * por card) — fallback de `dataChegada` quando não há `data_formulario`.
 */
async function buscarCriadoEm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  linhas: LinhaFunilCards[],
): Promise<Map<string, string>> {
  const ids = linhas.flatMap((r) => (r.id ? [r.id] : []))
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('negociacoes').select('id, created_at').in('id', ids)
  if (error) throw new Error('Não foi possível carregar o funil.', { cause: error })

  return new Map(data.map((n) => [n.id, n.created_at]))
}

/**
 * Leads ativos pra /funil/leads — tabela plana (não o Kanban), uma consulta
 * só, filtrada opcionalmente por funil (nunca N consultas por linha).
 * "Ativo" aqui é etapa tipo `aberta`: fechado (ganho) ou perdido não é mais
 * um "lead" nesse sentido, mesmo sem estar arquivado.
 */
export async function listarLeadsAtivos(funilId?: string | null): Promise<CardFunil[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  let query = supabase
    .from('funil_cards')
    .select('*')
    .eq('etapa_tipo', 'aberta')
    .order('data_entrada_etapa', { ascending: false })

  if (funilId) query = query.eq('funil_id', funilId)

  const { data, error } = await query
  if (error) throw new Error('Não foi possível carregar os leads.', { cause: error })

  const agora = Date.now()
  const criadoEm = await buscarCriadoEm(supabase, data)
  return data.flatMap((r) => paraCardFunil(r, agora, criadoEm))
}

export type ResultadoFunil = { ok: true } | { ok: false; mensagem: string }

const NAO_ENCONTRADA: ResultadoFunil = {
  ok: false,
  mensagem: 'Negociação não encontrada ou sem permissão para movê-la.',
}

/**
 * "SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve
 * assumir este lead." — regra comercial (item 4). A trava de verdade é o
 * trigger `negociacoes_valida_handoff_sdr` no banco (backstop contra chamada
 * direta na API do Supabase, fora da Server Action); esta checagem só evita
 * a viagem ao banco e devolve a MESMA mensagem de forma amigável.
 */
const MSG_HANDOFF_SDR = 'SDR não pode movimentar o lead após Reunião realizada. O CLOSER deve assumir este lead.'

/**
 * Para quem é SDR: confere se mover para `ordemDestino` (na etapa `funilId`)
 * é permitido a partir da ordem atual da negociação. Nunca olha o NOME da
 * etapa — só `ordem`/`chave` de `etapas_funil`, mesma função pura usada no
 * Kanban (`sdrPodeMoverPara`, lib/utils/etapas.ts) e no trigger do banco.
 */
async function verificarHandoffSdr(
  supabase: Awaited<ReturnType<typeof createClient>>,
  negociacaoId: string,
  funilId: string,
  ordemDestino: number,
): Promise<ResultadoFunil> {
  const { data: negociacao, error: erroNegociacao } = await supabase
    .from('negociacoes')
    .select('etapa:etapas_funil!negociacoes_etapa_id_fkey(ordem)')
    .eq('id', negociacaoId)
    .maybeSingle()
  if (erroNegociacao) return traduzirErro(erroNegociacao)
  if (!negociacao) return NAO_ENCONTRADA

  const { data: limite, error: erroLimite } = await supabase
    .from('etapas_funil')
    .select('ordem')
    .eq('funil_id', funilId)
    .eq('chave', 'reuniao_realizada')
    .maybeSingle()
  if (erroLimite) return traduzirErro(erroLimite)

  const ordemLimite = limite ? Number(limite.ordem) : null
  const ordemOrigem = Number(negociacao.etapa.ordem)

  return sdrPodeMoverPara(ordemOrigem, ordemDestino, ordemLimite)
    ? { ok: true }
    : { ok: false, mensagem: MSG_HANDOFF_SDR }
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
 * SDR: antes de qualquer UPDATE, confere o handoff (`verificarHandoffSdr`).
 * Gerente e closer nunca passam por essa checagem.
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
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data: etapa, error: erroEtapa } = await supabase
    .from('etapas_funil')
    .select('tipo, ativo, ordem, funil_id')
    .eq('id', etapaId)
    .maybeSingle()
  if (erroEtapa) return traduzirErro(erroEtapa)
  if (!etapa || !etapa.ativo) return { ok: false, mensagem: 'Etapa não encontrada ou desativada.' }

  if (usuario.role === 'sdr') {
    const handoff = await verificarHandoffSdr(supabase, id, etapa.funil_id, Number(etapa.ordem))
    if (!handoff.ok) return handoff
  }

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
    p_servico_ids: f.servico_ids,
    p_observacoes: f.observacoes ?? undefined,
    p_tipo_venda: f.tipo_venda,
  })

  if (error) return traduzirErro(error)
  return { ok: true }
}

/**
 * Edita um fechamento já existente (`public.atualizar_fechamento`) — nunca
 * toca `negociacoes` (etapa_id, posicao) nem `fechamentos.fechado_em`/
 * `fechado_por`: preserva histórico e atribuição de meta/comissão. Só
 * atualiza a linha de `fechamentos` que já existe (sem upsert) e sincroniza
 * `negociacao_servicos`.
 */
export async function atualizarFechamento(f: AtualizarFechamentoInput): Promise<ResultadoFunil> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase.rpc('atualizar_fechamento', {
    p_negociacao_id: f.negociacao_id,
    p_valor_vendido: Number(f.valor_vendido),
    p_data_fechamento: f.data_fechamento,
    p_contrato_enviado: f.contrato_enviado,
    p_contrato_assinado: f.contrato_assinado,
    p_link_contrato: f.link_contrato ?? undefined,
    p_status_pagamento: f.status_pagamento,
    p_status_onboarding: f.status_onboarding,
    p_servico_ids: f.servico_ids,
    p_observacoes: f.observacoes ?? undefined,
    p_tipo_venda: f.tipo_venda ?? undefined,
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
      // Backstop do trigger `negociacoes_valida_handoff_sdr` — mesma mensagem
      // exata que a checagem em TypeScript já deveria ter devolvido antes de
      // chegar aqui; só sobra pra quem for direto na API, ignorando a Server Action.
      return error.message.includes('CLOSER deve assumir')
        ? { ok: false, mensagem: error.message }
        : { ok: false, mensagem: 'Você não tem permissão para mover esta negociação.' }
    case '23514':
      // Constraints e triggers de regra de negócio (fechamento, motivo, datas).
      return { ok: false, mensagem: 'Os dados não atendem às regras da negociação.' }
  }

  console.error('Erro no funil', error)
  return { ok: false, mensagem: 'Não foi possível mover a negociação. Tente novamente.' }
}
