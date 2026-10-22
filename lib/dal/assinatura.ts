import 'server-only'

import { getEmpresaAtual } from '@/lib/dal/empresa'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

/**
 * "Minha assinatura": só leitura, só o administrador da empresa da
 * requisição (o banco confere em `minha_assinatura()`). Nada aqui altera
 * plano, preço ou situação — isso é exclusivo do Super Admin e dos eventos
 * de pagamento.
 */

export type MinhaAssinatura = Database['public']['Functions']['minha_assinatura']['Returns'][number]

export async function podeVerAssinatura(): Promise<boolean> {
  return (await getEmpresaAtual()).papel === 'admin_empresa'
}

export async function obterMinhaAssinatura(): Promise<MinhaAssinatura | null> {
  if (!(await podeVerAssinatura())) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('minha_assinatura')
  if (error) throw new Error('Não foi possível carregar a assinatura.', { cause: error })
  return data[0] ?? null
}
