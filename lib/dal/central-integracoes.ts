import 'server-only'

import { banco } from '@/lib/dal/integracoes-oficiais'
import { lerLinhasCentral, type LinhaCentral } from '@/lib/integracoes/central'

/**
 * Central de Integrações (migration 20261104090000). Falha fechada: se não
 * der para ler, nada aparece como liberado.
 */
export async function centralDaEmpresa(): Promise<LinhaCentral[]> {
  try {
    const { rpc } = await banco()
    const { data, error } = await rpc('central_integracoes_empresa')
    return error ? [] : lerLinhasCentral(data)
  } catch {
    return []
  }
}

export type LinhaCentralAdmin = LinhaCentral & { motivo: string | null; definidoEm: string | null }

/** Painel do Super Admin (o banco confere `exigir_super_admin`). */
export async function centralDaEmpresaNoPainel(tenantId: string): Promise<LinhaCentralAdmin[]> {
  try {
    const { rpc } = await banco()
    const { data, error } = await rpc('admin_central_integracoes', { p_tenant: tenantId })
    if (error || !Array.isArray(data)) return []
    const extras = new Map((data as { integracao: string; motivo: string | null; definido_em: string | null }[]).map((d) => [d.integracao, d]))
    return lerLinhasCentral(data).map((l) => ({ ...l, motivo: extras.get(l.integracao)?.motivo ?? null, definidoEm: extras.get(l.integracao)?.definido_em ?? null }))
  } catch {
    return []
  }
}

export async function solicitarIntegracao(integracao: string): Promise<{ ok: true; novo: boolean } | { ok: false; mensagem: string }> {
  const { rpc } = await banco()
  const { data, error } = await rpc('solicitar_integracao', { p_integracao: integracao })
  if (error) return { ok: false, mensagem: error.message ?? 'Não foi possível concluir.' }
  return { ok: true, novo: data === true }
}

export async function definirIntegracaoEmpresa(tenantId: string, integracao: string, regra: string, motivo: string | null): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const { rpc } = await banco()
  const { error } = await rpc('admin_definir_integracao_empresa', { p_tenant: tenantId, p_integracao: integracao, p_regra: regra, p_motivo: motivo })
  return error ? { ok: false, mensagem: error.message ?? 'Não foi possível concluir.' } : { ok: true }
}

// ------------------------------------------------------------------ limites (Super Admin)
type RpcSolta = (nome: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

export type LimitesNovosDoPlano = { numeros: number | null; funis: number | null }

export async function limitesDosPlanos(): Promise<Record<string, LimitesNovosDoPlano>> {
  try {
    const { rpc } = await banco()
    const { data, error } = await (rpc as unknown as RpcSolta)('admin_limites_planos')
    if (error || !Array.isArray(data)) return {}
    return Object.fromEntries(
      (data as { codigo: string; limite_numeros_whatsapp: number | null; limite_funis: number | null }[]).map((p) => [p.codigo, { numeros: p.limite_numeros_whatsapp, funis: p.limite_funis }]),
    )
  } catch {
    return {}
  }
}

export async function definirLimitesPlano(codigo: string, limites: LimitesNovosDoPlano): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const { rpc } = await banco()
  const { error } = await (rpc as unknown as RpcSolta)('admin_definir_limites_plano', { p_codigo: codigo, p_numeros: limites.numeros, p_funis: limites.funis })
  return error ? { ok: false, mensagem: error.message ?? 'Não foi possível salvar os limites do plano.' } : { ok: true }
}

/**
 * Uma cota da empresa no painel do Super Admin: padrão do plano, exceção própria
 * (com motivo, auditada — prevalece enquanto existir), limite que vale e uso atual.
 * `efetivo` nulo com `efetivoDefinido` = sem limite (empresa interna); sem definido = a definir.
 */
export type LimiteEmpresa = {
  recurso: 'fontes' | 'numeros_whatsapp' | 'funis'
  padrao: number | null
  padraoDefinido: boolean
  excecao: number | null
  motivo: string | null
  definidoEm: string | null
  efetivo: number | null
  efetivoDefinido: boolean
  uso: number
}

export async function limitesDaEmpresa(tenantId: string): Promise<LimiteEmpresa[]> {
  try {
    const { rpc } = await banco()
    const { data, error } = await (rpc as unknown as RpcSolta)('admin_limites_empresa', { p_tenant: tenantId })
    if (error || !Array.isArray(data)) return []
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return (data as Record<string, unknown>[]).map((l) => ({
      recurso: l.recurso as LimiteEmpresa['recurso'],
      padrao: n(l.padrao),
      padraoDefinido: l.padrao_definido === true,
      excecao: n(l.excecao),
      motivo: typeof l.motivo === 'string' ? l.motivo : null,
      definidoEm: typeof l.definido_em === 'string' ? l.definido_em : null,
      efetivo: n(l.efetivo),
      efetivoDefinido: l.efetivo_definido === true,
      uso: Number(l.uso ?? 0) || 0,
    }))
  } catch {
    return []
  }
}

export async function definirLimiteEmpresa(tenantId: string, recurso: string, limite: number | null, motivo: string | null): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const { rpc } = await banco()
  const { error } = await (rpc as unknown as RpcSolta)('admin_definir_limite_empresa', { p_tenant: tenantId, p_recurso: recurso, p_limite: limite, p_motivo: motivo })
  return error ? { ok: false, mensagem: error.message ?? 'Não foi possível salvar o limite.' } : { ok: true }
}
