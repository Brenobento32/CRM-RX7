import 'server-only'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { verifySession } from '@/lib/dal/auth'
import { HEADER_EMPRESA, HEADER_ROTA, slugValido } from '@/lib/empresa/rota'
import { caminhoInternoSeguro } from '@/lib/utils/redirect'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { Cargo } from '@/lib/validations/usuario'

export type PapelEmpresa = Database['public']['Enums']['tenant_papel']
type UserRole = Database['public']['Enums']['user_role']

/**
 * Cargo usado pelas telas. Vendedor e Atendente são cargos próprios (não
 * equivalem a Closer/SDR). Enquanto a matriz de cargos não for aprovada e
 * implementada no banco, eles não têm nenhum acesso comercial: o banco nega
 * tudo (papel_comercial() devolve nulo) e as telas só mostram o básico.
 */
export type CargoApp = Cargo

export type EmpresaAtual = {
  id: string
  nome: string
  slug: string
  somenteLeitura: boolean
  papel: PapelEmpresa
  /** Logo público do Storage (com versão para não ficar o antigo em cache), ou null. */
  logoUrl: string | null
}

export type EmpresaDoUsuario = {
  nome: string
  slug: string
  papel: PapelEmpresa
  somenteLeitura: boolean
}

/** Papel comercial usado pelas telas: admin_empresa tem os poderes de gerente. */
export function papelComercial(papel: PapelEmpresa): CargoApp {
  return papel === 'admin_empresa' ? 'gerente' : papel
}

/**
 * Empresa da requisição (`/<slug>`), conferida no banco: só existe se o
 * usuário tiver vínculo ativo nela. Sem empresa ou sem vínculo → /empresas.
 * O banco revalida a mesma coisa em cada consulta (`tenant_atual()`).
 */
export const getEmpresaAtual = cache(async (): Promise<EmpresaAtual> => {
  const { userId } = await verifySession()
  const cabecalhos = await headers()
  const slug = cabecalhos.get(HEADER_EMPRESA)
  if (!slugValido(slug)) redirect('/empresas')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenant_memberships')
    .select('papel, tenants!inner(id, nome, slug, somente_leitura, logo_path, updated_at)')
    .eq('user_id', userId)
    .eq('ativo', true)
    .eq('tenants.slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error('Não foi possível carregar a empresa.', { cause: error })
  }
  if (!data) {
    // Endereço antigo de uma empresa que trocou de slug: o banco só responde a
    // quem é membro dela (para os outros, nada — nem que a empresa existe).
    // Sempre passa pela escolha de empresa (`/empresas`), que resolve o endereço
    // antigo: redirecionar da página de uma empresa direto para a de outra,
    // durante a renderização, deixa o roteador do cliente em laço.
    const rota = caminhoInternoSeguro(cabecalhos.get(HEADER_ROTA))
    redirect(`/empresas?de=${encodeURIComponent(slug)}&next=${encodeURIComponent(rota)}`)
  }

  return {
    id: data.tenants.id,
    nome: data.tenants.nome,
    slug: data.tenants.slug,
    somenteLeitura: data.tenants.somente_leitura,
    papel: data.papel,
    logoUrl: data.tenants.logo_path
      ? `${supabase.storage.from('empresa-logos').getPublicUrl(data.tenants.logo_path).data.publicUrl}?v=${encodeURIComponent(data.tenants.updated_at)}`
      : null,
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

/**
 * Endereço (slug) antigo → atual. O banco só responde a quem é membro da
 * empresa; para os demais devolve nulo, sem revelar que a empresa existe.
 */
export async function resolverEnderecoAntigo(slug: string | null | undefined): Promise<string | null> {
  if (!slugValido(slug)) return null
  await verifySession()
  const supabase = await createClient()
  const { data } = await supabase.rpc('resolver_slug_antigo', { p_slug: slug })
  return typeof data === 'string' && slugValido(data) && data !== slug ? data : null
}
