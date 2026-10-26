import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { verifySession } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { LOGO_TIPOS, type AssinaturaInput, type DadosEmpresaInput, type NovaEmpresaInput, type PlanoInput } from '@/lib/validations/super-admin'

/**
 * Painel do Super Admin (dono da plataforma).
 *
 * A checagem aqui só evita telas e chamadas inúteis: quem decide é o banco —
 * toda RPC `admin_*` chama `exigir_super_admin()`, e as tabelas de planos,
 * assinaturas e auditoria não têm GRANT para usuários. O Super Admin não tem
 * vínculo com as empresas e, por isso, não vê dados comerciais delas.
 */

type Funcoes = Database['public']['Functions']
export type EmpresaAdmin = Funcoes['admin_listar_empresas']['Returns'][number]
export type PlanoAdmin = Funcoes['admin_listar_planos']['Returns'][number]
export type EventoAuditoria = Funcoes['admin_listar_auditoria']['Returns'][number]
export type MudancaAssinatura = Funcoes['admin_historico_assinatura']['Returns'][number]

export type Resultado = { ok: true; id?: string } | { ok: false; mensagem: string }

export const isSuperAdmin = cache(async (): Promise<boolean> => {
  await verifySession()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('is_super_admin')
  return !error && data === true
})

/**
 * Situação de quem abre o portal da administração (`/admin`), sem redirecionar:
 * - `anonimo`: sem sessão → tela de login administrativo;
 * - `negado`: logado, mas sem o privilégio global (Gerente e demais cargos);
 * - `admin`: Super Admin confirmado pelo banco (`is_super_admin`).
 *
 * O privilégio vem sempre do banco, nunca de e-mail, slug, cargo na empresa
 * ou parâmetro da URL.
 */
export type AcessoAdmin = 'anonimo' | 'negado' | 'admin'

export const acessoAdmin = cache(async (): Promise<AcessoAdmin> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return 'anonimo'
  const { data: superAdmin, error: erroPrivilegio } = await supabase.rpc('is_super_admin')
  return !erroPrivilegio && superAdmin === true ? 'admin' : 'negado'
})

/**
 * Rotas internas do painel (`/admin/...`): sem sessão volta ao login
 * administrativo; sem privilégio recebe 404 (nem descobre a tela).
 */
export async function exigirSuperAdmin() {
  const acesso = await acessoAdmin()
  if (acesso === 'anonimo') redirect('/admin')
  if (acesso !== 'admin') notFound()
}

function falha(error: { code?: string; message?: string } | null, padrao: string): Resultado {
  if (error?.code === '42501') return { ok: false, mensagem: 'Somente o Super Admin.' }
  if (error?.code === '22023' || error?.code === 'P0002') {
    // Mensagens dessas RPCs são escritas para o usuário (sem dado interno).
    return { ok: false, mensagem: error.message ?? padrao }
  }
  console.error('super-admin', error?.code)
  return { ok: false, mensagem: padrao }
}

export async function listarEmpresas(): Promise<EmpresaAdmin[]> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_listar_empresas', {})
  if (error) throw new Error('Não foi possível carregar as empresas.', { cause: error })
  return data
}

export async function obterEmpresa(id: string): Promise<EmpresaAdmin | null> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_listar_empresas', { p_tenant: id })
  if (error) throw new Error('Não foi possível carregar a empresa.', { cause: error })
  return data[0] ?? null
}

export async function listarPlanos(): Promise<PlanoAdmin[]> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_listar_planos')
  if (error) throw new Error('Não foi possível carregar os planos.', { cause: error })
  return data
}

export async function listarAuditoria(tenantId?: string, limite = 100): Promise<EventoAuditoria[]> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_listar_auditoria', {
    ...(tenantId ? { p_tenant: tenantId } : {}),
    p_limite: limite,
  })
  if (error) throw new Error('Não foi possível carregar a auditoria.', { cause: error })
  return data
}

export async function historicoAssinatura(tenantId: string): Promise<MudancaAssinatura[]> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_historico_assinatura', { p_tenant: tenantId })
  if (error) throw new Error('Não foi possível carregar o histórico.', { cause: error })
  return data
}

export async function salvarPlano(input: PlanoInput): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_salvar_plano', {
    p_codigo: input.codigo,
    p_nome: input.nome,
    p_preco_mensal: input.preco_mensal,
    p_preco_anual: input.preco_anual,
    p_limite_usuarios: input.limite_usuarios,
    p_limite_integracoes: input.limite_integracoes,
    p_dias_teste: input.dias_teste,
    p_recursos: input.recursos,
    p_status: input.status,
  })
  return error ? falha(error, 'Não foi possível salvar o plano.') : { ok: true }
}

export async function definirAssinatura(tenantId: string, input: AssinaturaInput): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_definir_assinatura', {
    p_tenant: tenantId,
    p_plano_codigo: input.plano_codigo,
    p_status: input.status,
    p_ciclo: input.ciclo,
    p_renovacao_em: input.renovacao_em,
    p_teste_ate: input.teste_ate,
    p_motivo: input.motivo,
    p_provedor: input.provedor,
    p_provedor_assinatura_id: input.provedor_assinatura_id,
  })
  return error ? falha(error, 'Não foi possível salvar a assinatura.') : { ok: true }
}

export async function suspenderEmpresa(tenantId: string, motivo: string): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_suspender_empresa', { p_tenant: tenantId, p_motivo: motivo })
  return error ? falha(error, 'Não foi possível suspender a empresa.') : { ok: true }
}

export async function reativarEmpresa(tenantId: string, motivo: string): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_reativar_empresa', { p_tenant: tenantId, p_motivo: motivo })
  return error ? falha(error, 'Não foi possível reativar a empresa.') : { ok: true }
}

/**
 * Nova empresa pelo onboarding: a Edge Function `admin-usuarios` cria ou
 * reaproveita a identidade do administrador e chama `provisionar_empresa`
 * com o JWT do Super Admin (o banco confere de novo).
 */
/** Só os campos que a Edge Function conhece; o cadastro completo vai depois, por `salvarCadastroEmpresa`. */
export type OnboardingEmpresa = Omit<NovaEmpresaInput, 'telefone' | 'email' | 'responsavel_nome'>

export async function criarEmpresa(input: OnboardingEmpresa): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; tenant_id?: string; mensagem?: string }>(
    'admin-usuarios',
    { body: { acao: 'provisionar_empresa', ...input } },
  )
  if (!error && data?.ok && data.tenant_id) return { ok: true, id: data.tenant_id }
  if (error instanceof FunctionsHttpError) {
    try {
      const corpo = (await error.context.json()) as { mensagem?: string }
      return { ok: false, mensagem: corpo.mensagem ?? 'Não foi possível criar a empresa.' }
    } catch {
      // cai no genérico
    }
  }
  return { ok: false, mensagem: data?.mensagem ?? 'Não foi possível falar com o serviço de usuários.' }
}

// ---------------------------------------------------------------------------
// Cadastro completo da empresa (nome comercial, contato, responsável, logo)
// ---------------------------------------------------------------------------

export const BUCKET_LOGOS = 'empresa-logos'

export type CadastroEmpresa = {
  id: string
  nome: string
  slug: string
  telefone: string | null
  email: string | null
  responsavelNome: string | null
  logoPath: string | null
  logoUrl: string | null
}

/** URL pública do logo; `versao` evita o navegador mostrar o logo antigo depois de trocar. */
export async function urlDoLogo(logoPath: string | null, versao: string): Promise<string | null> {
  if (!logoPath) return null
  const supabase = await createClient()
  const { data } = supabase.storage.from(BUCKET_LOGOS).getPublicUrl(logoPath)
  return `${data.publicUrl}?v=${encodeURIComponent(versao)}`
}

export async function obterCadastroEmpresa(tenantId: string): Promise<CadastroEmpresa | null> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id, nome, slug, telefone, email, responsavel_nome, logo_path, updated_at')
    .eq('id', tenantId)
    .maybeSingle()
  if (error) throw new Error('Não foi possível carregar o cadastro da empresa.', { cause: error })
  if (!data) return null
  return {
    id: data.id,
    nome: data.nome,
    slug: data.slug,
    telefone: data.telefone,
    email: data.email,
    responsavelNome: data.responsavel_nome,
    logoPath: data.logo_path,
    logoUrl: await urlDoLogo(data.logo_path, data.updated_at),
  }
}

/**
 * Salva o cadastro. Com logo novo: sobe primeiro (`<tenant>/logo.<ext>`), grava
 * o caminho e só então apaga o de outra extensão — o cadastro nunca aponta
 * para um arquivo que não existe. O banco confere a permissão (Super Admin ou
 * admin da própria empresa) e que o logo está na pasta da empresa.
 */
export async function salvarCadastroEmpresa(
  tenantId: string,
  dados: DadosEmpresaInput,
  logo: File | null,
  removerLogo: boolean,
): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const atual = await obterCadastroEmpresa(tenantId)
  if (!atual) return { ok: false, mensagem: 'Empresa não encontrada.' }

  let logoPath = removerLogo ? null : atual.logoPath
  if (logo) {
    const extensao = LOGO_TIPOS[logo.type as keyof typeof LOGO_TIPOS]
    logoPath = `${tenantId}/logo.${extensao}`
    const { error } = await supabase.storage.from(BUCKET_LOGOS).upload(logoPath, logo, { contentType: logo.type, upsert: true })
    if (error) {
      console.error('upload logo', error)
      return { ok: false, mensagem: 'Não foi possível enviar o logotipo.' }
    }
  }

  const { error } = await supabase.rpc('admin_atualizar_empresa', {
    p_tenant: tenantId,
    p_nome: dados.nome,
    p_telefone: dados.telefone,
    p_email: dados.email,
    p_responsavel_nome: dados.responsavel_nome,
    p_logo_path: logoPath,
  })
  if (error) return falha(error, 'Não foi possível salvar os dados da empresa.')

  if (atual.logoPath && atual.logoPath !== logoPath) {
    await supabase.storage.from(BUCKET_LOGOS).remove([atual.logoPath])
  }
  return { ok: true, id: tenantId }
}

/** Endereço já usado por alguma empresa (atual ou antigo)? O Super Admin enxerga todas. */
export async function slugEmUso(slug: string): Promise<boolean> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
  if (error) throw new Error('Não foi possível conferir o endereço.', { cause: error })
  return data !== null
}

/** Troca o endereço (slug): só Super Admin, com motivo, auditada; o antigo passa a redirecionar. */
export async function alterarSlugEmpresa(tenantId: string, slug: string, motivo: string): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_alterar_slug', { p_tenant: tenantId, p_slug: slug, p_motivo: motivo })
  if (error?.code === '23505') return { ok: false, mensagem: 'Esse endereço já pertence (ou pertenceu) a outra empresa.' }
  return error ? falha(error, 'Não foi possível trocar o endereço.') : { ok: true, id: tenantId }
}

/**
 * "Acessar empresa": abre a janela de acesso do Super Admin ao CRM da empresa
 * (8 h) e grava na auditoria — tudo na RPC, que exige o Super Admin. Devolve o
 * endereço (slug) para entrar no CRM.
 */
export async function acessarEmpresa(tenantId: string, motivo: string | null): Promise<{ ok: true; slug: string } | { ok: false; mensagem: string }> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_acessar_empresa', { p_tenant: tenantId, p_motivo: motivo })
  if (error || !data) {
    const r = falha(error, 'Não foi possível abrir o CRM da empresa.')
    return { ok: false, mensagem: r.ok ? 'Não foi possível abrir o CRM da empresa.' : r.mensagem }
  }
  return { ok: true, slug: data }
}

/** Encerra a janela de acesso do Super Admin à empresa (auditado). */
export async function encerrarAcessoEmpresa(tenantId: string): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_encerrar_acesso_empresa', { p_tenant: tenantId })
  return error ? falha(error, 'Não foi possível encerrar o acesso.') : { ok: true, id: tenantId }
}
