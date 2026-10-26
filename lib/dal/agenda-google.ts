import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'

/**
 * Integração com o Google Calendar (Agenda 2.0, Fase A): conexão OAuth e
 * diagnóstico das cores. Tudo que fala com o Google passa pela Edge Function
 * `agenda-google`; o Next nunca vê client secret nem token.
 */

export type ConexaoGoogle = {
  contaEmail: string
  calendarId: string
  conectadoEm: string
  conectadoPor: string | null
  ultimoErro: string | null
  ultimoErroEm: string | null
}

export type CorDiagnostico = {
  /** `null` = evento sem cor própria (herda a cor da agenda). */
  colorId: string | null
  nome: string
  hex: string | null
  eventos: number
  diaInteiro: number
  primeiro: string | null
  ultimo: string | null
  exemplos: string[]
}

export type Diagnostico = {
  conta: string
  periodo: { inicio: string; fim: string; diasPassado: number; diasFuturo: number }
  total: number
  /** Mais eventos do que o teto de leitura: os números são parciais. */
  truncado: boolean
  ignoradosPorTipo: Record<string, number>
  cores: CorDiagnostico[]
}

type Falha = { ok: false; codigo: string; mensagem: string }
export type Resultado<T> = ({ ok: true } & T) | Falha

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente administradores gerenciam a agenda Google.')
}

async function chamarFuncao<T>(corpo: Record<string, unknown>): Promise<Resultado<T>> {
  const supabase = await createClient()
  const { data, error } = await supabase.functions.invoke<Resultado<T>>('agenda-google', { body: corpo })

  if (!error) return data ?? { ok: false, codigo: 'vazio', mensagem: 'Resposta vazia do servidor.' }

  if (error instanceof FunctionsHttpError) {
    try {
      return (await error.context.json()) as Falha
    } catch {
      // cai no erro genérico abaixo
    }
  }
  console.error('agenda-google', error)
  return { ok: false, codigo: 'indisponivel', mensagem: 'Não foi possível falar com o serviço da agenda Google.' }
}

/** Estado da conexão (RLS: só gerente lê). `null` quando não há conta conectada. */
export async function obterConexaoGoogle(): Promise<ConexaoGoogle | null> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agenda_google_conexao')
    .select('conta_email, calendar_id, conectado_em, conectado_por, ultimo_erro, ultimo_erro_em')
    .maybeSingle()

  if (error) throw new Error('Não foi possível carregar a conexão com o Google.', { cause: error })
  if (!data) return null

  const nomes = await nomesDeUsuarios(data.conectado_por ? [data.conectado_por] : [])
  return {
    contaEmail: data.conta_email,
    calendarId: data.calendar_id,
    conectadoEm: data.conectado_em,
    conectadoPor: data.conectado_por ? (nomes.get(data.conectado_por) ?? null) : null,
    ultimoErro: data.ultimo_erro,
    ultimoErroEm: data.ultimo_erro_em,
  }
}

/** Link de consentimento do Google. `retorno` é a página do CRM para voltar. */
export async function iniciarConexaoGoogle(retorno: string): Promise<Resultado<{ url: string }>> {
  await exigirGerente()
  return chamarFuncao<{ url: string }>({ acao: 'iniciar', retorno })
}

/** Só lê o Google: agrupa os eventos da janela por cor. Nada é gravado. */
export async function diagnosticarCoresGoogle(
  diasPassado: number,
  diasFuturo: number,
): Promise<Resultado<Diagnostico>> {
  await exigirGerente()
  return chamarFuncao<Diagnostico>({ acao: 'diagnostico', dias_passado: diasPassado, dias_futuro: diasFuturo })
}

export async function desconectarGoogle(): Promise<Resultado<object>> {
  await exigirGerente()
  return chamarFuncao<object>({ acao: 'desconectar' })
}
