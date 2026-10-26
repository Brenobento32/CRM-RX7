'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { destinoAdminSeguro, destinoClienteSeguro, entradaDoPortal } from '@/lib/auth/portal'
import {
  entrarComSenha,
  entrarComoSuperAdmin,
  redefinirSenha,
  sair,
  situacaoDaSessaoAtual,
  solicitarRecuperacaoSenha,
} from '@/lib/dal/auth'
import { esqueciSenhaSchema, loginSchema, redefinirSenhaSchema } from '@/lib/validations/auth'

export type EstadoLogin = {
  erro?: string
  campos?: { email?: string[]; senha?: string[] }
  email?: string
}

function lerLogin(formData: FormData) {
  return loginSchema.safeParse({ email: formData.get('email'), senha: formData.get('senha') })
}

/**
 * Portal dos clientes (`/login`), só para os cargos das empresas. Destino: o
 * `next` interno validado ou a empresa do usuário (o proxy completa `/` com a
 * empresa); nunca o painel administrativo. Super Admin é recusado em
 * `entrarComSenha` (privilégio lido do banco) e entra só por `/admin`.
 */
export async function login(_estadoAnterior: EstadoLogin | undefined, formData: FormData): Promise<EstadoLogin> {
  const parsed = lerLogin(formData)
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
  redirect(destinoClienteSeguro(formData.get('next')))
}

/**
 * Portal da administração (`/admin`). Só segue quem o banco confirma como
 * Super Admin; os demais recebem a mesma resposta de senha errada.
 */
export async function loginAdmin(_estadoAnterior: EstadoLogin | undefined, formData: FormData): Promise<EstadoLogin> {
  const parsed = lerLogin(formData)
  const emailDigitado = String(formData.get('email') ?? '')

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error)
    return { campos: fieldErrors, email: emailDigitado }
  }

  const resultado = await entrarComoSuperAdmin(parsed.data.email, parsed.data.senha)
  if (!resultado.ok) {
    return { erro: resultado.mensagem, email: emailDigitado }
  }

  redirect(destinoAdminSeguro(formData.get('next')))
}

/**
 * Sair (menu do usuário, inclusive dentro do CRM): cada um volta à entrada do
 * seu portal — Super Admin (conferido no banco) para `/admin`, os demais para
 * `/login`.
 */
export async function logout() {
  const situacao = await situacaoDaSessaoAtual()
  await sair()
  redirect(entradaDoPortal(situacao?.superAdmin ? 'admin' : 'clientes'))
}

/** Sair da administração: volta para o login administrativo em `/admin`. */
export async function logoutAdmin() {
  await sair()
  redirect('/admin')
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
 * volta à entrada do seu portal para entrar com a senha nova. O portal vem
 * do banco, com a própria sessão de recuperação: Super Admin → `/admin`; os
 * demais → `/login`. Funciona igual com o link aberto em outro navegador
 * (não depende de cookie, nem de por qual tela a recuperação foi pedida).
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

  const situacao = await situacaoDaSessaoAtual()
  await sair()
  redirect(`${entradaDoPortal(situacao?.superAdmin ? 'admin' : 'clientes')}?senha_redefinida=1`)
}
