import { supabase } from './supabase.js'

/** Linha única por convenção — mesmo id sempre (ver migration 20260930190000). */
const ID_CONEXAO = '00000000-0000-0000-0000-000000000001'

type StatusConexao = 'desconectado' | 'conectando' | 'conectado'

export async function atualizarStatusConexao(status: StatusConexao, numero?: string): Promise<void> {
  const { error } = await supabase.from('whatsapp_conexoes').upsert({
    id: ID_CONEXAO,
    status,
    ...(numero ? { numero } : {}),
    ...(status === 'conectado' ? { conectado_em: new Date().toISOString() } : {}),
  })

  if (error) console.error('[conexao] falha ao atualizar status no banco:', error.message)
}
