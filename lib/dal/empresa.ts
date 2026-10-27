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
  /**
   * Super Admin dentro do CRM pelo painel global ("Acessar empresa"), sem
   * vínculo: atua como Administrador desta empresa enquanto a janela de acesso
   * (auditada) estiver aberta. O banco confere a mesma coisa em cada consulta.
   */
  acessoGlobal: boolean
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
 * Empresa da requisição (`/<slug>`), conferida no banco: existe se o usuário
 * tiver vínculo ativo nela — ou, para o Super Admin, se houver uma janela de
 * acesso aberta pelo painel global (`tenant_atual()` decide; digitar a URL
 * não basta). Sem empresa ou sem acesso → /empresas. O banco revalida a mesma
 * coisa em cada consulta.
 */
export const getEmpresaAtual = cache(async (): Promise<EmpresaAtual> => {
  const { userId } = await verifySession()
  const cabecalhos = await headers()
  const slug = cabecalhos.get(HEADER_EMPRESA)
  if (!slugValido(slug)) redirect('/empresas')

  const supabase = await createClient()
  const [privilegio, { data, error }] = await Promise.all([
    supabase.rpc('is_super_admin'),
    supabase
      .from('tenant_memberships')
      .select('papel, tenants!inner(id, nome, slug, somente_leitura, logo_path, updated_at)')
      .eq('user_id', userId)
      .eq('ativo', true)
      .eq('tenants.slug', slug)
      .maybeSingle(),
  ])

  if (error || privilegio.error) {
    throw new Error('Não foi possível carregar a empresa.', { cause: error ?? privilegio.error })
  }
  // Super Admin: vínculo antigo na empresa não dá acesso — só a janela do
  // "Acessar CRM" (o banco aplica a mesma regra em `tenant_atual()`).
  if (privilegio.data === true || !data) {
    const global = await empresaPorAcessoGlobal(supabase, slug)
    if (global) return global
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
    logoUrl: urlDoLogo(supabase, data.tenants.logo_path, data.tenants.updated_at),
    acessoGlobal: false,
  }
})

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>

function urlDoLogo(supabase: ClienteSupabase, logoPath: string | null, versao: string): string | null {
  return logoPath ? `${supabase.storage.from('empresa-logos').getPublicUrl(logoPath).data.publicUrl}?v=${encodeURIComponent(versao)}` : null
}

/**
 * Super Admin (com ou sem vínculo): a empresa só vale se `tenant_atual()` a resolver
 * para esta requisição — o que exige `is_super_admin()` E uma janela de
 * acesso vigente, aberta (e auditada) por `admin_acessar_empresa`.
 */
async function empresaPorAcessoGlobal(supabase: ClienteSupabase, slug: string): Promise<EmpresaAtual | null> {
  const { data: tenantId, error } = await supabase.rpc('tenant_atual')
  if (error || !tenantId) return null
  const { data: t } = await supabase
    .from('tenants')
    .select('id, nome, slug, somente_leitura, logo_path, updated_at')
    .eq('id', tenantId)
    .eq('slug', slug)
    .maybeSingle()
  if (!t) return null
  return {
    id: t.id,
    nome: t.nome,
    slug: t.slug,
    somenteLeitura: t.somente_leitura,
    papel: 'gerente',
    logoUrl: urlDoLogo(supabase, t.logo_path, t.updated_at),
    acessoGlobal: true,
  }
}

export type MembroEmpresa = { papel: PapelEmpresa; role: UserRole; ativo: boolean; superAdmin: boolean }

/**
 * Papel de cada membro na empresa da requisição (substitui `profiles.role`,
 * que é global). Quem não está no mapa não é da empresa. `superAdmin`: vínculo
 * antigo de um Super Admin — continua no histórico, mas nunca é responsável.
 */
export const membrosDaEmpresa = cache(async (): Promise<Map<string, MembroEmpresa>> => {
  await getEmpresaAtual()
  const supabase = await createClient()
  const [{ data, error }, supers] = await Promise.all([supabase.rpc('membros_empresa_atual'), supabase.rpc('super_admins_na_empresa_atual')])
  if (error || supers.error) {
    throw new Error('Não foi possível carregar os membros da empresa.', { cause: error ?? supers.error })
  }
  const idsSuper = new Set(supers.data ?? [])
  return new Map(
    (data ?? []).map((m) => [m.usuario_id, { papel: m.papel, role: m.role, ativo: m.ativo, superAdmin: idsSuper.has(m.usuario_id) }]),
  )
})

export const MSG_SUPER_ADMIN_RESPONSAVEL = 'O Super Admin não pode ser responsável. Escolha um usuário ativo da empresa.'

/**
 * Responsável comercial (carteira, reunião, meta, padrão de leads/WhatsApp):
 * nunca um Super Admin, nem com vínculo antigo. Quem não muda (`atual`) passa:
 * nada é reatribuído automaticamente. O banco confere de novo
 * (`tenant_validar_usuarios`).
 */
export async function responsavelProibido(id: string | null | undefined, atual?: string | null): Promise<boolean> {
  if (!id || id === atual) return false
  return (await membrosDaEmpresa()).get(id)?.superAdmin === true
}

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
