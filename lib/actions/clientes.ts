'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { atualizarCliente, criarCliente } from '@/lib/dal/clientes'
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
