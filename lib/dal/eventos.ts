import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { subDays } from 'date-fns'
import { cache } from 'react'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual, membrosDaEmpresa } from '@/lib/dal/empresa'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import type { CorEtapa, EtapaVisual } from '@/lib/utils/etapas'
import { diaEmSaoPaulo, hojeSaoPaulo, instanteSaoPaulo, somarDias } from '@/lib/utils/formatacao'
import type { Database } from '@/lib/types/database'
import { CARGOS_QUE_AGENDAM_PARA_CLOSER, type Cargo } from '@/lib/validations/usuario'
import type { RegraRecorrencia } from '@/lib/utils/recorrencia'
import {
  STATUS_EM_ABERTO,
  type CampoEvento,
  type Escopo,
  type EventoForm,
  type StatusEvento,
  type TipoEvento,
} from '@/lib/validations/evento'

export type Evento = {
  id: string
  /** Quem criou (pode ser o SDR/Atendente que agendou para o Closer). */
  criadoPor: string | null
  criadoPorNome: string | null
  titulo: string
  descricao: string | null
  tipo: TipoEvento
  status: StatusEvento
  inicio: string
  fim: string
  /** Nulo em reunião sem cliente (agenda nativa). */
  clienteId: string | null
  clienteNome: string | null
  clienteEmpresa: string | null
  negociacaoId: string | null
  etapa: EtapaVisual | null
  usuarioId: string
  usuario: string | null
  /** Cor do responsável na agenda; `null` sem cor definida. */
  usuarioCor: CorEtapa | null
  /** Evento de uma série recorrente. */
  serieId: string | null
}

export type OpcaoCliente = {
  id: string
  nome: string
  empresa: string | null
  /** Dono da carteira: o único closer que pode ser responsável pelo evento. */
  ownerId: string
  negociacoes: { id: string; etapa: EtapaVisual; created_at: string }[]
}

/** Quantos dias para trás a lista "aguardando status" olha. */
export const DIAS_AGUARDANDO_STATUS = 30
const LIMITE_LISTA = 50
/** Teto de eventos de uma janela da Agenda 2.0 (dia/semana/mês). */
const LIMITE_PERIODO = 500

const COLUNAS = `id, titulo, descricao, tipo, status, inicio, fim, cliente_id,
  negociacao_id, usuario_id, serie_id, criado_por,
  cliente:clientes!eventos_cliente_id_fkey(nome, empresa),
  negociacao:negociacoes!eventos_negociacao_id_fkey(etapa:etapas_funil!negociacoes_etapa_id_fkey(nome, cor))`

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Consulta base. Não há filtro por dono: a RLS de eventos devolve ao closer
 * só os próprios eventos e ao gerente todos. `usuarioId` é o filtro opcional
 * da tela, usado pelo gerente para ver a agenda de uma pessoa.
 */
function consultaBase(supabase: Supabase, usuarioId?: string) {
  const query = supabase.from('eventos').select(COLUNAS)
  return usuarioId ? query.eq('usuario_id', usuarioId) : query
}

type Linha = {
  id: string
  titulo: string
  descricao: string | null
  tipo: TipoEvento
  status: StatusEvento
  inicio: string
  fim: string
  cliente_id: string | null
  negociacao_id: string | null
  usuario_id: string
  serie_id: string | null
  criado_por: string | null
  cliente: { nome: string; empresa: string | null } | null
  negociacao: { etapa: EtapaVisual } | null
}

/**
 * Cor na agenda de cada responsável. A RLS de profiles basta: o closer só vê
 * os próprios eventos (e o próprio perfil); o gerente vê todos.
 */
async function coresDeUsuarios(ids: string[]): Promise<Map<string, CorEtapa | null>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()
  const supabase = await createClient()
  const { data, error } = await supabase.from('profiles').select('id, cor_agenda').in('id', unicos)
  if (error) throw new Error('Não foi possível carregar as cores da agenda.', { cause: error })
  return new Map(data.map((p) => [p.id, p.cor_agenda]))
}

async function mapear(linhas: Linha[]): Promise<Evento[]> {
  const ids = linhas.map((l) => l.usuario_id)
  const criadores = linhas.flatMap((l) => (l.criado_por && l.criado_por !== l.usuario_id ? [l.criado_por] : []))
  const [nomes, cores] = await Promise.all([nomesDeUsuarios([...ids, ...criadores]), coresDeUsuarios(ids)])

  return linhas.map((l) => {
    // `nomes` vem de `nomes_de_usuarios`, SECURITY DEFINER — ignora a RLS de
    // propósito. `cores` lê `profiles` direto, sujeita à RLS. Se a linha do
    // responsável não voltou (chave ausente do Map, não apenas nula), a causa
    // provável é RLS bloqueando esse leitor para esse perfil — vale investigar
    // antes de assumir que a cor simplesmente não foi configurada.
    if (!cores.has(l.usuario_id)) {
      console.warn(
        `Evento ${l.id}: profiles.cor_agenda de ${l.usuario_id} não voltou na consulta ` +
          '(RLS bloqueando este leitor para esse perfil?). Nome resolveu normalmente via RPC.',
      )
    }

    return {
      id: l.id,
      criadoPor: l.criado_por,
      criadoPorNome: l.criado_por ? (nomes.get(l.criado_por) ?? null) : null,
      titulo: l.titulo,
      descricao: l.descricao,
      tipo: l.tipo,
      status: l.status,
      inicio: l.inicio,
      fim: l.fim,
      clienteId: l.cliente_id,
      // Nulo se o cliente saiu da carteira de quem vê o evento.
      clienteNome: l.cliente?.nome ?? null,
      clienteEmpresa: l.cliente?.empresa ?? null,
      negociacaoId: l.negociacao_id,
      etapa: l.negociacao?.etapa ?? null,
      usuarioId: l.usuario_id,
      usuario: nomes.get(l.usuario_id) ?? null,
      usuarioCor: cores.get(l.usuario_id) ?? null,
      serieId: l.serie_id,
    }
  })
}

function falha(error: PostgrestError): never {
  throw new Error('Não foi possível carregar a agenda.', { cause: error })
}

/**
 * Eventos entre `inicioDia` e `fimDia` (ambos AAAA-MM-DD, em São Paulo,
 * `fimDia` incluído), qualquer status. Base das visões da Agenda 2.0 — cada
 * uma só pede a própria janela (1/7/14/~42 dias).
 */
export async function listarEventosNoPeriodo(
  inicioDia: string,
  fimDia: string,
  usuarioId?: string,
): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await consultaBase(supabase, usuarioId)
    .gte('inicio', instanteSaoPaulo(inicioDia).toISOString())
    .lt('inicio', instanteSaoPaulo(somarDias(fimDia, 1)).toISOString())
    .order('inicio')
    .limit(LIMITE_PERIODO)

  if (error) falha(error)
  return mapear(data)
}

/** Todos os eventos do dia (AAAA-MM-DD, em São Paulo), qualquer status. */
export async function listarEventosDoDia(dia: string, usuarioId?: string): Promise<Evento[]> {
  return listarEventosNoPeriodo(dia, dia, usuarioId)
}

/**
 * Em que dias (AAAA-MM-DD, em São Paulo) há pelo menos um evento, dentro do
 * período — usado pelo mini calendário para marcar os dias com compromisso
 * sem carregar os eventos inteiros.
 */
export async function contarEventosPorDia(
  inicioDia: string,
  fimDia: string,
  usuarioId?: string,
): Promise<Set<string>> {
  await getUsuarioAtual()
  const supabase = await createClient()

  let query = supabase
    .from('eventos')
    .select('inicio')
    .gte('inicio', instanteSaoPaulo(inicioDia).toISOString())
    .lt('inicio', instanteSaoPaulo(somarDias(fimDia, 1)).toISOString())
  if (usuarioId) query = query.eq('usuario_id', usuarioId)

  const { data, error } = await query
  if (error) falha(error)
  return new Set(data.map((r) => diaEmSaoPaulo(r.inicio)))
}

/** Eventos em aberto (agendados ou confirmados) a partir de amanhã. */
export async function listarProximosEventos(usuarioId?: string): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await consultaBase(supabase, usuarioId)
    .in('status', STATUS_EM_ABERTO)
    .gte('inicio', instanteSaoPaulo(somarDias(hojeSaoPaulo(), 1)).toISOString())
    .order('inicio')
    .limit(LIMITE_LISTA)

  if (error) falha(error)
  return mapear(data)
}

/**
 * Eventos que já terminaram e continuam em aberto (agendado ou confirmado):
 * ninguém marcou se
 * aconteceram. Ficam em destaque até receberem um status.
 */
export async function listarAguardandoStatus(usuarioId?: string): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const agora = new Date()
  const { data, error } = await consultaBase(supabase, usuarioId)
    .in('status', STATUS_EM_ABERTO)
    .lt('fim', agora.toISOString())
    .gte('inicio', subDays(agora, DIAS_AGUARDANDO_STATUS).toISOString())
    .order('inicio')
    .limit(LIMITE_LISTA)

  if (error) falha(error)
  return mapear(data)
}

/** Próximos compromissos de um cliente, para a ficha. */
export async function listarEventosDoCliente(clienteId: string): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await consultaBase(supabase)
    .eq('cliente_id', clienteId)
    .in('status', STATUS_EM_ABERTO)
    .gte('inicio', new Date().toISOString())
    .order('inicio')
    .limit(10)

  if (error) falha(error)
  return mapear(data)
}

export const obterEvento = cache(async (id: string): Promise<Evento | null> => {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await consultaBase(supabase).eq('id', id).maybeSingle()

  if (error) falha(error)
  if (!data) return null
  const [evento] = await mapear([data])
  return evento
})

/**
 * Clientes (com negociações) que o usuário pode vincular a um evento. A RLS
 * limita o closer à própria carteira.
 */
export async function listarOpcoesClientes(): Promise<OpcaoCliente[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome, empresa, owner_id, negociacoes!negociacoes_cliente_id_tenant_fkey(id, created_at, etapa:etapas_funil!negociacoes_etapa_id_fkey(nome, cor))')
    .is('deleted_at', null)
    .order('nome')
    .limit(1000)

  if (error) falha(error)
  return data.map(({ owner_id, ...c }) => ({ ...c, ownerId: owner_id }))
}

export type ResultadoEvento =
  | { ok: true; id: string; quantidade?: number }
  | { ok: false; mensagem: string; campo?: CampoEvento }

export type ResponsavelAgenda = {
  id: string
  nome: string
  role: Cargo
  cor: CorEtapa | null
}

/**
 * Quem pode ser responsável por um evento (o banco confere de novo:
 * `agenda_pode_definir_responsavel` + `agenda_valida_responsavel`):
 * - Gerente: todos os usuários ativos da empresa (o formulário filtra pelo
 *   cliente: dono da carteira + gerentes);
 * - SDR e Atendente: ele mesmo e os Closers ATIVOS da mesma empresa;
 * - demais cargos: só ele mesmo.
 */
export async function listarResponsaveisAgenda(): Promise<ResponsavelAgenda[]> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  if (CARGOS_QUE_AGENDAM_PARA_CLOSER.includes(usuario.role)) {
    // Perfil de outra pessoa não é legível para SDR/Atendente (RLS): os nomes
    // vêm de `nomes_de_usuarios` e o vínculo de `membros_empresa_atual`.
    const membros = await membrosDaEmpresa()
    const ids = [...membros]
      .filter(([id, m]) => m.ativo && (id === usuario.id || m.role === 'closer'))
      .map(([id]) => id)
    const [nomes, meu] = await Promise.all([
      nomesDeUsuarios(ids),
      supabase.from('profiles').select('cor_agenda').eq('id', usuario.id).maybeSingle(),
    ])
    return ids
      .map((id) => ({
        id,
        nome: nomes.get(id) ?? 'Usuário',
        role: membros.get(id)!.role,
        cor: id === usuario.id ? (meu.data?.cor_agenda ?? null) : null,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }

  let query = supabase.from('profiles').select('id, nome, cor_agenda').eq('ativo', true).order('nome')
  if (usuario.role !== 'gerente') query = query.eq('id', usuario.id)

  const [{ data, error }, membros] = await Promise.all([query, membrosDaEmpresa()])
  if (error) throw new Error('Não foi possível carregar os responsáveis.', { cause: error })
  // Papel e vínculo na empresa da requisição (o perfil é global).
  return data.flatMap((p) => {
    const membro = membros.get(p.id)
    return membro?.ativo ? [{ id: p.id, nome: p.nome, role: membro.role, cor: p.cor_agenda }] : []
  })
}

export type SerieDoEvento = RegraRecorrencia & {
  id: string
  /** Quantas ocorrências a série tem (em qualquer status). */
  total: number
}

/** Regra da série de um evento, para o resumo somente leitura da edição. */
export async function obterSerie(serieId: string): Promise<SerieDoEvento | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const [serie, total] = await Promise.all([
    supabase
      .from('eventos_series')
      .select('id, data_inicio, frequencia, intervalo, dias_semana, dia_mes, termina_em, ocorrencias')
      .eq('id', serieId)
      .maybeSingle(),
    supabase.from('eventos').select('id', { count: 'exact', head: true }).eq('serie_id', serieId),
  ])

  if (serie.error) throw new Error('Não foi possível carregar a série.', { cause: serie.error })
  if (!serie.data) return null
  const s = serie.data
  return {
    id: s.id,
    dataInicio: s.data_inicio,
    frequencia: s.frequencia,
    intervalo: s.intervalo,
    diasSemana: s.dias_semana,
    diaMes: s.dia_mes,
    terminaEm: s.termina_em,
    ocorrencias: s.ocorrencias,
    total: total.count ?? 0,
  }
}

/**
 * Gerente escolhe qualquer pessoa; SDR/Atendente escolhem um Closer; os
 * demais são sempre o responsável. O banco valida a escolha em todos os casos.
 */
function responsavel(usuario: { id: string; role: Cargo }, pedido: string | null) {
  const escolhe = usuario.role === 'gerente' || CARGOS_QUE_AGENDAM_PARA_CLOSER.includes(usuario.role)
  return escolhe && pedido ? pedido : usuario.id
}

export type Ocupacao = { usuarioId: string; inicio: string; fim: string }

/**
 * Horários ocupados dos Closers da empresa (só início e fim — sem título,
 * cliente ou descrição), para o aviso de conflito de quem agenda para eles.
 * O banco só responde a Gerente, SDR e Atendente, e só da empresa da aba.
 */
export async function listarOcupacao(inicioDia: string, fimDia: string): Promise<Ocupacao[]> {
  await getUsuarioAtual()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('agenda_ocupacao', {
    p_inicio: instanteSaoPaulo(inicioDia).toISOString(),
    p_fim: instanteSaoPaulo(somarDias(fimDia, 1)).toISOString(),
  })
  if (error) throw new Error('Não foi possível carregar a disponibilidade.', { cause: error })
  return (data ?? []).map((o) => ({ usuarioId: o.usuario_id, inicio: o.inicio, fim: o.fim }))
}

type ArgsSerie = Database['public']['Functions']['criar_serie_eventos']['Args']
type ArgsAlterar = Database['public']['Functions']['alterar_eventos']['Args']

/**
 * Evento único: um INSERT com o status escolhido (agendado ou confirmado).
 * Série: `criar_serie_eventos` grava a regra e todas as ocorrências numa
 * transação. Devolve o id do (primeiro) evento e quantos foram criados.
 */
/** Super Admin em acesso global não é responsável de reunião: tem de escolher um usuário da empresa. */
async function exigeResponsavelDaEmpresa(pedido: string | null): Promise<ResultadoEvento | null> {
  const empresa = await getEmpresaAtual()
  return empresa.acessoGlobal && !pedido
    ? { ok: false, campo: 'usuario_id', mensagem: 'Escolha o responsável da reunião (um usuário ativo da empresa).' }
    : null
}

export async function criarEvento(form: EventoForm): Promise<ResultadoEvento> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()
  const e = form.evento
  const semResponsavel = await exigeResponsavelDaEmpresa(e.usuario_id)
  if (semResponsavel) return semResponsavel
  const usuarioId = responsavel(usuario, e.usuario_id)

  if (!form.serie) {
    const { data, error } = await supabase
      .from('eventos')
      .insert({
        cliente_id: e.cliente_id,
        negociacao_id: e.negociacao_id,
        usuario_id: usuarioId,
        tipo: e.tipo,
        status: e.status,
        titulo: e.titulo,
        descricao: e.descricao,
        inicio: e.inicio,
        fim: e.fim,
      })
      .select('id')
      .single()

    if (error) return traduzirErro(error)
    return { ok: true, id: data.id, quantidade: 1 }
  }

  // Parâmetros opcionais vão como NULL explícito (a função não tem defaults);
  // o gerador de tipos os declara não nulos, daí o cast.
  const args: { [K in keyof ArgsSerie]: ArgsSerie[K] | null } = {
    p_titulo: e.titulo,
    p_tipo: e.tipo,
    p_status: e.status,
    p_cliente_id: e.cliente_id,
    p_negociacao_id: e.negociacao_id,
    p_usuario_id: usuarioId,
    p_descricao: e.descricao,
    p_data_inicio: e.data,
    p_hora_inicio: e.hora_inicio,
    p_duracao_minutos: e.duracao_minutos,
    p_frequencia: form.serie.frequencia,
    p_intervalo: form.serie.intervalo,
    p_dias_semana: form.serie.dias_semana,
    p_dia_mes: form.serie.dia_mes,
    p_termina_em: form.serie.termina_em,
    p_ocorrencias: form.serie.ocorrencias,
  }

  const { data: primeiro, error } = await supabase.rpc('criar_serie_eventos', args as ArgsSerie)
  if (error) return traduzirErro(error)

  const { data: evento } = await supabase.from('eventos').select('serie_id').eq('id', primeiro).maybeSingle()
  const { count } = evento?.serie_id
    ? await supabase.from('eventos').select('id', { count: 'exact', head: true }).eq('serie_id', evento.serie_id)
    : { count: null }

  return { ok: true, id: primeiro, quantidade: count ?? undefined }
}

/**
 * Edita um evento ou parte da série (`alterar_eventos`): 'este' muda tudo,
 * inclusive a data; 'seguintes'/'todos' mantêm a data de cada ocorrência e
 * nunca reescrevem realizado, não compareceu ou cancelado. O status não muda
 * aqui — só pelos botões, que registram na timeline.
 */
export async function alterarEventos(id: string, form: EventoForm): Promise<ResultadoEvento> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()
  const e = form.evento
  const semResponsavel = await exigeResponsavelDaEmpresa(e.usuario_id)
  if (semResponsavel) return semResponsavel

  const args: { [K in keyof ArgsAlterar]: ArgsAlterar[K] | null } = {
    p_evento_id: id,
    p_escopo: form.escopo,
    p_titulo: e.titulo,
    p_tipo: e.tipo,
    p_cliente_id: e.cliente_id,
    p_negociacao_id: e.negociacao_id,
    p_usuario_id: responsavel(usuario, e.usuario_id),
    p_descricao: e.descricao,
    p_data: e.data,
    p_hora_inicio: e.hora_inicio,
    p_duracao_minutos: e.duracao_minutos,
  }

  const { data, error } = await supabase.rpc('alterar_eventos', args as ArgsAlterar)
  if (error) return traduzirErro(error)
  return { ok: true, id, quantidade: data }
}

/** Cancela (status) um evento ou parte da série. Só eventos em aberto. */
export async function cancelarEventos(id: string, escopo: Escopo): Promise<ResultadoEvento> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('cancelar_eventos', { p_evento_id: id, p_escopo: escopo })
  if (error) return traduzirErro(error)
  return { ok: true, id, quantidade: data }
}

/**
 * Exclui um evento único sem histórico (agendado ou confirmado). A policy de
 * DELETE garante o status; série não se exclui — cancela.
 */
export async function excluirEvento(id: string): Promise<ResultadoEvento> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('eventos')
    .delete()
    .eq('id', id)
    .is('serie_id', null)
    .select('id')
    .maybeSingle()

  if (error) return traduzirErro(error)
  return data
    ? { ok: true, id }
    : { ok: false, mensagem: 'Só compromissos agendados ou confirmados, fora de série, podem ser excluídos.' }
}

/** Via `public.alterar_status_evento`, que também registra na timeline. */
export async function alterarStatusEvento(
  id: string,
  status: StatusEvento,
): Promise<ResultadoEvento> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase.rpc('alterar_status_evento', {
    p_evento_id: id,
    p_status: status,
  })

  if (error) return traduzirErro(error)
  return { ok: true, id }
}

/**
 * Regras do banco (N1) → mensagem no campo certo. As constraints de
 * `eventos_series` vêm antes das de `eventos` porque os nomes se sobrepõem
 * (`…_intervalo_valido`).
 */
function traduzirErro(error: PostgrestError): Extract<ResultadoEvento, { ok: false }> {
  const m = error.message

  switch (error.code) {
    case 'P0002':
      return { ok: false, mensagem: 'Evento não encontrado.' }
    case '42501':
      return { ok: false, mensagem: 'Você não tem permissão para este cliente ou evento.' }
    case '23503':
      return { ok: false, mensagem: 'Cliente, negociação ou responsável não encontrado.' }
    case '22023':
      return { ok: false, campo: 'escopo', mensagem: 'Escolha a quais eventos aplicar.' }
    case '23514': {
      if (m.includes('responsável')) return { ok: false, campo: 'usuario_id', mensagem: m }
      if (m.includes('negociação')) {
        return { ok: false, campo: 'negociacao_id', mensagem: 'A negociação escolhida não é deste cliente.' }
      }
      if (m.includes('eventos_series_termino_ate_12_meses')) {
        return { ok: false, campo: 'termina_em', mensagem: 'A repetição pode durar no máximo 12 meses.' }
      }
      if (m.includes('eventos_series_ocorrencias_validas')) {
        return { ok: false, campo: 'ocorrencias', mensagem: 'Use de 1 a 200 ocorrências.' }
      }
      if (m.includes('eventos_series_semanal_exige_dias')) {
        return { ok: false, campo: 'dias_semana', mensagem: 'Escolha pelo menos um dia da semana.' }
      }
      if (m.includes('eventos_series_mensal_exige_dia')) {
        return { ok: false, campo: 'dia_mes', mensagem: 'Use um dia de 1 a 31.' }
      }
      if (m.includes('eventos_series_intervalo_valido')) {
        return { ok: false, campo: 'intervalo', mensagem: 'Use um intervalo de 1 a 99.' }
      }
      if (m.includes('eventos_series_termino_obrigatorio')) {
        return { ok: false, campo: 'termino', mensagem: 'Escolha como a repetição termina.' }
      }
      if (m.includes('nenhuma ocorrência')) {
        return { ok: false, campo: 'recorrencia', mensagem: 'Essa repetição não gera nenhum compromisso no período.' }
      }
      if (m.includes('eventos_intervalo_valido') || m.includes('Duração')) {
        return { ok: false, campo: 'hora_fim', mensagem: 'O término precisa ser depois do início.' }
      }
      // Mensagens escritas para o usuário pelas funções (cancelar, série).
      if (!m.includes('violates')) return { ok: false, mensagem: m }
      break
    }
  }

  console.error('Erro na agenda', error)
  return { ok: false, mensagem: 'Não foi possível salvar o evento. Tente novamente.' }
}
