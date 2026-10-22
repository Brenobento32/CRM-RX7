import 'server-only'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { verifySession } from '@/lib/dal/auth'
import { HEADER_EMPRESA, slugValido } from '@/lib/empresa/rota'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type PapelEmpresa = Database['public']['Enums']['tenant_papel']
type UserRole = Database['public']['Enums']['user_role']

export type EmpresaAtual = {
  id: string
  nome: string
  slug: string
  somenteLeitura: boolean
  papel: PapelEmpresa
}

export type EmpresaDoUsuario = {
  nome: string
  slug: string
  papel: PapelEmpresa
  somenteLeitura: boolean
}

/** Papel comercial usado pelas telas: admin_empresa tem os poderes de gerente. */
export function papelComercial(papel: PapelEmpresa): UserRole {
  return papel === 'admin_empresa' ? 'gerente' : papel
}

/**
 * Empresa da requisição (`/e/<slug>`), conferida no banco: só existe se o
 * usuário tiver vínculo ativo nela. Sem empresa ou sem vínculo → /empresas.
 * O banco revalida a mesma coisa em cada consulta (`tenant_atual()`).
 */
export const getEmpresaAtual = cache(async (): Promise<EmpresaAtual> => {
  const { userId } = await verifySession()
  const slug = (await headers()).get(HEADER_EMPRESA)
  if (!slugValido(slug)) redirect('/empresas')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenant_memberships')
    .select('papel, tenants!inner(id, nome, slug, somente_leitura)')
    .eq('user_id', userId)
    .eq('ativo', true)
    .eq('tenants.slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error('Não foi possível carregar a empresa.', { cause: error })
  }
  if (!data) redirect('/empresas')

  return {
    id: data.tenants.id,
    nome: data.tenants.nome,
    slug: data.tenants.slug,
    somenteLeitura: data.tenants.somente_leitura,
    papel: data.papel,
  }
})

export type MembroEmpresa = { papel: PapelEmpresa; role: UserRole; ativo: boolean }

/**
 * Papel de cada membro na empresa da requisição (substitui `profiles.role`,
 * que é global). Quem não está no mapa não é da empresa.
 */
export const membrosDaEmpresa = cache(async (): Promise<Map<string, MembroEmpresa>> => {
  await getEmpresaAtual()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('membros_empresa_atual')
  if (error) {
    throw new Error('Não foi possível carregar os membros da empresa.', { cause: error })
  }
  return new Map((data ?? []).map((m) => [m.usuario_id, { papel: m.papel, role: m.role, ativo: m.ativo }]))
})

/** Empresas em que o usuário tem vínculo ativo (tela de escolha). */
export async function listarMinhasEmpresas(): Promise<EmpresaDoUsuario[]> {
  const { userId } = await verifySession()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenant_memberships')
    .select('papel, tenants!inner(nome, slug, somente_leitura)')
    .eq('user_id', userId)
    .eq('ativo', true)

  if (error) {
    throw new Error('Não foi possível carregar as empresas.', { cause: error })
  }

  return (data ?? [])
    .map((m) => ({
      nome: m.tenants.nome,
      slug: m.tenants.slug,
      papel: m.papel,
      somenteLeitura: m.tenants.somente_leitura,
    }))
    .sort((a, b) => Number(a.somenteLeitura) - Number(b.somenteLeitura) || a.nome.localeCompare(b.nome, 'pt-BR'))
}
