'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { arquivarCliente, atualizarCliente, criarCliente, restaurarCliente } from '@/lib/dal/clientes'
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
