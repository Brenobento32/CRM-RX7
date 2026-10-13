'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  criarNicho,
  definirAtivoNicho,
  editarNicho,
  moverNicho,
  type ResultadoNicho,
} from '@/lib/dal/nichos'
import { nichoSchema, type CampoNicho } from '@/lib/validations/nicho'

export type EstadoFormNicho = {
  ok?: boolean
  erro?: string
  campos?: Partial<Record<CampoNicho, string[]>>
}

const uuid = z.uuid()
const direcaoSchema = z.enum(['cima', 'baixo'])

/** Nicho decide a borda do card e aparece no seletor da ficha — em todo lugar do CRM. */
function revalidar() {
  revalidatePath('/', 'layout')
}

function lerValores(formData: FormData) {
  return {
    nome: String(formData.get('nome') ?? ''),
    cor: String(formData.get('cor') ?? ''),
    ativo: formData.get('ativo') ? 'on' : '',
  }
}

function comoEstado(r: Extract<ResultadoNicho, { ok: false }>): EstadoFormNicho {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] } } : { erro: r.mensagem }
}

export async function criarNichoAction(
  _estado: EstadoFormNicho | undefined,
  formData: FormData,
): Promise<EstadoFormNicho> {
  const parsed = nichoSchema.safeParse(lerValores(formData))
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors }

  const r = await criarNicho(parsed.data)
  if (!r.ok) return comoEstado(r)

  revalidar()
  return { ok: true }
}

export async function editarNichoAction(
  id: string,
  _estado: EstadoFormNicho | undefined,
  formData: FormData,
): Promise<EstadoFormNicho> {
  if (!uuid.safeParse(id).success) return { erro: 'Nicho inválido.' }

  const parsed = nichoSchema.safeParse(lerValores(formData))
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors }

  const r = await editarNicho(id, parsed.data)
  if (!r.ok) return comoEstado(r)

  revalidar()
  return { ok: true }
}

/** Ações da lista (mover, ativar/desativar) — plain `<form>`, funcionam sem JS. */
export async function moverNichoAction(id: string, direcao: string): Promise<void> {
  const d = direcaoSchema.safeParse(direcao)
  if (!uuid.safeParse(id).success || !d.success) return
  const r = await moverNicho(id, d.data)
  if (!r.ok) console.warn('Mover nicho:', r.mensagem)
  revalidar()
}

export async function definirAtivoNichoAction(id: string, ativo: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) return
  const r = await definirAtivoNicho(id, ativo)
  if (!r.ok) console.warn('Definir ativo do nicho:', r.mensagem)
  revalidar()
}
