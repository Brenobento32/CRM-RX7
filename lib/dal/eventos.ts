import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { subDays } from 'date-fns'
import { cache } from 'react'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import type { EtapaFunil } from '@/lib/utils/etapas'
import { hojeSaoPaulo, instanteSaoPaulo, somarDias } from '@/lib/utils/formatacao'
import type {
  CampoEvento,
  EventoInput,
  StatusEvento,
  TipoEvento,
} from '@/lib/validations/evento'

export type Evento = {
  id: string
  titulo: string
  descricao: string | null
  tipo: TipoEvento
  status: StatusEvento
  inicio: string
  fim: string
  clienteId: string
  clienteNome: string | null
  clienteEmpresa: string | null
  negociacaoId: string | null
  etapa: EtapaFunil | null
  usuarioId: string
  usuario: string | null
}

export type OpcaoCliente = {
  id: string
  nome: string
  empresa: string | null
  negociacoes: { id: string; etapa: EtapaFunil; created_at: string }[]
}

/** Quantos dias para trás a lista "aguardando status" olha. */
export const DIAS_AGUARDANDO_STATUS = 30
const LIMITE_LISTA = 50

const COLUNAS = `id, titulo, descricao, tipo, status, inicio, fim, cliente_id,
  negociacao_id, usuario_id,
  cliente:clientes!eventos_cliente_id_fkey(nome, empresa),
  negociacao:negociacoes!eventos_negociacao_id_fkey(etapa)`

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
  cliente_id: string
  negociacao_id: string | null
  usuario_id: string
  cliente: { nome: string; empresa: string | null } | null
  negociacao: { etapa: EtapaFunil } | null
}

async function mapear(linhas: Linha[]): Promise<Evento[]> {
  const nomes = await nomesDeUsuarios(linhas.map((l) => l.usuario_id))
  return linhas.map((l) => ({
    id: l.id,
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
  }))
}

function falha(error: PostgrestError): never {
  throw new Error('Não foi possível carregar a agenda.', { cause: error })
}

/** Todos os eventos do dia (AAAA-MM-DD, em São Paulo), qualquer status. */
export async function listarEventosDoDia(dia: string, usuarioId?: string): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await consultaBase(supabase, usuarioId)
    .gte('inicio', instanteSaoPaulo(dia).toISOString())
    .lt('inicio', instanteSaoPaulo(somarDias(dia, 1)).toISOString())
    .order('inicio')

  if (error) falha(error)
  return mapear(data)
}

/** Eventos agendados a partir de amanhã. */
export async function listarProximosEventos(usuarioId?: string): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await consultaBase(supabase, usuarioId)
    .eq('status', 'agendado')
    .gte('inicio', instanteSaoPaulo(somarDias(hojeSaoPaulo(), 1)).toISOString())
    .order('inicio')
    .limit(LIMITE_LISTA)

  if (error) falha(error)
  return mapear(data)
}

/**
 * Eventos que já terminaram e continuam "agendado": ninguém marcou se
 * aconteceram. Ficam em destaque até receberem um status.
 */
export async function listarAguardandoStatus(usuarioId?: string): Promise<Evento[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const agora = new Date()
  const { data, error } = await consultaBase(supabase, usuarioId)
    .eq('status', 'agendado')
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
    .eq('status', 'agendado')
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
    .select('id, nome, empresa, negociacoes(id, etapa, created_at)')
    .is('deleted_at', null)
    .order('nome')
    .limit(1000)

  if (error) falha(error)
  return data
}

export type ResultadoEvento =
  | { ok: true; id: string }
  | { ok: false; mensagem: string; campo?: CampoEvento }

/**
 * Closer agenda sempre para si. Gerente pode agendar para outra pessoa; se a
 * pessoa não enxergar o cliente, o evento aparece na agenda dela sem o nome.
 */
function responsavel(usuario: { id: string; role: string }, pedido: string | null) {
  return usuario.role === 'gerente' && pedido ? pedido : usuario.id
}

export async function criarEvento(input: EventoInput): Promise<ResultadoEvento> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('eventos')
    .insert({
      cliente_id: input.cliente_id,
      negociacao_id: input.negociacao_id,
      usuario_id: responsavel(usuario, input.usuario_id),
      tipo: input.tipo,
      titulo: input.titulo,
      descricao: input.descricao,
      inicio: input.inicio,
      fim: input.fim,
    })
    .select('id')
    .single()

  if (error) return traduzirErro(error)
  return { ok: true, id: data.id }
}

export async function atualizarEvento(id: string, input: EventoInput): Promise<ResultadoEvento> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { usuario_id, ...campos } = input
  const alteracoes =
    usuario.role === 'gerente' && usuario_id ? { ...campos, usuario_id } : campos

  const { data, error } = await supabase
    .from('eventos')
    .update(alteracoes)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return traduzirErro(error)
  return data ? { ok: true, id: data.id } : { ok: false, mensagem: 'Evento não encontrado.' }
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

function traduzirErro(error: PostgrestError): ResultadoEvento {
  switch (error.code) {
    case 'P0002':
      return { ok: false, mensagem: 'Evento não encontrado.' }
    case '42501':
      return { ok: false, mensagem: 'Você não tem permissão para este cliente ou evento.' }
    case '23514':
      if (error.message.includes('negociação')) {
        return {
          ok: false,
          campo: 'negociacao_id',
          mensagem: 'A negociação escolhida não é deste cliente.',
        }
      }
      return { ok: false, campo: 'hora_fim', mensagem: 'O término precisa ser depois do início.' }
    case '23503':
      return { ok: false, mensagem: 'Cliente, negociação ou responsável não encontrado.' }
  }

  console.error('Erro na agenda', error)
  return { ok: false, mensagem: 'Não foi possível salvar o evento. Tente novamente.' }
}
