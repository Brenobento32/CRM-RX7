import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import { normalizarRegras, REGRAS_ANTERIORES, type RegrasComerciais } from '@/lib/utils/regras-comerciais'

type RpcSolto = (nome: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

/**
 * Regras comerciais da empresa da requisição (`minhas_regras_comerciais()`,
 * SECURITY DEFINER: só a própria empresa). Uma consulta por requisição.
 * Sem a migration 20261109090100 no banco, devolve o comportamento anterior
 * (agência, TCV/MRR, Metas ligado), para o site poder ir antes da migration.
 */
export const obterRegrasComerciais = cache(async (): Promise<RegrasComerciais> => {
  const supabase = await createClient()
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcSolto
  const { data, error } = await rpc('minhas_regras_comerciais')
  if (error || data === null || data === undefined) return REGRAS_ANTERIORES
  return normalizarRegras(data)
})

/** Página e Server Action de Metas conferem no servidor (o banco confere de novo). */
export async function metasHabilitadas(): Promise<boolean> {
  return (await obterRegrasComerciais()).metasAtivo
}
