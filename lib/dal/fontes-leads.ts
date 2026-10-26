import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { publicEnv } from '@/lib/env/public'
import type { StatusFonte, TipoFonte } from '@/lib/integracoes/catalogo'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types/database'

/**
 * Fontes de leads da empresa da requisição (T14).
 *
 * Leitura: gerente da empresa (RLS). Escrita: só admin_empresa (o banco
 * confere em cada RPC). Tokens aparecem uma vez (criação/rotação); tokens de
 * provedor vão direto para o Vault e nunca voltam para a tela.
 */

export type Fonte = {
  id: string
  tipo: TipoFonte
  nome: string
  status: StatusFonte
  funilId: string
  etapaId: string
  responsavelId: string
  configuracao: Record<string, unknown>
  tokenPrefixo: string | null
  validadaEm: string | null
  ultimoLeadEm: string | null
  ultimoErro: string | null
  ultimoErroEm: string | null
  createdAt: string
}

export type EventoIngestao = {
  id: number
  externalId: string | null
  resultado: string
  erroCodigo: string | null
  erroMensagem: string | null
  recebidoEm: string
  negociacaoId: string | null
}

export type OpcoesFonte = {
  funis: { id: string; nome: string; etapas: { id: string; nome: string; inicial: boolean }[] }[]
}

export type Resultado = { ok: true; id?: string; token?: string | null } | { ok: false; mensagem: string }

const COLUNAS =
  'id, tipo, nome, status, funil_id, etapa_id, responsavel_id, configuracao, token_prefixo, validada_em, ultimo_lead_em, ultimo_erro, ultimo_erro_em, created_at'

type Linha = {
  id: string; tipo: TipoFonte; nome: string; status: StatusFonte; funil_id: string; etapa_id: string
  responsavel_id: string; configuracao: Json; token_prefixo: string | null; validada_em: string | null
  ultimo_lead_em: string | null; ultimo_erro: string | null; ultimo_erro_em: string | null; created_at: string
}

function paraFonte(l: Linha): Fonte {
  return {
    id: l.id,
    tipo: l.tipo,
    nome: l.nome,
    status: l.status,
    funilId: l.funil_id,
    etapaId: l.etapa_id,
    responsavelId: l.responsavel_id,
    configuracao: l.configuracao && typeof l.configuracao === 'object' && !Array.isArray(l.configuracao) ? l.configuracao : {},
    tokenPrefixo: l.token_prefixo,
    validadaEm: l.validada_em,
    ultimoLeadEm: l.ultimo_lead_em,
    ultimoErro: l.ultimo_erro,
    ultimoErroEm: l.ultimo_erro_em,
    createdAt: l.created_at,
  }
}

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente administradores veem as integrações.')
}

export async function podeGerirFontes(): Promise<boolean> {
  const empresa = await getEmpresaAtual()
  return empresa.papel === 'admin_empresa' && !empresa.somenteLeitura
}

/**
 * Trava no servidor antes do banco (que também recusa): só o administrador
 * da empresa, fora do modo somente leitura, altera integrações e credenciais.
 */
async function recusaSemPermissao(): Promise<Resultado | null> {
  if (await podeGerirFontes()) return null
  return { ok: false, mensagem: 'Somente o administrador da empresa altera integrações e credenciais.' }
}

function falha(error: { code?: string; message?: string } | null, padrao: string): Resultado {
  switch (error?.code) {
    case '42501':
      return { ok: false, mensagem: 'Somente o administrador da empresa gerencia as fontes de leads.' }
    case 'RX002':
      return { ok: false, mensagem: 'O plano da empresa atingiu o limite de integrações.' }
    case 'RX003':
      return { ok: false, mensagem: 'O plano da empresa não inclui esta fonte.' }
    case '23505':
      return { ok: false, mensagem: 'Esta página ou número já está conectado a outra fonte.' }
    case '23503':
      return { ok: false, mensagem: 'Funil, etapa ou responsável inválido para esta empresa.' }
    case '23514':
    case '22023':
    case 'P0002':
      // Mensagens dessas regras são escritas para o usuário.
      return { ok: false, mensagem: error.message ?? padrao }
  }
  console.error('fontes de leads', error?.code)
  return { ok: false, mensagem: padrao }
}

export async function listarFontes(): Promise<Fonte[]> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('fontes_leads').select(COLUNAS).order('created_at', { ascending: false })
  if (error) throw new Error('Não foi possível carregar as fontes de leads.', { cause: error })
  return (data as Linha[]).map(paraFonte)
}

export async function obterFonte(id: string): Promise<Fonte | null> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase.from('fontes_leads').select(COLUNAS).eq('id', id).maybeSingle()
  if (error) throw new Error('Não foi possível carregar a fonte.', { cause: error })
  return data ? paraFonte(data as Linha) : null
}

export async function listarEventos(fonteId: string, limite = 30): Promise<EventoIngestao[]> {
  await exigirGerente()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ingestao_eventos')
    .select('id, external_id, resultado, erro_codigo, erro_mensagem, recebido_em, negociacao_id')
    .eq('fonte_id', fonteId)
    .order('recebido_em', { ascending: false })
    .limit(limite)
  if (error) throw new Error('Não foi possível carregar os recebimentos.', { cause: error })
  return data.map((e) => ({
    id: e.id,
    externalId: e.external_id,
    resultado: e.resultado,
    erroCodigo: e.erro_codigo,
    erroMensagem: e.erro_mensagem,
    recebidoEm: e.recebido_em,
    negociacaoId: e.negociacao_id,
  }))
}

/** Funis ativos e etapas abertas ativas da empresa (destino dos leads). */
export async function opcoesDeDestino(): Promise<OpcoesFonte> {
  await exigirGerente()
  const supabase = await createClient()
  const [{ data: funis, error: e1 }, { data: etapas, error: e2 }] = await Promise.all([
    supabase.from('funis').select('id, nome, padrao, ordem').eq('ativo', true).order('ordem'),
    supabase.from('etapas_funil').select('id, nome, funil_id, ordem, etapa_inicial').eq('tipo', 'aberta').eq('ativo', true).order('ordem'),
  ])
  if (e1 || e2) throw new Error('Não foi possível carregar os funis.', { cause: e1 ?? e2 })
  return {
    funis: funis.map((f) => ({
      id: f.id,
      nome: f.nome,
      etapas: etapas.filter((e) => e.funil_id === f.id).map((e) => ({ id: e.id, nome: e.nome, inicial: e.etapa_inicial })),
    })),
  }
}

export type DadosFonte = {
  nome: string
  funilId: string
  etapaId: string
  responsavelId: string
  configuracao: Record<string, unknown>
}

export async function criarFonte(tipo: TipoFonte, dados: DadosFonte): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('criar_fonte_lead', {
    p_tipo: tipo,
    p_nome: dados.nome,
    p_funil: dados.funilId,
    p_etapa: dados.etapaId,
    p_responsavel: dados.responsavelId,
    p_configuracao: dados.configuracao as Json,
  })
  if (error || !data?.[0]) return falha(error, 'Não foi possível criar a fonte.')
  return { ok: true, id: data[0].id, token: data[0].token }
}

export async function atualizarFonte(id: string, dados: DadosFonte): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { error } = await supabase.rpc('atualizar_fonte_lead', {
    p_id: id,
    p_nome: dados.nome,
    p_funil: dados.funilId,
    p_etapa: dados.etapaId,
    p_responsavel: dados.responsavelId,
    p_configuracao: dados.configuracao as Json,
  })
  return error ? falha(error, 'Não foi possível salvar a fonte.') : { ok: true, id }
}

export async function alterarStatusFonte(id: string, status: 'ativa' | 'pausada'): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { error } = await supabase.rpc('definir_status_fonte', { p_id: id, p_status: status })
  return error ? falha(error, 'Não foi possível alterar a fonte.') : { ok: true, id }
}

export async function revogarFonte(id: string): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { error } = await supabase.rpc('revogar_fonte_lead', { p_id: id })
  return error ? falha(error, 'Não foi possível revogar a fonte.') : { ok: true, id }
}

export async function girarToken(id: string): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('girar_token_fonte', { p_id: id })
  return error || !data ? falha(error, 'Não foi possível gerar um novo token.') : { ok: true, id, token: data }
}

export async function definirSegredoProvedor(id: string, segredo: string): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { error } = await supabase.rpc('definir_segredo_fonte', { p_id: id, p_segredo: segredo })
  return error ? falha(error, 'Não foi possível salvar o token do provedor.') : { ok: true, id }
}

/** Validação real com a Meta (Edge Function `meta-webhooks/validar`). */
export async function validarComProvedor(id: string): Promise<Resultado> {
  const recusa = await recusaSemPermissao()
  if (recusa) return recusa
  const supabase = await createClient()
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; mensagem?: string }>('meta-webhooks/validar', {
    body: { fonte_id: id },
  })
  if (!error && data?.ok) return { ok: true, id }
  if (error instanceof FunctionsHttpError) {
    try {
      const corpo = (await error.context.json()) as { mensagem?: string }
      return { ok: false, mensagem: corpo.mensagem ?? 'A validação falhou.' }
    } catch {
      // cai no genérico
    }
  }
  return { ok: false, mensagem: 'Não foi possível falar com o serviço de validação.' }
}

/** Endereços para configurar no provedor (sem segredos). */
export function enderecosIntegracao() {
  const base = publicEnv.supabaseUrl.replace(/\/+$/, '')
  return {
    webhook: `${base}/functions/v1/ingestao-lead-empresa`,
    meta: `${base}/functions/v1/meta-webhooks`,
  }
}
