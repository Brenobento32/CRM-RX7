import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { verifySession } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { BUCKET_MARCA, type VarianteLogo } from '@/lib/dal/identidade'
import {
  LOGO_TIPOS,
  type AssinaturaInput,
  type CadastroEmpresaAdminInput,
  type DadosEmpresaInput,
  type NovaEmpresaInput,
  type PlanoInput,
  type RegrasComerciaisInput,
  type RegrasEtapaInput,
} from '@/lib/validations/super-admin'
import { normalizarRegraEtapa, type RegraEtapa } from '@/lib/utils/regras-etapas'
import { camposDiferentesDoPadrao, normalizarRegras, type RegrasComerciais } from '@/lib/utils/regras-comerciais'

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
  if (error?.code === '22023' || error?.code === 'P0002' || error?.code === '23503' || error?.code === '23514') {
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

/**
 * Reativar volta a assinatura ao estado de ANTES da inativação (vencida volta
 * vencida). `status` = escolha explícita do Super Admin (auditada); o banco
 * nunca concede Ativa sem período pago nem estende teste por aqui.
 */
export async function reativarEmpresa(
  tenantId: string,
  motivo: string,
  status: 'ativa' | 'teste' | 'vencida' | null = null,
): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_reativar_empresa', {
    p_tenant: tenantId,
    p_motivo: motivo,
    ...(status ? { p_status_assinatura: status } : {}),
  })
  if (error?.code === '22023' && error.hint === 'escolha_necessaria') {
    return { ok: false, mensagem: `${error.message} Faça isso em Ações administrativas, na página da empresa.` }
  }
  return error ? falha(error, 'Não foi possível reativar a empresa.') : { ok: true }
}

type StatusVolta = 'ativa' | 'teste' | 'vencida'

export type PreviaReativacao = {
  inativa: boolean
  temAssinatura: boolean
  /** Como a assinatura estava antes da inativação (do histórico). `null` = sem registro: exige escolha. */
  estadoAnterior: StatusVolta | null
  /** O que a reativação pode aplicar sem conceder pagamento nem estender teste. */
  opcoes: StatusVolta[]
  testeAte: string | null
  renovacaoEm: string | null
}

export async function previaReativacao(tenantId: string): Promise<PreviaReativacao | null> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_reativacao_previa', { p_tenant: tenantId })
  if (error || !data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const volta = (v: unknown): v is StatusVolta => v === 'ativa' || v === 'teste' || v === 'vencida'
  return {
    inativa: d.inativa === true,
    temAssinatura: d.tem_assinatura === true,
    estadoAnterior: volta(d.estado_anterior) ? d.estado_anterior : null,
    opcoes: Array.isArray(d.opcoes) ? d.opcoes.filter(volta) : [],
    testeAte: typeof d.teste_ate === 'string' ? d.teste_ate : null,
    renovacaoEm: typeof d.renovacao_em === 'string' ? d.renovacao_em : null,
  }
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
  const { userId } = await verifySession()
  const supabase = await createClient()
  // O Super Admin nunca é o administrador (nem membro) de empresa nova. O banco
  // recusa qualquer Super Admin (`provisionar_empresa`); aqui só a mensagem clara.
  const { data: eu } = await supabase.from('profiles').select('email').eq('id', userId).maybeSingle()
  if (eu?.email && eu.email.toLowerCase() === input.admin_email.trim().toLowerCase()) {
    return { ok: false, mensagem: 'O administrador inicial precisa ser um usuário da empresa (outro e-mail), não o Super Admin.' }
  }
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
  nomeComercial: string | null
  /** Observações internas da plataforma (só o Super Admin lê). */
  observacoes: string | null
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
    .select('id, nome, nome_comercial, slug, telefone, email, responsavel_nome, logo_path, updated_at')
    .eq('id', tenantId)
    .maybeSingle()
  if (error) throw new Error('Não foi possível carregar o cadastro da empresa.', { cause: error })
  if (!data) return null
  const obs = await supabase.rpc('admin_observacoes_empresa', { p_tenant: tenantId })
  if (obs.error) throw new Error('Não foi possível carregar as observações da empresa.', { cause: obs.error })
  return {
    id: data.id,
    nome: data.nome,
    nomeComercial: data.nome_comercial,
    observacoes: obs.data ?? null,
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
  dados: DadosEmpresaInput & Partial<Pick<CadastroEmpresaAdminInput, 'nome_comercial' | 'observacoes'>>,
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

  // Campos que o formulário não trouxe continuam como estão.
  const { error } = await supabase.rpc('admin_atualizar_empresa', {
    p_tenant: tenantId,
    p_nome: dados.nome,
    p_nome_comercial: dados.nome_comercial === undefined ? atual.nomeComercial : dados.nome_comercial,
    p_observacoes: dados.observacoes === undefined ? atual.observacoes : dados.observacoes,
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

/**
 * Logo do AVANTE CRM (identidade GLOBAL da plataforma — não confundir com o
 * logotipo de cada empresa). Sobe `logo-<variante>.<ext>` no bucket
 * `plataforma-marca`, grava o caminho (auditado) e só então apaga o arquivo
 * de outra extensão. O banco e o storage conferem o Super Admin.
 */
export async function salvarLogoPlataforma(variante: VarianteLogo, logo: File): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const anterior = await caminhoLogoPlataforma(variante)
  const caminho = `logo-${variante}.${LOGO_TIPOS[logo.type as keyof typeof LOGO_TIPOS]}`
  const envio = await supabase.storage.from(BUCKET_MARCA).upload(caminho, logo, { contentType: logo.type, upsert: true })
  if (envio.error) {
    console.error('upload logo plataforma', envio.error)
    return { ok: false, mensagem: 'Não foi possível enviar a logo.' }
  }
  const { error } = await supabase.rpc('admin_definir_logo_plataforma', { p_variante: variante, p_path: caminho })
  if (error) return falha(error, 'Não foi possível salvar a logo.')
  if (anterior && anterior !== caminho) await supabase.storage.from(BUCKET_MARCA).remove([anterior])
  return { ok: true }
}

/** Remove a logo personalizada da variante: volta a valer a logo oficial embutida. */
export async function removerLogoPlataforma(variante: VarianteLogo): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const anterior = await caminhoLogoPlataforma(variante)
  const { error } = await supabase.rpc('admin_definir_logo_plataforma', { p_variante: variante, p_path: null })
  if (error) return falha(error, 'Não foi possível remover a logo.')
  if (anterior) await supabase.storage.from(BUCKET_MARCA).remove([anterior])
  return { ok: true }
}

async function caminhoLogoPlataforma(variante: VarianteLogo): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('identidade_plataforma')
  const linha = data?.[0]
  return (variante === 'claro' ? linha?.logo_claro_path : linha?.logo_escuro_path) ?? null
}

// ---------------------------------------------------------------------------
// Regras comerciais e ciclo de vida da empresa (migration 20261109090100)
// ---------------------------------------------------------------------------
type RpcSolto = (nome: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>

async function rpcSolto() {
  const supabase = await createClient()
  return supabase.rpc.bind(supabase) as unknown as RpcSolto
}

export type UsoPorTipo = { fechamentos: Record<string, number>; metas: Record<string, number> }

/** Regras da empresa + quantos fechamentos/metas ela já tem por tipo (null sem a migration). */
export async function regrasComerciaisDaEmpresa(tenantId: string): Promise<(RegrasComerciais & { uso: UsoPorTipo }) | null> {
  await exigirSuperAdmin()
  const rpc = await rpcSolto()
  const { data, error } = await rpc('admin_regras_comerciais', { p_tenant: tenantId })
  if (error || !data) return null
  const bruto = data as Record<string, unknown>
  const uso = (bruto.uso ?? {}) as Partial<UsoPorTipo>
  return { ...normalizarRegras(bruto), uso: { fechamentos: uso.fechamentos ?? {}, metas: uso.metas ?? {} } }
}

export async function definirRegrasComerciais(tenantId: string, input: RegrasComerciaisInput): Promise<Resultado> {
  await exigirSuperAdmin()
  const rpc = await rpcSolto()
  const { error } = await rpc('admin_definir_regras_comerciais', {
    p_tenant: tenantId,
    p_perfil: input.perfil,
    p_metas_ativo: input.metasAtivo,
    p_tipos_venda: input.tiposVenda,
    p_campos: camposDiferentesDoPadrao(input.perfil, input.campos),
    p_motivo: input.motivo,
  })
  return error ? falha(error, 'Não foi possível salvar as regras comerciais.') : { ok: true }
}

export async function arquivarEmpresa(tenantId: string, motivo: string): Promise<Resultado> {
  await exigirSuperAdmin()
  const rpc = await rpcSolto()
  const { error } = await rpc('admin_arquivar_empresa', { p_tenant: tenantId, p_motivo: motivo })
  return error ? falha(error, 'Não foi possível arquivar a empresa.') : { ok: true }
}

export type SituacaoExclusao = { protegida: boolean; inativa: boolean; bloqueios: string[]; usuariosSemOutraEmpresa: number }

export async function situacaoExclusaoEmpresa(tenantId: string): Promise<SituacaoExclusao | null> {
  await exigirSuperAdmin()
  const rpc = await rpcSolto()
  const { data, error } = await rpc('admin_exclusao_empresa_situacao', { p_tenant: tenantId })
  if (error || !data) return null
  const s = data as Record<string, unknown>
  return {
    protegida: s.protegida === true,
    inativa: s.inativa === true,
    bloqueios: Array.isArray(s.bloqueios) ? s.bloqueios.map(String) : [],
    usuariosSemOutraEmpresa: Number(s.usuarios_sem_outra_empresa ?? 0),
  }
}

export async function excluirEmpresa(tenantId: string, confirmacao: string, motivo: string): Promise<Resultado> {
  await exigirSuperAdmin()
  const rpc = await rpcSolto()
  const { error } = await rpc('admin_excluir_empresa', { p_tenant: tenantId, p_confirmacao: confirmacao, p_motivo: motivo })
  return error ? falha(error, 'Não foi possível excluir a empresa.') : { ok: true }
}

export type EtapaRegrasAdmin = {
  id: string
  nome: string
  tipo: 'aberta' | 'ganha' | 'perdida'
  ativo: boolean
  /** Aberta e não inicial: as outras têm regras próprias (entrada de leads, fechamento, perda). */
  configuravel: boolean
  regra: RegraEtapa
  definidoEm: string | null
  negociacoes: number
}
export type FunilRegrasAdmin = { id: string; nome: string; ativo: boolean; etapas: EtapaRegrasAdmin[] }

/** Funis e etapas da empresa com as exigências de cada etapa. Sem a migration: lista vazia. */
export async function regrasEtapasDaEmpresa(tenantId: string): Promise<FunilRegrasAdmin[] | null> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_regras_etapas', { p_tenant: tenantId })
  if (error || !Array.isArray(data)) return null
  return (data as Record<string, unknown>[]).map((f) => ({
    id: String(f.id),
    nome: String(f.nome),
    ativo: f.ativo === true,
    etapas: (Array.isArray(f.etapas) ? (f.etapas as Record<string, unknown>[]) : []).map((e) => ({
      id: String(e.id),
      nome: String(e.nome),
      tipo: e.tipo === 'ganha' || e.tipo === 'perdida' ? e.tipo : 'aberta',
      ativo: e.ativo === true,
      configuravel: e.configuravel === true,
      regra: normalizarRegraEtapa(e.campos, e.checklist),
      definidoEm: typeof e.definido_em === 'string' ? e.definido_em : null,
      negociacoes: Number(e.negociacoes ?? 0),
    })),
  }))
}

export async function definirRegrasEtapa(tenantId: string, input: RegrasEtapaInput): Promise<Resultado> {
  await exigirSuperAdmin()
  const supabase = await createClient()
  // Só o que difere de "opcional" vai para o banco.
  const campos = Object.fromEntries(Object.entries(input.campos).filter(([, uso]) => uso !== 'opcional'))
  const { error } = await supabase.rpc('admin_definir_regras_etapa', {
    p_tenant: tenantId,
    p_etapa: input.etapaId,
    p_campos: campos,
    p_checklist: input.checklist.map((l) => l.trim()).filter(Boolean),
    p_motivo: input.motivo,
  })
  return error ? falha(error, 'Não foi possível salvar as exigências da etapa.') : { ok: true }
}
