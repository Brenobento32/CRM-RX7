import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { verifySession } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { AssinaturaInput, NovaEmpresaInput, PlanoInput } from '@/lib/validations/super-admin'

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

/** Rotas /admin: quem não é Super Admin recebe 404 (nem descobre que existe). */
export async function exigirSuperAdmin() {
  if (!(await isSuperAdmin())) notFound()
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
export async function criarEmpresa(input: NovaEmpresaInput): Promise<Resultado> {
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
