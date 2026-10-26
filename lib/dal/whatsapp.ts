import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { nomesDeUsuarios } from '@/lib/dal/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterFunil } from '@/lib/dal/funis'
import { createClient } from '@/lib/supabase/server'
import type { ConfiguracaoWhatsappInput } from '@/lib/validations/whatsapp'

/** Linha única por convenção — mesmo id que o whatsapp-service usa (ver migration 20260930190000). */
const ID_CONEXAO = '00000000-0000-0000-0000-000000000001'

export type StatusConexaoWhatsapp = 'desconectado' | 'conectando' | 'conectado'

export type ConfiguracaoWhatsapp = {
  status: StatusConexaoWhatsapp
  numero: string | null
  funilId: string
  funilNome: string | null
  responsavelPadraoId: string
  responsavelPadraoNome: string | null
}

async function exigirGerente() {
  const usuario = await getUsuarioAtual()
  if (usuario.role !== 'gerente') throw new Error('Somente administradores configuram o WhatsApp.')
}

/**
 * Estado da conexão + configuração atual (funil/responsável padrão). `null`
 * quando o whatsapp-service nunca rodou (a linha única ainda não existe) —
 * a tela avisa que é preciso iniciar o serviço antes de configurar.
 */
export async function obterConfiguracaoWhatsapp(): Promise<ConfiguracaoWhatsapp | null> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('whatsapp_conexoes')
    .select('status, numero, funil_id, responsavel_padrao_id')
    .eq('id', ID_CONEXAO)
    .maybeSingle()

  if (error) throw new Error('Não foi possível carregar a configuração do WhatsApp.', { cause: error })
  if (!data) return null

  const [funil, nomes] = await Promise.all([
    obterFunil(data.funil_id),
    nomesDeUsuarios([data.responsavel_padrao_id]),
  ])

  return {
    status: data.status,
    numero: data.numero,
    funilId: data.funil_id,
    funilNome: funil?.nome ?? null,
    responsavelPadraoId: data.responsavel_padrao_id,
    responsavelPadraoNome: nomes.get(data.responsavel_padrao_id) ?? null,
  }
}

export type ResultadoConfiguracaoWhatsapp = { ok: true } | { ok: false; mensagem: string }

/**
 * Salva funil/responsável padrão. Nunca toca `status`/`numero`/`conectado_em`
 * — essas colunas são exclusivas do whatsapp-service (service_role).
 */
export async function salvarConfiguracaoWhatsapp(
  input: ConfiguracaoWhatsappInput,
): Promise<ResultadoConfiguracaoWhatsapp> {
  await exigirGerente()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('whatsapp_conexoes')
    .update({ funil_id: input.funilId, responsavel_padrao_id: input.responsavelPadraoId })
    .eq('id', ID_CONEXAO)
    .select('id')
    .maybeSingle()

  if (error) return traduzirErro(error)
  if (!data) {
    return {
      ok: false,
      mensagem:
        'A conexão WhatsApp ainda não foi iniciada. Rode o whatsapp-service pelo menos uma vez antes de configurar.',
    }
  }
  return { ok: true }
}

function traduzirErro(error: PostgrestError): Extract<ResultadoConfiguracaoWhatsapp, { ok: false }> {
  if (error.code === '42501') return { ok: false, mensagem: 'Somente administradores configuram o WhatsApp.' }
  if (error.code === '23503') return { ok: false, mensagem: 'Funil ou responsável inválido.' }

  console.error('Erro em whatsapp_conexoes', error)
  return { ok: false, mensagem: 'Não foi possível salvar a configuração. Tente novamente.' }
}
