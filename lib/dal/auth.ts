import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { getEmpresaAtual, papelComercial, type CargoApp } from '@/lib/dal/empresa'
import { serverEnv } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type UserRole = Database['public']['Enums']['user_role']

/** O que as telas precisam saber sobre quem está logado — nada além disso. */
export type UsuarioAtual = {
  id: string
  nome: string
  email: string
  role: CargoApp
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
 * Lê o perfil do banco e o papel (gerente / sdr / closer) NA EMPRESA DA
 * REQUISIÇÃO — o mesmo usuário pode ter papéis diferentes em cada empresa.
 *
 * O papel é sempre relido do Postgres, nunca tirado do JWT: se um gerente
 * rebaixar ou desativar alguém, a mudança vale no próximo request, e não só
 * quando o token expirar.
 *
 * Usuário sem profile ou desativado não entra na área interna; sem vínculo
 * na empresa da URL, vai para a escolha de empresa. O Super Admin só chega
 * aqui depois de "Acessar empresa" no painel (janela auditada), como
 * Administrador daquela empresa — ver `getEmpresaAtual`.
 */
export const getUsuarioAtual = cache(async (): Promise<UsuarioAtual> => {
  const { userId } = await verifySession()
  const [supabase, empresa] = await Promise.all([createClient(), getEmpresaAtual()])

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
    role: papelComercial(empresa.papel),
    fotoUrl: profile.foto_url,
  }
})

export type ResultadoLogin = { ok: true } | { ok: false; mensagem: string }

/** Super Admin tentando o portal dos clientes (só aparece com a senha certa). */
export const MSG_CONTA_SO_ADMINISTRACAO =
  'Esta conta não tem acesso ao portal dos clientes. Entre pelo endereço da administração da plataforma.'

/**
 * Autentica com e-mail e senha (portal dos clientes). Os cookies de sessão
 * são gravados pelo cliente de servidor, por isso deve ser chamada de uma
 * Server Action.
 *
 * Com a sessão recém-criada, o banco diz se a conta é Super Admin. Super
 * Admin não entra por aqui — nem quando também é membro de uma empresa: o
 * privilégio global prevalece, a sessão é encerrada (com o mesmo cliente) e a
 * pessoa é orientada a usar a administração.
 */
export async function entrarComSenha(email: string, senha: string): Promise<ResultadoLogin> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  })

  if (error || !data.user) return { ok: false, mensagem: mensagemDeErroDeLogin(error?.code, error?.status) }

  const situacao = await situacaoDaConta(supabase)
  if (situacao.superAdmin) {
    await supabase.auth.signOut()
    return { ok: false, mensagem: MSG_CONTA_SO_ADMINISTRACAO }
  }
  return { ok: true }
}

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>

/** Privilégio global (`is_super_admin`), lido do banco com a sessão do cliente informado. */
async function situacaoDaConta(supabase: ClienteSupabase) {
  const { data, error } = await supabase.rpc('is_super_admin')
  return { superAdmin: !error && data === true }
}

/**
 * Situação da conta da sessão atual (ex.: a sessão de recuperação de senha),
 * para decidir a qual portal devolver a pessoa. Sem sessão: nada.
 */
export async function situacaoDaSessaoAtual(): Promise<{ superAdmin: boolean } | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims?.sub) return null
  return situacaoDaConta(supabase)
}

/** Mesma mensagem para senha errada e para conta sem privilégio: não revela se existe conta administrativa. */
export const MSG_LOGIN_ADMIN_INVALIDO = 'E-mail ou senha incorretos.'

export type ResultadoLoginAdmin = { ok: true } | { ok: false; mensagem: string }

/**
 * Portal da administração (`/admin`): autentica e confere o privilégio
 * GLOBAL de Super Admin no banco, com a mesma sessão. Sem o privilégio — um
 * Gerente, por exemplo — a sessão é encerrada na hora e a resposta é igual à
 * de senha errada. Só "muitas tentativas" tem mensagem própria (não diz nada
 * sobre a conta).
 */
export async function entrarComoSuperAdmin(email: string, senha: string): Promise<ResultadoLoginAdmin> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha })

  if (error) {
    const limite = error.status === 429 || error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit'
    return { ok: false, mensagem: limite ? mensagemDeErroDeLogin(error.code, 429) : MSG_LOGIN_ADMIN_INVALIDO }
  }

  const { data: superAdmin, error: erroPrivilegio } = await supabase.rpc('is_super_admin')
  if (erroPrivilegio || superAdmin !== true) {
    await supabase.auth.signOut()
    return { ok: false, mensagem: MSG_LOGIN_ADMIN_INVALIDO }
  }
  // Novo login: nenhuma janela de acesso a empresa sobrevive (é preciso
  // clicar de novo em "Acessar CRM"). Auditado na RPC.
  await supabase.rpc('encerrar_meus_acessos_globais', { p_motivo: 'novo login' })
  return { ok: true }
}

/**
 * Encerra a sessão. Antes, revoga no banco as janelas de acesso global do
 * Super Admin (auditado); para os demais usuários a RPC não faz nada. Mesmo
 * se esta chamada falhar, a janela fica presa à sessão (session_id) e morre
 * com ela.
 */
export async function sair() {
  const supabase = await createClient()
  await supabase.rpc('encerrar_meus_acessos_globais', { p_motivo: 'logout' })
  await supabase.auth.signOut()
}

/**
 * "Se o e-mail estiver cadastrado, você receberá instruções para redefinir
 * sua senha." — SEMPRE a mesma mensagem, exista ou não o e-mail (item 2:
 * nunca revelar se um e-mail existe). `resetPasswordForEmail` do Supabase
 * Auth já não diferencia isso no retorno; só uma falha operacional (rate
 * limit) muda a mensagem, e isso não expõe nada sobre a conta.
 *
 * `redirectTo` aponta para o Route Handler que troca o código da URL por uma
 * sessão (`app/auth/callback/route.ts`) — nenhum token passa pela aplicação
 * além do que o próprio Supabase Auth já gerencia.
 */
export type ResultadoRecuperacaoSenha = { ok: true; mensagem: string } | { ok: false; mensagem: string }

const MSG_RECUPERACAO_GENERICA =
  'Se o e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.'

export async function solicitarRecuperacaoSenha(email: string): Promise<ResultadoRecuperacaoSenha> {
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${serverEnv.siteUrl}/auth/callback?next=${encodeURIComponent('/redefinir-senha')}`,
  })

  if (error && (error.code === 'over_email_send_rate_limit' || error.status === 429)) {
    return { ok: false, mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
  }

  return { ok: true, mensagem: MSG_RECUPERACAO_GENERICA }
}

/**
 * Define a nova senha — exige uma sessão válida (a que o Route Handler de
 * callback já deixou gravada em cookies ao trocar o código do e-mail). Sem
 * sessão, o Supabase Auth recusa com `error`; é por isso que `/redefinir-senha`
 * NUNCA é uma rota pública no `proxy.ts` — só chega até aqui quem clicou o
 * link de verdade.
 */
export type ResultadoRedefinirSenha = { ok: true } | { ok: false; mensagem: string }

export async function redefinirSenha(novaSenha: string): Promise<ResultadoRedefinirSenha> {
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: novaSenha })

  if (error) {
    return {
      ok: false,
      mensagem: 'Não foi possível atualizar a senha. Solicite um novo link e tente de novo.',
    }
  }

  return { ok: true }
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
      return 'Este usuário está bloqueado. Fale com o administrador.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }

  if (status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }

  return 'Não foi possível entrar agora. Tente novamente em instantes.'
}

/**
 * Guarda de página por área da matriz de cargos: quem não está na lista
 * recebe 404 (nem descobre a tela). O banco nega os dados de qualquer forma.
 */
export async function exigirCargo(cargos: readonly CargoApp[]): Promise<UsuarioAtual> {
  const usuario = await getUsuarioAtual()
  if (!cargos.includes(usuario.role)) notFound()
  return usuario
}
