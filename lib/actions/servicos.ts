'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  criarServico,
  definirAtivoServico,
  editarServico,
  excluirServico,
  type ResultadoServico,
} from '@/lib/dal/servicos'
import { servicoSchema, type CampoServico } from '@/lib/validations/servico'

export type EstadoFormServico = {
  erro?: string
  campos?: Partial<Record<CampoServico, string[]>>
  valores?: Partial<Record<CampoServico, string>>
}

const uuid = z.uuid()
const LISTA = '/configuracoes/servicos'

/** O catálogo aparece na configuração e nos formulários de negociação. */
function revalidar() {
  revalidatePath('/', 'layout')
}

function lerValores(formData: FormData) {
  return {
    nome: String(formData.get('nome') ?? ''),
    categoria: String(formData.get('categoria') ?? ''),
  }
}

function comoEstado(r: Extract<ResultadoServico, { ok: false }>, valores: EstadoFormServico['valores']) {
  return r.campo ? { campos: { [r.campo]: [r.mensagem] }, valores } : { erro: r.mensagem, valores }
}

export async function criarServicoAction(
  _estado: EstadoFormServico | undefined,
  formData: FormData,
): Promise<EstadoFormServico> {
  const valores = lerValores(formData)
  const parsed = servicoSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await criarServico(parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar()
  redirect(LISTA)
}

export async function editarServicoAction(
  id: string,
  _estado: EstadoFormServico | undefined,
  formData: FormData,
): Promise<EstadoFormServico> {
  const valores = lerValores(formData)
  if (!uuid.safeParse(id).success) return { erro: 'Serviço inválido.', valores }

  const parsed = servicoSchema.safeParse(valores)
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors, valores }

  const r = await editarServico(id, parsed.data)
  if (!r.ok) return comoEstado(r, valores)

  revalidar()
  redirect(LISTA)
}

/**
 * Ações da lista (ativar, desativar, excluir). Falha volta para a lista com
 * a mensagem na URL, para os botões funcionarem sem JavaScript.
 */
async function concluir(r: ResultadoServico) {
  revalidar()
  if (!r.ok) redirect(`${LISTA}?erro=${encodeURIComponent(r.mensagem)}`)
}

export async function definirAtivoServicoAction(id: string, ativo: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(await definirAtivoServico(id, ativo))
}

export async function excluirServicoAction(id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return
  await concluir(await excluirServico(id))
}
