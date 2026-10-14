'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { criarMeta, editarMeta, removerMeta, type ResultadoMeta } from '@/lib/dal/metas'
import { mesValido } from '@/lib/utils/periodo'
import { criarMetaSchema, editarMetaSchema, type CampoMeta } from '@/lib/validations/meta'

export type EstadoFormMeta = {
  erro?: string
  campos?: Partial<Record<CampoMeta, string[]>>
  valores?: Partial<Record<CampoMeta, string>>
}

const uuid = z.uuid()

/** Volta para a tela de metas no mês em que se estava. */
function lista(mes?: string) {
  return mesValido(mes) ? `/metas?mes=${mes}` : '/metas'
}

function comoEstado(r: Extract<ResultadoMeta, { ok: false }>, valores: EstadoFormMeta['valores']) {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
}

export async function criarMetaAction(
  _estado: EstadoFormMeta | undefined,
  formData: FormData,
): Promise<EstadoFormMeta> {
  const valores = {
    alvo: String(formData.get('alvo') ?? ''),
    tipo_meta: String(formData.get('tipo_meta') ?? ''),
    mes: String(formData.get('mes') ?? ''),
    valor_meta: String(formData.get('valor_meta') ?? ''),
  }
  const parsed = criarMetaSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarMeta(parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidatePath('/metas')
  redirect(lista(parsed.data.mes))
}

export async function editarMetaAction(
  id: string,
  mes: string,
  _estado: EstadoFormMeta | undefined,
  formData: FormData,
): Promise<EstadoFormMeta> {
  const valores = { valor_meta: String(formData.get('valor_meta') ?? '') }
  if (!uuid.safeParse(id).success) return { erro: 'Meta inválida.', valores }

  const parsed = editarMetaSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await editarMeta(id, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidatePath('/metas')
  redirect(lista(mes))
}

/** Botão da lista. Falha volta com a mensagem na URL (funciona sem JS). */
export async function removerMetaAction(id: string, mes: string): Promise<void> {
  if (!uuid.safeParse(id).success) return

  const r = await removerMeta(id)
  revalidatePath('/metas')
  if (!r.ok) {
    const destino = lista(mes)
    redirect(`${destino}${destino.includes('?') ? '&' : '?'}erro=${encodeURIComponent(r.mensagem)}`)
  }
}
