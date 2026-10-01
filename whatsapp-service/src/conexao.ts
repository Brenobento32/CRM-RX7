import { supabase } from './supabase.js'

/** Linha única por convenção — mesmo id sempre (ver migration 20260930190000). */
const ID_CONEXAO = '00000000-0000-0000-0000-000000000001'

type StatusConexao = 'desconectado' | 'conectando' | 'conectado'

export async function atualizarStatusConexao(status: StatusConexao, numero?: string): Promise<void> {
  // UPDATE puro, nunca upsert: a linha é criada só pela configuração em
  // /configuracoes/whatsapp (funil_id/responsavel_padrao_id são NOT NULL e
  // este serviço não decide esses valores). Um upsert sem essas colunas
  // falharia mesmo com a linha já existindo — o Postgres valida NOT NULL da
  // linha candidata do INSERT antes de resolver o ON CONFLICT.
  const { data, error } = await supabase
    .from('whatsapp_conexoes')
    .update({
      status,
      ...(numero ? { numero } : {}),
      ...(status === 'conectado' ? { conectado_em: new Date().toISOString() } : {}),
    })
    .eq('id', ID_CONEXAO)
    .select('id')

  if (error) {
    console.error('[conexao] falha ao atualizar status no banco:', error.message)
    return
  }

  if (!data || data.length === 0) {
    console.error(
      '[conexao] Configuração WhatsApp não encontrada; salve a configuração em /configuracoes/whatsapp antes de conectar.',
    )
  }
}
