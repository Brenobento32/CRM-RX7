'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  alterarStatusFonte,
  atualizarFonte,
  criarFonte,
  definirSegredoProvedor,
  girarToken,
  revogarFonte,
  validarComProvedor,
  type DadosFonte,
} from '@/lib/dal/fontes-leads'
import { TIPOS_FONTE, TIPOS_FONTE_MANUAIS, type TipoFonte } from '@/lib/integracoes/catalogo'

/**
 * Ações das fontes de leads. O banco decide a permissão (admin_empresa da
 * empresa da aba) e valida funil/etapa/responsável; aqui só lemos o formulário.
 * Tokens voltam só no retorno da ação (nunca na URL nem em log).
 */

const LISTA = '/configuracoes/integracoes'
const uuid = z.uuid()

function texto(formData: FormData, campo: string): string {
  const v = formData.get(campo)
  return typeof v === 'string' ? v.trim() : ''
}

function voltar(id: string | null, chave: 'ok' | 'erro', mensagem: string): never {
  revalidatePath(LISTA, 'layout')
  redirect(`${id ? `${LISTA}/${id}` : LISTA}?${chave}=${encodeURIComponent(mensagem)}`)
}

/** Configuração própria de cada tipo (só identificadores públicos; nada de segredo). */
function configuracaoDoFormulario(tipo: TipoFonte, formData: FormData): Record<string, unknown> {
  if (tipo === 'meta_lead_ads') {
    return { page_id: texto(formData, 'page_id'), ...(texto(formData, 'form_id') ? { form_id: texto(formData, 'form_id') } : {}) }
  }
  if (tipo === 'whatsapp_cloud') return { phone_number_id: texto(formData, 'phone_number_id') }
  if (tipo === 'respondi') {
    const campos: Record<string, string> = {}
    for (const c of ['nome', 'telefone', 'email', 'empresa']) {
      const v = texto(formData, `campo_${c}`)
      if (v) campos[c] = v.slice(0, 300)
    }
    return Object.keys(campos).length ? { campos } : {}
  }
  return {}
}

function dadosDoFormulario(tipo: TipoFonte, formData: FormData): DadosFonte | string {
  const nome = texto(formData, 'nome')
  if (nome.length < 2 || nome.length > 80) return 'Dê um nome à fonte (2 a 80 caracteres).'
  const destino = texto(formData, 'destino') // "<funil>|<etapa>"
  const [funilId, etapaId] = destino.split('|')
  const responsavelId = texto(formData, 'responsavel_id')
  if (!uuid.safeParse(funilId).success || !uuid.safeParse(etapaId).success) return 'Escolha o funil e a etapa de entrada.'
  if (!uuid.safeParse(responsavelId).success) return 'Escolha o responsável pelos leads.'
  return { nome, funilId, etapaId, responsavelId, configuracao: configuracaoDoFormulario(tipo, formData) }
}

export type EstadoToken = { erro?: string; token?: string | null; id?: string }

export async function criarFonteAction(_anterior: EstadoToken, formData: FormData): Promise<EstadoToken> {
  const tipo = texto(formData, 'tipo') as TipoFonte
  // Google Sheets e WhatsApp oficial só pela conexão oficial (credencial no servidor).
  if (!TIPOS_FONTE_MANUAIS.includes(tipo)) return { erro: 'Escolha o tipo de fonte.' }
  const dados = dadosDoFormulario(tipo, formData)
  if (typeof dados === 'string') return { erro: dados }

  const r = await criarFonte(tipo, dados)
  revalidatePath(LISTA, 'layout')
  return r.ok ? { id: r.id, token: r.token ?? null } : { erro: r.mensagem }
}

export async function salvarFonteAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'id'))
  if (!id.success) redirect(LISTA)
  const tipo = texto(formData, 'tipo') as TipoFonte
  if (!TIPOS_FONTE.includes(tipo)) voltar(id.data, 'erro', 'Tipo inválido.')
  const dados = dadosDoFormulario(tipo, formData)
  if (typeof dados === 'string') voltar(id.data, 'erro', dados)
  const r = await atualizarFonte(id.data, dados)
  voltar(id.data, r.ok ? 'ok' : 'erro', r.ok ? 'Fonte salva.' : r.mensagem)
}

export async function statusFonteAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'id'))
  if (!id.success) redirect(LISTA)
  const status = texto(formData, 'status') === 'pausada' ? 'pausada' : 'ativa'
  const r = await alterarStatusFonte(id.data, status)
  voltar(id.data, r.ok ? 'ok' : 'erro', r.ok ? (status === 'ativa' ? 'Fonte ativada.' : 'Fonte pausada.') : r.mensagem)
}

export async function revogarFonteAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'id'))
  if (!id.success) redirect(LISTA)
  const r = await revogarFonte(id.data)
  voltar(id.data, r.ok ? 'ok' : 'erro', r.ok ? 'Fonte revogada: não recebe mais leads.' : r.mensagem)
}

export async function girarTokenAction(_anterior: EstadoToken, formData: FormData): Promise<EstadoToken> {
  const id = uuid.safeParse(texto(formData, 'id'))
  if (!id.success) return { erro: 'Fonte inválida.' }
  const r = await girarToken(id.data)
  revalidatePath(LISTA, 'layout')
  return r.ok ? { token: r.token ?? null, id: id.data } : { erro: r.mensagem }
}

export async function segredoFonteAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'id'))
  if (!id.success) redirect(LISTA)
  const segredo = formData.get('segredo')
  if (typeof segredo !== 'string' || segredo.trim().length < 20) voltar(id.data, 'erro', 'Cole o token completo do provedor.')
  const r = await definirSegredoProvedor(id.data, segredo)
  voltar(id.data, r.ok ? 'ok' : 'erro', r.ok ? 'Token guardado no cofre. Agora valide com o provedor.' : r.mensagem)
}

export async function validarFonteAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'id'))
  if (!id.success) redirect(LISTA)
  const r = await validarComProvedor(id.data)
  voltar(id.data, r.ok ? 'ok' : 'erro', r.ok ? 'Fonte validada com o provedor.' : r.mensagem)
}
