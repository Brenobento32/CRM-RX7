import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import {
  assinaturaAudioValida,
  assinaturaDocumentoValida,
  extensaoAudioDeMime,
  extensaoDeMime,
  extensaoDocumentoDeMime,
} from '@/lib/validations/mensagem'

type DirecaoMensagem = Database['public']['Enums']['direcao_mensagem']
export type TipoMensagem = Database['public']['Enums']['tipo_mensagem']
export type StatusMensagem = Database['public']['Enums']['status_mensagem']

/** Bucket privado de mídia do WhatsApp — path `{conversa_id}/{uuid}.{extensao}` (ver migration 20261006100000). */
const BUCKET_MIDIA = 'whatsapp-midia'

/** Só o tempo de exibir no painel — nunca persistida, sempre gerada de novo sob demanda. */
const TTL_URL_ASSINADA = 300

/** Tamanho de página do histórico — carga inicial e cada rolagem pro topo (ver `obterMensagensAnteriores`). */
const LIMITE_MENSAGENS_PAGINA = 50

export type MensagemConversa = {
  id: string
  direcao: DirecaoMensagem
  tipo: TipoMensagem
  conteudo: string | null
  /** Ciclo de envio — só existe pra `direcao='saida'`; mensagem de entrada é `null`. */
  status: StatusMensagem | null
  createdAt: string
  /** Signed URL do anexo (imagem/documento/áudio) — `null` até ser gerada (ver `obterUrlAnexo`). */
  arquivoUrl: string | null
  /** Nome original do arquivo, só pra exibição (alt da imagem, link do documento). `null` pra áudio. */
  arquivoNome: string | null
  /** Duração em segundos — só pra `tipo='audio'`. */
  arquivoDuracaoSegundos: number | null
}

export type ConversaCliente = {
  id: string
  mensagens: MensagemConversa[]
  /** `true` quando a carga trouxe exatamente `LIMITE_MENSAGENS_PAGINA` linhas — pode haver mais além da mais antiga aqui. */
  temMensagensAntigas: boolean
}

/**
 * Conversa de WhatsApp vinculada a um cliente, com as últimas
 * `LIMITE_MENSAGENS_PAGINA` mensagens em ordem cronológica (mais antiga
 * primeiro) — histórico mais antigo que isso só entra sob demanda, ver
 * `obterMensagensAnteriores`. `null` quando o cliente nunca teve conversa —
 * RLS de `conversas`/`mensagens` decide o que cada usuário enxerga (gerente
 * vê tudo; closer só a conversa de um cliente que é dele), mesma regra do
 * resto do sistema.
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

  // Busca as mais recentes primeiro (desc, com `id` como desempate de
  // `created_at` igual) pra pegar exatamente a "última página" via LIMIT no
  // índice `mensagens_conversa_idx (conversa_id, created_at)` — depois
  // inverte em memória pra ordem cronológica que a UI espera.
  const { data: mensagens, error: erroMensagens } = await supabase
    .from('mensagens')
    .select('id, direcao, tipo, conteudo, status, arquivo_path, arquivo_nome, arquivo_duracao_segundos, created_at')
    .eq('conversa_id', conversa.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMITE_MENSAGENS_PAGINA)

  if (erroMensagens) throw new Error('Não foi possível carregar as mensagens.', { cause: erroMensagens })

  const linhas = (mensagens ?? []).reverse()

  return {
    id: conversa.id,
    mensagens: await Promise.all(
      linhas.map(async (m) => ({
        id: m.id,
        direcao: m.direcao,
        tipo: m.tipo,
        conteudo: m.conteudo,
        status: m.status,
        createdAt: m.created_at,
        arquivoNome: m.arquivo_nome,
        arquivoDuracaoSegundos: m.arquivo_duracao_segundos,
        arquivoUrl:
          (m.tipo === 'imagem' || m.tipo === 'documento' || m.tipo === 'audio') && m.arquivo_path
            ? await assinarUrlAnexo(supabase, m.arquivo_path)
            : null,
      })),
    ),
    temMensagensAntigas: linhas.length === LIMITE_MENSAGENS_PAGINA,
  }
}

export type MensagensAntigas = {
  mensagens: MensagemConversa[]
  temMensagensAntigas: boolean
}

/**
 * Página de mensagens mais antigas que o cursor `(cursorCreatedAt,
 * cursorId)` — chamada só quando o usuário rola pro topo do histórico já
 * carregado (ver `PainelConversa`). Mesmo índice da carga inicial
 * (`mensagens_conversa_idx`, `conversa_id`+`created_at`) cobre o range; o
 * desempate por `id` (linhas com o MESMO `created_at` do cursor, caso raro
 * mas possível) é resolvido pelo próprio Postgres sobre o conjunto já
 * filtrado por `conversa_id` + já limitado, sem precisar de `id` no índice.
 *
 * `hasMore` nunca faz `count(*)`: só compara quantas linhas vieram com o
 * limite pedido — otimista quando bate exato (a próxima rolagem corrige
 * sozinha se não houver mais, nunca duplica nem perde nada).
 *
 * Nunca assina URL de anexo aqui — mensagem antiga de imagem/documento
 * recém-prependada fica `arquivoUrl: null` e é pega pelo mesmo efeito de
 * busca sob demanda que já existe no `PainelConversa`; áudio já busca a
 * própria URL sob demanda no primeiro play. Pré-assinar aqui gastaria
 * Storage com histórico que o usuário pode nunca rolar até ver.
 */
export async function obterMensagensAnteriores(
  conversaId: string,
  cursorCreatedAt: string,
  cursorId: string,
  limite: number = LIMITE_MENSAGENS_PAGINA,
): Promise<MensagensAntigas> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data: mensagens, error } = await supabase
    .from('mensagens')
    .select('id, direcao, tipo, conteudo, status, arquivo_path, arquivo_nome, arquivo_duracao_segundos, created_at')
    .eq('conversa_id', conversaId)
    .or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite)

  if (error) throw new Error('Não foi possível carregar mensagens anteriores.', { cause: error })

  const linhas = (mensagens ?? []).reverse()

  return {
    mensagens: linhas.map((m) => ({
      id: m.id,
      direcao: m.direcao,
      tipo: m.tipo,
      conteudo: m.conteudo,
      status: m.status,
      createdAt: m.created_at,
      arquivoNome: m.arquivo_nome,
      arquivoDuracaoSegundos: m.arquivo_duracao_segundos,
      arquivoUrl: null,
    })),
    temMensagensAntigas: linhas.length === limite,
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
 * Sobe o documento pro bucket privado e registra a mensagem de saída como
 * `pendente` — mesmo ciclo de `enviarMensagemImagem`. Antes do upload, confere
 * a assinatura real do arquivo (magic bytes) contra o MIME declarado: o
 * `File.type` do navegador não garante nada sobre o conteúdo, só sobre o que
 * o próprio navegador disse que é.
 */
export async function enviarMensagemDocumento(
  conversaId: string,
  arquivo: File,
  legenda: string | null,
): Promise<
  | { ok: true; id: string; createdAt: string; conteudo: string | null; arquivoUrl: string | null; arquivoNome: string | null }
  | { ok: false; mensagem: string }
> {
  const usuario = await getUsuarioAtual()

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  if (!assinaturaDocumentoValida(bytes, arquivo.type)) {
    return { ok: false, mensagem: 'O arquivo não corresponde ao tipo informado.' }
  }

  const supabase = await createClient()
  const caminho = `${conversaId}/${crypto.randomUUID()}.${extensaoDocumentoDeMime(arquivo.type)}`

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_MIDIA)
    .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })

  if (erroUpload) {
    console.error('upload documento whatsapp', erroUpload)
    return { ok: false, mensagem: 'Não foi possível enviar o documento.' }
  }

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'documento',
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
    console.error('mensagem documento whatsapp', error)
    return { ok: false, mensagem: 'Não foi possível enviar o documento.' }
  }

  return {
    ok: true,
    id: data.id,
    createdAt: data.created_at,
    conteudo: legenda,
    arquivoUrl: await assinarUrlAnexo(supabase, caminho),
    arquivoNome: arquivo.name,
  }
}

/**
 * Sobe o áudio bruto (o que o `MediaRecorder` gravou — webm/ogg/mp4,
 * dependendo do navegador) pro bucket privado e registra a mensagem de
 * saída como `pendente`, mesmo ciclo de `enviarMensagemImagem`/
 * `enviarMensagemDocumento`. A conversão pro Ogg/Opus real que o WhatsApp
 * exige pra voice note só acontece no whatsapp-service — nunca aqui.
 * `conteudo` é sempre `null`: áudio não tem legenda.
 */
export async function enviarMensagemAudio(
  conversaId: string,
  arquivo: File,
  duracaoSegundos: number,
): Promise<
  | { ok: true; id: string; createdAt: string; arquivoUrl: string | null; arquivoDuracaoSegundos: number | null }
  | { ok: false; mensagem: string }
> {
  const usuario = await getUsuarioAtual()

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  if (!assinaturaAudioValida(bytes, arquivo.type)) {
    return { ok: false, mensagem: 'O arquivo não corresponde a um áudio válido.' }
  }

  const supabase = await createClient()
  const duracaoArredondada = Math.round(duracaoSegundos) || null
  const caminho = `${conversaId}/${crypto.randomUUID()}.${extensaoAudioDeMime(arquivo.type)}`

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_MIDIA)
    .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })

  if (erroUpload) {
    console.error('upload audio whatsapp', erroUpload)
    return { ok: false, mensagem: 'Não foi possível enviar o áudio.' }
  }

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'audio',
      status: 'pendente',
      conteudo: null,
      autor_id: usuario.id,
      arquivo_path: caminho,
      arquivo_mime: arquivo.type,
      arquivo_tamanho: arquivo.size,
      arquivo_duracao_segundos: duracaoArredondada,
    })
    .select('id, created_at')
    .single()

  if (error) {
    await supabase.storage.from(BUCKET_MIDIA).remove([caminho])
    console.error('mensagem audio whatsapp', error)
    return { ok: false, mensagem: 'Não foi possível enviar o áudio.' }
  }

  return {
    ok: true,
    id: data.id,
    createdAt: data.created_at,
    arquivoUrl: await assinarUrlAnexo(supabase, caminho),
    arquivoDuracaoSegundos: duracaoArredondada,
  }
}

/**
 * "Tentar novamente" pra mensagem de mídia (imagem, documento ou áudio) que
 * falhou — reaproveita o arquivo já no Storage (não sobe de novo, só cria
 * uma linha nova pendente com os mesmos dados de arquivo, incluindo
 * duração). A mensagem original precisa passar pela RLS de
 * `mensagens_select` pra ser lida; a nova, pela RLS de `mensagens_insert`
 * de novo — mesma proteção de sempre, nada contorna a posse da conversa.
 * Devolve `tipo` porque quem chama (UI) não sabe de antemão qual mídia está
 * sendo reenviada.
 */
export async function reenviarMensagemMidia(
  mensagemId: string,
): Promise<
  | {
      ok: true
      id: string
      createdAt: string
      tipo: TipoMensagem
      conteudo: string | null
      arquivoUrl: string | null
      arquivoNome: string | null
      arquivoDuracaoSegundos: number | null
    }
  | { ok: false; mensagem: string }
> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data: original, error: erroOriginal } = await supabase
    .from('mensagens')
    .select('conversa_id, tipo, conteudo, arquivo_path, arquivo_mime, arquivo_nome, arquivo_tamanho, arquivo_duracao_segundos')
    .eq('id', mensagemId)
    .maybeSingle()

  if (erroOriginal || !original || !original.arquivo_path || !original.arquivo_mime) {
    return { ok: false, mensagem: 'Mensagem original não encontrada.' }
  }

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: original.conversa_id,
      direcao: 'saida',
      tipo: original.tipo,
      status: 'pendente',
      conteudo: original.conteudo,
      autor_id: usuario.id,
      arquivo_path: original.arquivo_path,
      arquivo_mime: original.arquivo_mime,
      arquivo_nome: original.arquivo_nome,
      arquivo_tamanho: original.arquivo_tamanho,
      arquivo_duracao_segundos: original.arquivo_duracao_segundos,
    })
    .select('id, created_at')
    .single()

  if (error) {
    console.error('reenviar mídia whatsapp', error)
    return { ok: false, mensagem: 'Não foi possível reenviar.' }
  }

  return {
    ok: true,
    id: data.id,
    createdAt: data.created_at,
    tipo: original.tipo,
    conteudo: original.conteudo,
    arquivoUrl: await assinarUrlAnexo(supabase, original.arquivo_path),
    arquivoNome: original.arquivo_nome,
    arquivoDuracaoSegundos: original.arquivo_duracao_segundos,
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
