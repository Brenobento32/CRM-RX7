'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  criarEtapa,
  definirAtivoEtapa,
  definirEtapaInicial,
  editarEtapa,
  excluirEtapa,
  moverEtapa,
  type ResultadoEtapa,
} from '@/lib/dal/etapas'
import { criarEtapaSchema, direcaoSchema, editarEtapaSchema } from '@/lib/validations/etapa'

export type EstadoFormEtapa = {
  erro?: string
  campos?: { nome?: string[]; cor?: string[]; posFechamento?: string[]; participaConversao?: string[] }
  valores?: { nome?: string; cor?: string; posFechamento?: string; participaConversao?: boolean }
}

const uuid = z.uuid()

/** Nome, cor e ordem das etapas aparecem no funil, no dashboard e nas fichas. */
function revalidar() {
  revalidatePath('/', 'layout')
}

function comoEstado(r: Extract<ResultadoEtapa, { ok: false }>, valores: EstadoFormEtapa['valores']) {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
}

export async function criarEtapaAction(
  funilId: string,
  _estado: EstadoFormEtapa | undefined,
  formData: FormData,
): Promise<EstadoFormEtapa> {
  const valoresForm = {
    nome: String(formData.get('nome') ?? ''),
    cor: String(formData.get('cor') ?? ''),
    posFechamento: String(formData.get('posFechamento') ?? 'pipeline'),
    participaConversao: formData.get('participaConversao') === 'on' ? 'on' : '',
  }
  const parsed = criarEtapaSchema.safeParse(valoresForm)
  const valores = { ...valoresForm, participaConversao: parsed.data?.participaConversao }
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarEtapa(funilId, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar()
  redirect(`/configuracoes/funis/${funilId}`)
}

export async function editarEtapaAction(
  funilId: string,
  id: string,
  _estado: EstadoFormEtapa | undefined,
  formData: FormData,
): Promise<EstadoFormEtapa> {
  const nome = formData.get('nome')
  const valoresForm = {
    nome: typeof nome === 'string' ? nome : undefined,
    cor: String(formData.get('cor') ?? ''),
    participaConversao: formData.get('participaConversao') === 'on' ? 'on' : '',
  }
  const parsed = editarEtapaSchema.safeParse(valoresForm)
  const valores = { ...valoresForm, participaConversao: parsed.data?.participaConversao }
  if (!uuid.safeParse(id).success) return { erro: 'Etapa inválida.', valores }
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await editarEtapa(id, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar()
  redirect(`/configuracoes/funis/${funilId}`)
}

/**
 * Ações da lista (subir, descer, ativar, excluir). Falha volta para a lista
 * do próprio funil com a mensagem na URL, para os botões funcionarem sem
 * JavaScript.
 */
async function concluir(funilId: string, r: ResultadoEtapa) {
  revalidar()
  if (!r.ok) redirect(`/configuracoes/funis/${funilId}?erro=${encodeURIComponent(r.mensagem)}`)
}

export async function moverEtapaAction(funilId: string, id: string, direcao: string): Promise<void> {
  const d = direcaoSchema.safeParse(direcao)
  if (!uuid.safeParse(id).success || !d.success) return
  await concluir(funilId, await moverEtapa(funilId, id, d.data))
}

export async function definirAtivoEtapaAction(funilId: string, id: string, ativo: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(funilId, await definirAtivoEtapa(id, ativo))
}

export async function excluirEtapaAction(funilId: string, id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(funilId, await excluirEtapa(id))
}

export async function definirEtapaInicialAction(funilId: string, id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(funilId, await definirEtapaInicial(id))
}
