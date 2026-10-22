/**
 * Edge Function `admin-usuarios` — operações que exigem a API de admin do Auth.
 *
 * É um dos poucos lugares com a chave service_role (injetada pelo Supabase;
 * nunca passa pelo Next).
 *
 * Multiempresa: o Auth é global (uma identidade por e-mail) e o acesso é o
 * vínculo em `tenant_memberships`. Toda chamada:
 *   1. traz o JWT do usuário (verificado pelo gateway, verify_jwt) e o header
 *      `x-rx7-tenant` da empresa da aba;
 *   2. o próprio BANCO decide a permissão, com esse JWT + header
 *      (`definir_membro_tenant` exige admin_empresa da empresa ou Super Admin;
 *      `provisionar_empresa` e o bloqueio de login exigem Super Admin);
 *   3. o cliente admin só cria/busca identidade e bloqueia login.
 *
 * Ações:
 *   convidar (alias: criar) → identidade existente é reaproveitada (só ganha
 *       o vínculo na empresa, sem mexer em nome/senha); nova é criada (com
 *       senha) ou convidada por e-mail (sem senha). Se o vínculo falhar, a
 *       identidade recém-criada é removida — nada fica pela metade.
 *   provisionar_empresa → Super Admin: empresa + admin + funil inicial.
 *   bloquear_login      → Super Admin: bloqueia/desbloqueia o login no Auth
 *       (todas as empresas). Tirar alguém de UMA empresa é desativar o
 *       vínculo, feito pelo app com `definir_membro_tenant`.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { HEADER_TENANT, slugDaRequisicao } from '../_shared/requisicao.ts'

type Papel = 'admin_empresa' | 'gerente' | 'sdr' | 'closer'

type Pedido =
  | { acao: 'convidar'; nome: string; email: string; senha: string | null; telefone: string | null; papel: Papel }
  | { acao: 'provisionar_empresa'; nome: string; slug: string; admin_email: string; admin_nome: string; admin_senha: string | null }
  | { acao: 'bloquear_login'; usuario_id: string; bloquear: boolean }

/** Bloqueio "para sempre" no Auth: 100 anos. */
const BLOQUEIO = '876000h'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
/** Para onde o link do convite leva (domínio do CRM, ex.: Hostinger). */
const siteUrl = (Deno.env.get('CRM_SITE_URL') ?? '').replace(/\/+$/, '')

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

function resposta(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}
const erro = (status: number, codigo: string, mensagem: string) => resposta(status, { ok: false, codigo, mensagem })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAPEIS: Papel[] = ['admin_empresa', 'gerente', 'sdr', 'closer']

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function senhaOpcional(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  return typeof v === 'string' && v.length >= 8 ? v : undefined
}

/** Validação mínima: a completa (Zod) roda no Next antes de chamar. */
function validar(p: unknown): Pedido | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>

  if (o.acao === 'convidar' || o.acao === 'criar') {
    const papel = (o.papel ?? o.role) as Papel
    const nome = texto(o.nome)
    const email = texto(o.email)?.toLowerCase()
    const senha = senhaOpcional(o.senha)
    const telefone = o.telefone === null || o.telefone === undefined ? null : texto(o.telefone)
    if (!nome || !email || !EMAIL.test(email) || senha === undefined || !PAPEIS.includes(papel)) return null
    if (telefone !== null && !/^\d{10,13}$/.test(telefone)) return null
    return { acao: 'convidar', nome, email, senha, telefone, papel }
  }

  if (o.acao === 'provisionar_empresa') {
    const nome = texto(o.nome)
    const slug = texto(o.slug)?.toLowerCase()
    const email = texto(o.admin_email)?.toLowerCase()
    const adminNome = texto(o.admin_nome)
    const senha = senhaOpcional(o.admin_senha)
    if (!nome || !slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !email || !EMAIL.test(email) || !adminNome || senha === undefined) {
      return null
    }
    return { acao: 'provisionar_empresa', nome, slug, admin_email: email, admin_nome: adminNome, admin_senha: senha }
  }

  if (o.acao === 'bloquear_login') {
    if (typeof o.usuario_id !== 'string' || !UUID.test(o.usuario_id) || typeof o.bloquear !== 'boolean') return null
    return { acao: 'bloquear_login', usuario_id: o.usuario_id, bloquear: o.bloquear }
  }

  return null
}

/**
 * Identidade por e-mail: reaproveita a existente; senão cria (com senha) ou
 * convida (sem senha). `criada` diz se foi criada agora (para desfazer).
 */
async function garantirIdentidade(
  email: string,
  nome: string,
  senha: string | null,
): Promise<{ id: string; criada: boolean } | Response> {
  const { data: existente, error: erroBusca } = await admin.rpc('usuario_por_email', { p_email: email })
  if (erroBusca) {
    console.error('usuario_por_email', erroBusca.code)
    return erro(500, 'erro_auth', 'Não foi possível consultar o usuário.')
  }
  if (existente) return { id: existente as string, criada: false }

  const r = senha
    ? await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } })
    : await admin.auth.admin.inviteUserByEmail(email, {
        data: { nome },
        ...(siteUrl ? { redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent('/redefinir-senha')}` } : {}),
      })

  if (r.error || !r.data.user) {
    const codigo = (r.error as { code?: string } | null)?.code
    if (codigo === 'weak_password') return erro(400, 'senha_fraca', 'Senha fraca demais para as regras do Supabase Auth.')
    console.error('criar identidade', codigo)
    return erro(500, 'erro_auth', 'Não foi possível criar o usuário.')
  }
  return { id: r.data.user.id, criada: true }
}

async function desfazerIdentidade(id: string) {
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) console.error('desfazer identidade criada', id, error.message)
}

async function convidar(comoUsuario: SupabaseClient, pedido: Extract<Pedido, { acao: 'convidar' }>) {
  const { data: tenant } = await comoUsuario.rpc('tenant_atual')
  if (!tenant) return erro(403, 'sem_empresa', 'Empresa não informada ou sem acesso.')

  const identidade = await garantirIdentidade(pedido.email, pedido.nome, pedido.senha)
  if (identidade instanceof Response) return identidade

  // O banco decide: admin_empresa desta empresa ou Super Admin.
  const { error } = await comoUsuario.rpc('definir_membro_tenant', {
    p_tenant: tenant,
    p_user: identidade.id,
    p_papel: pedido.papel,
    p_ativo: true,
  })
  if (error) {
    if (identidade.criada) await desfazerIdentidade(identidade.id)
    if (error.code === '42501') return erro(403, 'sem_permissao', 'Somente o administrador da empresa convida usuários.')
    if (error.code === 'RX001') return erro(409, 'limite_usuarios', 'O plano da empresa atingiu o limite de usuários ativos.')
    console.error('definir_membro_tenant', error.code)
    return erro(500, 'erro_vinculo', 'Não foi possível vincular o usuário à empresa.')
  }

  if (identidade.criada && pedido.telefone) {
    const { error: erroPerfil } = await admin.from('profiles').update({ telefone: pedido.telefone }).eq('id', identidade.id)
    if (erroPerfil) console.error('telefone do novo usuário', erroPerfil.code)
  }

  return resposta(identidade.criada ? 201 : 200, { ok: true, usuario_id: identidade.id, existente: !identidade.criada })
}

async function provisionar(comoUsuario: SupabaseClient, pedido: Extract<Pedido, { acao: 'provisionar_empresa' }>) {
  const { data: superAdmin } = await comoUsuario.rpc('is_super_admin')
  if (superAdmin !== true) return erro(403, 'sem_permissao', 'Somente o Super Admin cria empresas.')

  const identidade = await garantirIdentidade(pedido.admin_email, pedido.admin_nome, pedido.admin_senha)
  if (identidade instanceof Response) return identidade

  const { data: tenant, error } = await comoUsuario.rpc('provisionar_empresa', {
    p_nome: pedido.nome,
    p_slug: pedido.slug,
    p_admin_user: identidade.id,
  })
  if (error) {
    if (identidade.criada) await desfazerIdentidade(identidade.id)
    console.error('provisionar_empresa', error.code)
    if (error.code === '22023') return erro(400, 'pedido_invalido', 'Nome ou identificador da empresa inválido.')
    return erro(500, 'erro_provisionar', 'Não foi possível criar a empresa.')
  }
  return resposta(201, { ok: true, tenant_id: tenant, admin_id: identidade.id, admin_existente: !identidade.criada })
}

async function bloquearLogin(comoUsuario: SupabaseClient, eu: string, pedido: Extract<Pedido, { acao: 'bloquear_login' }>) {
  const { data: superAdmin } = await comoUsuario.rpc('is_super_admin')
  if (superAdmin !== true) return erro(403, 'sem_permissao', 'Somente o Super Admin bloqueia o login.')
  if (pedido.usuario_id === eu && pedido.bloquear) return erro(400, 'auto_bloqueio', 'Você não pode bloquear o próprio login.')

  const { error } = await admin.auth.admin.updateUserById(pedido.usuario_id, {
    ban_duration: pedido.bloquear ? BLOQUEIO : 'none',
  })
  if (error) {
    console.error('ban_duration', error.message)
    return erro(500, 'erro_auth', 'Não foi possível atualizar o acesso no Auth.')
  }
  return resposta(200, { ok: true })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')

  const authorization = req.headers.get('Authorization')
  if (!authorization) return erro(401, 'nao_autenticado', 'Sessão ausente.')

  // JWT de quem chama + empresa da aba: as perguntas "quem pode?" vão para
  // as mesmas funções que a RLS usa.
  const slug = slugDaRequisicao(req.headers)
  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization, ...(slug ? { [HEADER_TENANT]: slug } : {}) } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: usuario } = await comoUsuario.auth.getUser()
  if (!usuario?.user) return erro(401, 'nao_autenticado', 'Sessão inválida.')

  let pedido: Pedido | null
  try {
    pedido = validar(await req.json())
  } catch {
    pedido = null
  }
  if (!pedido) return erro(400, 'pedido_invalido', 'Dados inválidos.')

  try {
    switch (pedido.acao) {
      case 'convidar':
        return await convidar(comoUsuario, pedido)
      case 'provisionar_empresa':
        return await provisionar(comoUsuario, pedido)
      case 'bloquear_login':
        return await bloquearLogin(comoUsuario, usuario.user.id, pedido)
    }
  } catch (e) {
    console.error('admin-usuarios', e instanceof Error ? e.message : e)
    return erro(500, 'interno', 'Erro inesperado no serviço de usuários.')
  }
})
