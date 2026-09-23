import 'server-only'

import { redirect } from 'next/navigation'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type UserRole = Database['public']['Enums']['user_role']

/** O que as telas precisam saber sobre quem está logado — nada além disso. */
export type UsuarioAtual = {
  id: string
  nome: string
  email: string
  role: UserRole
  fotoUrl: string | null
}

/**
 * Garante que existe uma sessão válida e devolve o id do usuário.
 *
 * O `proxy.ts` já redireciona quem não está logado, mas é só uma checagem
 * otimista: o proxy pode ficar fora do caminho (matcher, prefetch, Server
 * Action chamada direto). Toda leitura protegida passa por aqui.
 *
 * `cache` deduplica a chamada dentro de um mesmo request — layout e página
 * podem chamar à vontade sem repetir a validação do JWT.
 */
export const verifySession = cache(async () => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims?.sub) {
    redirect('/login')
  }

  return { userId: data.claims.sub }
})

/**
 * Lê o perfil (papel gerente / closer) do banco.
 *
 * O papel é sempre relido do Postgres, nunca tirado do JWT: se um gerente
 * rebaixar ou desativar alguém, a mudança vale no próximo request, e não só
 * quando o token expirar.
 *
 * Usuário sem profile ou desativado não entra na área interna.
 */
export const getUsuarioAtual = cache(async (): Promise<UsuarioAtual> => {
  const { userId } = await verifySession()
  const supabase = await createClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, nome, email, role, ativo, foto_url')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new Error('Não foi possível carregar o perfil do usuário.', {
      cause: error,
    })
  }

  if (!profile || !profile.ativo) {
    redirect('/sem-acesso')
  }

  return {
    id: profile.id,
    nome: profile.nome,
    email: profile.email,
    role: profile.role,
    fotoUrl: profile.foto_url,
  }
})

export type ResultadoLogin =
  | { ok: true }
  | { ok: false; mensagem: string }

/**
 * Autentica com e-mail e senha. Os cookies de sessão são gravados pelo
 * cliente de servidor, por isso deve ser chamada de uma Server Action.
 */
export async function entrarComSenha(
  email: string,
  senha: string,
): Promise<ResultadoLogin> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  })

  if (!error) return { ok: true }

  return { ok: false, mensagem: mensagemDeErroDeLogin(error.code, error.status) }
}

export async function sair() {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

/**
 * Traduz o erro do Supabase Auth para uma mensagem ao usuário.
 *
 * `invalid_credentials` cobre tanto e-mail inexistente quanto senha errada, e
 * isso é proposital: dizer qual dos dois falhou permitiria descobrir quais
 * e-mails têm conta no CRM.
 */
function mensagemDeErroDeLogin(code?: string, status?: number): string {
  switch (code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'email_not_confirmed':
      return 'Este e-mail ainda não foi confirmado.'
    case 'user_banned':
      return 'Este usuário está bloqueado. Fale com o gerente.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }

  if (status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }

  return 'Não foi possível entrar agora. Tente novamente em instantes.'
}
