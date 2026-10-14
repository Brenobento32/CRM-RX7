'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { entrarComSenha, redefinirSenha, sair, solicitarRecuperacaoSenha } from '@/lib/dal/auth'
import { caminhoInternoSeguro } from '@/lib/utils/redirect'
import { esqueciSenhaSchema, loginSchema, redefinirSenhaSchema } from '@/lib/validations/auth'

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

export type EstadoEsqueciSenha = {
  erro?: string
  sucesso?: string
  campos?: { email?: string[] }
  email?: string
}

/** Mensagem SEMPRE genérica — ver `solicitarRecuperacaoSenha` (nunca revela se o e-mail existe). */
export async function esqueciSenha(
  _estadoAnterior: EstadoEsqueciSenha | undefined,
  formData: FormData,
): Promise<EstadoEsqueciSenha> {
  const emailDigitado = String(formData.get('email') ?? '')
  const parsed = esqueciSenhaSchema.safeParse({ email: formData.get('email') })

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error)
    return { campos: fieldErrors, email: emailDigitado }
  }

  const resultado = await solicitarRecuperacaoSenha(parsed.data.email)
  return resultado.ok
    ? { sucesso: resultado.mensagem, email: emailDigitado }
    : { erro: resultado.mensagem, email: emailDigitado }
}

export type EstadoRedefinirSenha = {
  erro?: string
  campos?: { senha?: string[]; confirmar_senha?: string[] }
}

/**
 * Exige a sessão de recuperação já trocada pelo Route Handler de callback
 * (`app/auth/callback/route.ts`) — `redefinirSenha` falha sem ela. Depois de
 * trocar a senha com sucesso, a sessão de recuperação é encerrada e a pessoa
 * volta para `/login` pra entrar normalmente com a senha nova.
 */
export async function redefinirSenhaAction(
  _estadoAnterior: EstadoRedefinirSenha | undefined,
  formData: FormData,
): Promise<EstadoRedefinirSenha> {
  const parsed = redefinirSenhaSchema.safeParse({
    senha: formData.get('senha'),
    confirmar_senha: formData.get('confirmar_senha'),
  })

  if (!parsed.success) {
    return { campos: z.flattenError(parsed.error).fieldErrors }
  }

  const resultado = await redefinirSenha(parsed.data.senha)
  if (!resultado.ok) return { erro: resultado.mensagem }

  await sair()
  redirect('/login?senha_redefinida=1')
}
