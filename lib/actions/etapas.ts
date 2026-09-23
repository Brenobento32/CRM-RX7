'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  criarEtapa,
  definirAtivoEtapa,
  editarEtapa,
  excluirEtapa,
  moverEtapa,
  type ResultadoEtapa,
} from '@/lib/dal/etapas'
import { criarEtapaSchema, direcaoSchema, editarEtapaSchema } from '@/lib/validations/etapa'

export type EstadoFormEtapa = {
  erro?: string
  campos?: { nome?: string[]; cor?: string[] }
  valores?: { nome?: string; cor?: string }
}

const uuid = z.uuid()
const LISTA = '/configuracoes/etapas'

/** Nome, cor e ordem das etapas aparecem no funil, no dashboard e nas fichas. */
function revalidar() {
  revalidatePath('/', 'layout')
}

function comoEstado(r: Extract<ResultadoEtapa, { ok: false }>, valores: EstadoFormEtapa['valores']) {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
}

export async function criarEtapaAction(
  _estado: EstadoFormEtapa | undefined,
  formData: FormData,
): Promise<EstadoFormEtapa> {
  const valores = { nome: String(formData.get('nome') ?? ''), cor: String(formData.get('cor') ?? '') }
  const parsed = criarEtapaSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarEtapa(parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar()
  redirect(LISTA)
}

export async function editarEtapaAction(
  id: string,
  _estado: EstadoFormEtapa | undefined,
  formData: FormData,
): Promise<EstadoFormEtapa> {
  const nome = formData.get('nome')
  const valores = {
    nome: typeof nome === 'string' ? nome : undefined,
    cor: String(formData.get('cor') ?? ''),
  }
  if (!uuid.safeParse(id).success) return { erro: 'Etapa inválida.', valores }

  const parsed = editarEtapaSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await editarEtapa(id, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar()
  redirect(LISTA)
}

/**
 * Ações da lista (subir, descer, ativar, excluir). Falha volta para a lista
 * com a mensagem na URL, para os botões funcionarem sem JavaScript.
 */
async function concluir(r: ResultadoEtapa) {
  revalidar()
  if (!r.ok) redirect(`${LISTA}?erro=${encodeURIComponent(r.mensagem)}`)
}

export async function moverEtapaAction(id: string, direcao: string): Promise<void> {
  const d = direcaoSchema.safeParse(direcao)
  if (!uuid.safeParse(id).success || !d.success) return
  await concluir(await moverEtapa(id, d.data))
}

export async function definirAtivoEtapaAction(id: string, ativo: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(await definirAtivoEtapa(id, ativo))
}

export async function excluirEtapaAction(id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(await excluirEtapa(id))
}
