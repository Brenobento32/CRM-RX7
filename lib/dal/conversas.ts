import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { extensaoDeMime } from '@/lib/validations/mensagem'

type DirecaoMensagem = Database['public']['Enums']['direcao_mensagem']
type TipoMensagem = Database['public']['Enums']['tipo_mensagem']
export type StatusMensagem = Database['public']['Enums']['status_mensagem']

/** Bucket privado de mídia do WhatsApp — path `{conversa_id}/{uuid}.{extensao}` (ver migration 20261006100000). */
const BUCKET_MIDIA = 'whatsapp-midia'

/** Só o tempo de exibir no painel — nunca persistida, sempre gerada de novo sob demanda. */
const TTL_URL_ASSINADA = 300

export type MensagemConversa = {
  id: string
  direcao: DirecaoMensagem
  tipo: TipoMensagem
  conteudo: string | null
  /** Ciclo de envio — só existe pra `direcao='saida'`; mensagem de entrada é `null`. */
  status: StatusMensagem | null
  createdAt: string
  /** Signed URL do anexo (`tipo='imagem'`) — `null` até ser gerada (ver `obterUrlAnexo`). */
  arquivoUrl: string | null
  /** Nome original do arquivo, só pra exibição (alt da imagem). */
  arquivoNome: string | null
}

export type ConversaCliente = {
  id: string
  mensagens: MensagemConversa[]
}

/**
 * Conversa de WhatsApp vinculada a um cliente, com as mensagens em ordem
 * cronológica (mais antiga primeiro). `null` quando o cliente nunca teve
 * conversa — RLS de `conversas`/`mensagens` decide o que cada usuário
 * enxerga (gerente vê tudo; closer só a conversa de um cliente que é dele),
 * mesma regra do resto do sistema.
 */
export async function obterConversaDoCliente(clienteId: string): Promise<ConversaCliente | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data: conversa, error: erroConversa } = await supabase
    .from('conversas')
    .select('id')
    .eq('cliente_id', clienteId)
    .order('ultima_mensagem_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (erroConversa) throw new Error('Não foi possível carregar a conversa.', { cause: erroConversa })
  if (!conversa) return null

  const { data: mensagens, error: erroMensagens } = await supabase
    .from('mensagens')
    .select('id, direcao, tipo, conteudo, status, arquivo_path, arquivo_nome, created_at')
    .eq('conversa_id', conversa.id)
    .order('created_at', { ascending: true })

  if (erroMensagens) throw new Error('Não foi possível carregar as mensagens.', { cause: erroMensagens })

  return {
    id: conversa.id,
    mensagens: await Promise.all(
      (mensagens ?? []).map(async (m) => ({
        id: m.id,
        direcao: m.direcao,
        tipo: m.tipo,
        conteudo: m.conteudo,
        status: m.status,
        createdAt: m.created_at,
        arquivoNome: m.arquivo_nome,
        arquivoUrl:
          m.tipo === 'imagem' && m.arquivo_path
            ? await assinarUrlAnexo(supabase, m.arquivo_path)
            : null,
      })),
    ),
  }
}

/** `createSignedUrl` isolado — usado na carga inicial e em `obterUrlAnexo`. `null` em qualquer falha. */
async function assinarUrlAnexo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caminho: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_MIDIA).createSignedUrl(caminho, TTL_URL_ASSINADA)
  if (error) {
    console.error('signed url anexo whatsapp', error)
    return null
  }
  return data?.signedUrl ?? null
}

/**
 * URL assinada de UMA mensagem (por id) — usada pelo `PainelConversa` quando
 * uma imagem chega via Realtime (o payload de `postgres_changes` não traz
 * signed URL, só as colunas da linha). O caminho nunca vem do cliente: é
 * sempre lido de volta do banco por `mensagemId`, sob a RLS de
 * `mensagens_select` — e a policy de SELECT de `storage.objects` confere a
 * posse de novo, independente da RLS de `mensagens`.
 */
export async function obterUrlAnexo(mensagemId: string): Promise<string | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mensagens')
    .select('arquivo_path')
    .eq('id', mensagemId)
    .maybeSingle()

  if (error || !data?.arquivo_path) return null
  return assinarUrlAnexo(supabase, data.arquivo_path)
}

/**
 * Sobe a imagem pro bucket privado e registra a mensagem de saída como
 * `pendente` — mesmo ciclo de `enviarMensagemTexto`, quem efetivamente envia
 * pelo WhatsApp é o whatsapp-service, de forma assíncrona. Se o INSERT
 * falhar depois do upload ir, o arquivo é removido — nunca fica lixo
 * referenciado por ninguém nem mensagem apontando pra arquivo inexistente.
 */
export async function enviarMensagemImagem(
  conversaId: string,
  arquivo: File,
  legenda: string | null,
): Promise<
  | { ok: true; id: string; createdAt: string; conteudo: string | null; arquivoUrl: string | null }
  | { ok: false; mensagem: string }
> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const caminho = `${conversaId}/${crypto.randomUUID()}.${extensaoDeMime(arquivo.type)}`

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_MIDIA)
    .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })

  if (erroUpload) {
    console.error('upload imagem whatsapp', erroUpload)
    return { ok: false, mensagem: 'Não foi possível enviar a imagem.' }
  }

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'imagem',
      status: 'pendente',
      conteudo: legenda,
      autor_id: usuario.id,
      arquivo_path: caminho,
      arquivo_mime: arquivo.type,
      arquivo_nome: arquivo.name,
      arquivo_tamanho: arquivo.size,
    })
    .select('id, created_at')
    .single()

  if (error) {
    await supabase.storage.from(BUCKET_MIDIA).remove([caminho])
    console.error('mensagem imagem whatsapp', error)
    return { ok: false, mensagem: 'Não foi possível enviar a imagem.' }
  }

  return {
    ok: true,
    id: data.id,
    createdAt: data.created_at,
    conteudo: legenda,
    arquivoUrl: await assinarUrlAnexo(supabase, caminho),
  }
}

/**
 * Registra uma mensagem de saída de texto como `pendente` — quem efetivamente
 * envia pelo WhatsApp é o whatsapp-service, de forma assíncrona (ver migration
 * 20261001130000). A RLS de `mensagens_insert` decide se este usuário pode
 * escrever nesta conversa; `autor_id` vem sempre do usuário autenticado, nunca
 * do cliente.
 *
 * Devolve `id`/`createdAt` pra quem chamou poder mostrar a própria mensagem
 * na hora, sem esperar o Realtime — o Realtime continua sendo a única fonte
 * pra mensagem de entrada e pras transições de status que o whatsapp-service
 * grava depois (`PainelConversa` já está inscrito em `postgres_changes`).
 */
export async function enviarMensagemTexto(
  conversaId: string,
  texto: string,
): Promise<{ ok: true; id: string; createdAt: string } | { ok: false; mensagem: string }> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'texto',
      status: 'pendente',
      conteudo: texto,
      autor_id: usuario.id,
    })
    .select('id, created_at')
    .single()

  if (error) {
    return { ok: false, mensagem: 'Não foi possível enviar a mensagem.' }
  }

  return { ok: true, id: data.id, createdAt: data.created_at }
}

/**
 * Status atual de UMA mensagem (por id) — fallback de `PainelConversa` pra
 * quando o `UPDATE` do Realtime (pendente → enviando → enviado/falhou) não
 * chega no próprio remetente. Não é polling da conversa: uma linha, uma vez,
 * puxada pelo cliente alguns segundos depois do envio. RLS de
 * `mensagens_select` decide se este usuário pode ver esta linha, igual a
 * qualquer outra leitura.
 */
export async function obterStatusMensagem(id: string): Promise<StatusMensagem | null> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase.from('mensagens').select('status').eq('id', id).maybeSingle()

  if (error || !data) return null
  return data.status
}
