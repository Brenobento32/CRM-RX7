'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { entrarComSenha, sair } from '@/lib/dal/auth'
import { caminhoInternoSeguro } from '@/lib/utils/redirect'
import { loginSchema } from '@/lib/validations/auth'

export type EstadoLogin = {
  erro?: string
  campos?: { email?: string[]; senha?: string[] }
  email?: string
}

export async function login(
  _estadoAnterior: EstadoLogin | undefined,
  formData: FormData,
): Promise<EstadoLogin> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  })

  const emailDigitado = String(formData.get('email') ?? '')

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error)
    return { campos: fieldErrors, email: emailDigitado }
  }

  const resultado = await entrarComSenha(parsed.data.email, parsed.data.senha)

  if (!resultado.ok) {
    return { erro: resultado.mensagem, email: emailDigitado }
  }

  // `redirect` lança internamente, então fica fora de qualquer try/catch.
  redirect(caminhoInternoSeguro(formData.get('next')))
}

export async function logout() {
  await sair()
  redirect('/login')
}
