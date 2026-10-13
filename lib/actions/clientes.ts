'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  arquivarCliente,
  atualizarCliente,
  criarCliente,
  excluirCliente,
  obterCliente,
  restaurarCliente,
  restaurarClienteExcluido,
  type ClienteDetalhe,
} from '@/lib/dal/clientes'
import {
  CAMPOS_CLIENTE,
  clienteSchema,
  type CampoCliente,
} from '@/lib/validations/cliente'

export type EstadoFormCliente = {
  erro?: string
  campos?: Partial<Record<CampoCliente, string[]>>
  valores?: Partial<Record<CampoCliente, string>>
}

function lerFormulario(formData: FormData) {
  const valores: Partial<Record<CampoCliente, string>> = {}
  for (const campo of CAMPOS_CLIENTE) {
    const valor = formData.get(campo)
    valores[campo] = typeof valor === 'string' ? valor : ''
  }
  return valores
}

export async function criarClienteAction(
  _estado: EstadoFormCliente | undefined,
  formData: FormData,
): Promise<EstadoFormCliente> {
  const valores = lerFormulario(formData)
  const parsed = clienteSchema.safeParse(valores)

  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors, valores }
  }

  const resultado = await criarCliente(parsed.data)

  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidatePath('/clientes')
  redirect(`/clientes/${resultado.id}`)
}

export async function atualizarClienteAction(
  id: string,
  _estado: EstadoFormCliente | undefined,
  formData: FormData,
): Promise<EstadoFormCliente> {
  const valores = lerFormulario(formData)

  if (!z.uuid().safeParse(id).success) {
    return { erro: 'Cliente inválido.', valores }
  }

  const parsed = clienteSchema.safeParse(valores)

  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors, valores }
  }

  const resultado = await atualizarCliente(id, parsed.data)

  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidatePath('/clientes')
  revalidatePath(`/clientes/${id}`)
  redirect(`/clientes/${id}`)
}

/** Dados do cliente pro modal de ficha no Kanban — mesma DAL da página de edição, chamável do client. */
export async function obterClienteParaFichaAction(id: string): Promise<ClienteDetalhe | null> {
  if (!z.uuid().safeParse(id).success) return null
  return obterCliente(id)
}

export type EstadoFichaCliente = EstadoFormCliente & { ok?: boolean }

/**
 * Variante "rápida" de `atualizarClienteAction` para o modal de ficha do
 * Kanban: mesma validação e DAL, mas sem `redirect()` — devolve `ok: true` e
 * o próprio `ClienteForm` fecha o modal (via `onSucesso`). O Kanban por trás
 * não precisa recarregar nada: a ficha não altera nicho/etapa/temperatura.
 */
export async function atualizarClienteRapidoAction(
  id: string,
  _estado: EstadoFichaCliente | undefined,
  formData: FormData,
): Promise<EstadoFichaCliente> {
  const valores = lerFormulario(formData)

  if (!z.uuid().safeParse(id).success) {
    return { erro: 'Cliente inválido.', valores }
  }

  const parsed = clienteSchema.safeParse(valores)
  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors, valores }
  }

  const resultado = await atualizarCliente(id, parsed.data)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidatePath('/funil')
  revalidatePath(`/clientes/${id}`)
  return { ok: true, valores }
}

export type EstadoArquivarCliente = { erro?: string }

// Sem campos a ler: o `id` já vem amarrado (bind), e a assinatura de dois
// argumentos existe só porque `useActionState` exige esse formato.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function arquivarClienteAction(
  id: string,
  _estado: EstadoArquivarCliente | undefined,
  _formData: FormData,
): Promise<EstadoArquivarCliente> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  if (!z.uuid().safeParse(id).success) {
    return { erro: 'Cliente inválido.' }
  }

  const resultado = await arquivarCliente(id)
  if (!resultado.ok) {
    return { erro: resultado.mensagem }
  }

  revalidatePath('/clientes')
  revalidatePath(`/clientes/${id}`)
  redirect('/clientes')
}

/** Usada num botão de formulário na aba Arquivados: sem estado pra ler, só revalida a lista. */
export async function restaurarClienteAction(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return

  const resultado = await restaurarCliente(id)
  if (!resultado.ok) {
    console.warn('Restaurar cliente:', resultado.mensagem)
    return
  }

  revalidatePath('/clientes')
}

/** Botão "Excluir" na aba Arquivados — nunca DELETE físico, ver `excluirCliente`. Motivo é obrigatório. */
export async function excluirClienteAction(id: string, formData: FormData): Promise<void> {
  if (!z.uuid().safeParse(id).success) return

  const motivo = String(formData.get('motivo') ?? '')
  const resultado = await excluirCliente(id, motivo)
  if (!resultado.ok) {
    console.warn('Excluir cliente:', resultado.mensagem)
    return
  }

  revalidatePath('/clientes')
}

/** Botão "Restaurar" na aba Excluídos — volta pra Arquivado, não pra Ativo. */
export async function restaurarClienteExcluidoAction(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return

  const resultado = await restaurarClienteExcluido(id)
  if (!resultado.ok) {
    console.warn('Restaurar cliente excluído:', resultado.mensagem)
    return
  }

  revalidatePath('/clientes')
}
