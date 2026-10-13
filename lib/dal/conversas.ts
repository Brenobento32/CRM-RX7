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

/** Snapshot da mensagem respondida, tirado no momento do envio — sobrevive à exclusão/paginação da original (ver migration 20261007160000). */
export type RespostaASnapshot = {
  id: string
  tipo: TipoMensagem
  conteudo: string | null
  direcao: DirecaoMensagem
}

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
  /** `null` quando esta mensagem não é uma resposta a nenhuma outra. */
  respostaA: RespostaASnapshot | null
  /** `true` quando esta mensagem nasceu de "Encaminhar" — só pra exibir a etiqueta, nunca carrega o conteúdo da origem (já está em `conteudo`/`arquivoUrl` normalmente). */
  encaminhada: boolean
}

export type ConversaCliente = {
  id: string
  mensagens: MensagemConversa[]
  /** `true` quando a carga trouxe exatamente `LIMITE_MENSAGENS_PAGINA` linhas — pode haver mais além da mais antiga aqui. */
  temMensagensAntigas: boolean
}

/** Linha crua comum às duas leituras paginadas (`mensagens_visiveis`) — ver `mapearCamposComuns`. */
type LinhaMensagemBanco = {
  id: string
  direcao: DirecaoMensagem
  tipo: TipoMensagem
  conteudo: string | null
  status: StatusMensagem | null
  created_at: string
  arquivo_path: string | null
  arquivo_nome: string | null
  arquivo_duracao_segundos: number | null
  resposta_a_id: string | null
  resposta_a_tipo: TipoMensagem | null
  resposta_a_conteudo: string | null
  resposta_a_direcao: DirecaoMensagem | null
  encaminhada_de_id: string | null
}

// Literal única (nunca concatenada em runtime) — o cliente tipado do
// PostgREST só consegue inferir as colunas de um `.select()` quando o
// argumento é um literal de string real; concatenação com `+` faz o tipo
// cair pra `string` genérico, e o retorno vira `GenericStringError`.
const COLUNAS_MENSAGEM =
  'id, direcao, tipo, conteudo, status, arquivo_path, arquivo_nome, arquivo_duracao_segundos, created_at, resposta_a_id, resposta_a_tipo, resposta_a_conteudo, resposta_a_direcao, encaminhada_de_id' as const

/** Campos que não dependem de uma chamada assíncrona (signed URL) — cada chamador decide `arquivoUrl` separadamente (eager na carga inicial, lazy na paginação). */
function mapearCamposComuns(m: LinhaMensagemBanco) {
  return {
    id: m.id,
    direcao: m.direcao,
    tipo: m.tipo,
    conteudo: m.conteudo,
    status: m.status,
    createdAt: m.created_at,
    arquivoNome: m.arquivo_nome,
    arquivoDuracaoSegundos: m.arquivo_duracao_segundos,
    respostaA: m.resposta_a_id
      ? {
          id: m.resposta_a_id,
          tipo: m.resposta_a_tipo as TipoMensagem,
          conteudo: m.resposta_a_conteudo,
          direcao: m.resposta_a_direcao as DirecaoMensagem,
        }
      : null,
    encaminhada: m.encaminhada_de_id !== null,
  }
}

/**
 * Conversa de WhatsApp vinculada a um cliente, com as últimas
 * `LIMITE_MENSAGENS_PAGINA` mensagens em ordem cronológica (mais antiga
 * primeiro) — histórico mais antigo que isso só entra sob demanda, ver
 * `obterMensagensAnteriores`. `null` quando o cliente nunca teve conversa —
 * RLS de `conversas`/`mensagens` decide o que cada usuário enxerga (gerente
 * vê tudo; closer só a conversa de um cliente que é dele), mesma regra do
 * resto do sistema.
 *
 * Lê de `mensagens_visiveis` (view, não a tabela) — já exclui o que o
 * usuário atual marcou como "excluir pra mim" (ver migration
 * 20261007160000), sem precisar de nenhum filtro extra aqui.
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
    .from('mensagens_visiveis')
    .select(COLUNAS_MENSAGEM)
    .eq('conversa_id', conversa.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMITE_MENSAGENS_PAGINA)

  if (erroMensagens) throw new Error('Não foi possível carregar as mensagens.', { cause: erroMensagens })

  const linhas = (mensagens ?? []).reverse() as LinhaMensagemBanco[]

  return {
    id: conversa.id,
    mensagens: await Promise.all(
      linhas.map(async (m) => ({
        ...mapearCamposComuns(m),
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
 *
 * Também lê de `mensagens_visiveis` — mesma exclusão pessoal da carga inicial.
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
    .from('mensagens_visiveis')
    .select(COLUNAS_MENSAGEM)
    .eq('conversa_id', conversaId)
    .or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite)

  if (error) throw new Error('Não foi possível carregar mensagens anteriores.', { cause: error })

  const linhas = (mensagens ?? []).reverse() as LinhaMensagemBanco[]

  return {
    mensagens: linhas.map((m) => ({ ...mapearCamposComuns(m), arquivoUrl: null })),
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
 * Resumo textual da mensagem original pra guardar no snapshot de resposta —
 * mesma convenção do "resumo" que o whatsapp-service já loga pra mensagem
 * recebida (ver `mensagens.ts` do whatsapp-service): texto como está,
 * legenda quando existe, ou um rótulo genérico pra mídia sem legenda.
 */
function resumoRespostaA(tipo: TipoMensagem, conteudo: string | null): string | null {
  if (tipo === 'texto') return conteudo
  if (conteudo) return conteudo
  if (tipo === 'imagem') return 'Imagem'
  if (tipo === 'documento') return 'Documento'
  if (tipo === 'audio') return 'Áudio'
  return null
}

type CamposResposta = {
  resposta_a_id: string | null
  resposta_a_tipo: TipoMensagem | null
  resposta_a_conteudo: string | null
  resposta_a_direcao: DirecaoMensagem | null
}

const SEM_RESPOSTA: CamposResposta = {
  resposta_a_id: null,
  resposta_a_tipo: null,
  resposta_a_conteudo: null,
  resposta_a_direcao: null,
}

/**
 * Monta os campos de snapshot pro INSERT de uma mensagem nova respondendo a
 * outra — lê a original sob a própria sessão do usuário (RLS de
 * `mensagens_select` decide se ele pode vê-la; nunca `service_role`), e
 * `conversa_id` trava a resposta na MESMA conversa — nunca cita uma
 * mensagem de outra conversa, mesmo que o usuário tenha acesso às duas
 * (ex.: gerente). Se a original não existir/não for visível/for de outra
 * conversa, devolve "sem resposta" silenciosamente em vez de falhar o envio
 * inteiro por causa só do preview da citação.
 */
async function montarCamposResposta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversaId: string,
  respostaAId: string | null | undefined,
): Promise<CamposResposta> {
  if (!respostaAId) return SEM_RESPOSTA

  const { data } = await supabase
    .from('mensagens')
    .select('tipo, conteudo, direcao')
    .eq('id', respostaAId)
    .eq('conversa_id', conversaId)
    .maybeSingle()

  if (!data) return SEM_RESPOSTA

  return {
    resposta_a_id: respostaAId,
    resposta_a_tipo: data.tipo,
    resposta_a_conteudo: resumoRespostaA(data.tipo, data.conteudo),
    resposta_a_direcao: data.direcao,
  }
}

function respostaADoRegistro(campos: CamposResposta): RespostaASnapshot | null {
  if (!campos.resposta_a_id) return null
  return {
    id: campos.resposta_a_id,
    tipo: campos.resposta_a_tipo as TipoMensagem,
    conteudo: campos.resposta_a_conteudo,
    direcao: campos.resposta_a_direcao as DirecaoMensagem,
  }
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
  respostaAId?: string | null,
): Promise<
  | { ok: true; id: string; createdAt: string; conteudo: string | null; arquivoUrl: string | null; respostaA: RespostaASnapshot | null }
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

  const campos = await montarCamposResposta(supabase, conversaId, respostaAId)

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
      ...campos,
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
    respostaA: respostaADoRegistro(campos),
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
  respostaAId?: string | null,
): Promise<
  | {
      ok: true
      id: string
      createdAt: string
      conteudo: string | null
      arquivoUrl: string | null
      arquivoNome: string | null
      respostaA: RespostaASnapshot | null
    }
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

  const campos = await montarCamposResposta(supabase, conversaId, respostaAId)

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
      ...campos,
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
    respostaA: respostaADoRegistro(campos),
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
  respostaAId?: string | null,
): Promise<
  | {
      ok: true
      id: string
      createdAt: string
      arquivoUrl: string | null
      arquivoDuracaoSegundos: number | null
      respostaA: RespostaASnapshot | null
    }
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

  const campos = await montarCamposResposta(supabase, conversaId, respostaAId)

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
      ...campos,
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
    respostaA: respostaADoRegistro(campos),
  }
}

/**
 * "Tentar novamente" pra mensagem de mídia (imagem, documento ou áudio) que
 * falhou — reaproveita o arquivo já no Storage (não sobe de novo, só cria
 * uma linha nova pendente com os mesmos dados de arquivo, incluindo
 * duração, resposta e etiqueta de encaminhada). A mensagem original precisa
 * passar pela RLS de `mensagens_select` pra ser lida; a nova, pela RLS de
 * `mensagens_insert` de novo — mesma proteção de sempre, nada contorna a
 * posse da conversa. Devolve `tipo` porque quem chama (UI) não sabe de
 * antemão qual mídia está sendo reenviada.
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
      respostaA: RespostaASnapshot | null
    }
  | { ok: false; mensagem: string }
> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { data: original, error: erroOriginal } = await supabase
    .from('mensagens')
    .select(
      'conversa_id, tipo, conteudo, arquivo_path, arquivo_mime, arquivo_nome, arquivo_tamanho, arquivo_duracao_segundos, resposta_a_id, resposta_a_tipo, resposta_a_conteudo, resposta_a_direcao, encaminhada_de_id',
    )
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
      resposta_a_id: original.resposta_a_id,
      resposta_a_tipo: original.resposta_a_tipo,
      resposta_a_conteudo: original.resposta_a_conteudo,
      resposta_a_direcao: original.resposta_a_direcao,
      encaminhada_de_id: original.encaminhada_de_id,
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
    respostaA: respostaADoRegistro({
      resposta_a_id: original.resposta_a_id,
      resposta_a_tipo: original.resposta_a_tipo,
      resposta_a_conteudo: original.resposta_a_conteudo,
      resposta_a_direcao: original.resposta_a_direcao,
    }),
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
  respostaAId?: string | null,
): Promise<
  | { ok: true; id: string; createdAt: string; respostaA: RespostaASnapshot | null }
  | { ok: false; mensagem: string }
> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const campos = await montarCamposResposta(supabase, conversaId, respostaAId)

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'texto',
      status: 'pendente',
      conteudo: texto,
      autor_id: usuario.id,
      ...campos,
    })
    .select('id, created_at')
    .single()

  if (error) {
    return { ok: false, mensagem: 'Não foi possível enviar a mensagem.' }
  }

  return { ok: true, id: data.id, createdAt: data.created_at, respostaA: respostaADoRegistro(campos) }
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

/**
 * "Excluir pra mim" — nunca apaga a linha de `mensagens`, só marca em
 * `mensagem_exclusoes` (por usuário). Aceita um lote (1 a N ids) e faz UM
 * `upsert` só, mesmo pra seleção múltipla — nunca uma chamada por mensagem.
 * `ignoreDuplicates` porque excluir de novo uma mensagem já excluída não é
 * erro, é no-op — e evita precisar de uma policy de UPDATE só pra isso (ver
 * migration).
 */
export async function excluirMensagensParaMim(mensagemIds: string[]): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase
    .from('mensagem_exclusoes')
    .upsert(
      mensagemIds.map((mensagemId) => ({ mensagem_id: mensagemId, usuario_id: usuario.id })),
      { onConflict: 'mensagem_id,usuario_id', ignoreDuplicates: true },
    )

  if (error) {
    console.error('excluir mensagens pra mim', error)
    return { ok: false, mensagem: 'Não foi possível excluir a mensagem.' }
  }
  return { ok: true }
}

export type ReacaoMensagem = {
  mensagemId: string
  usuarioId: string
  usuarioNome: string
  emoji: string
}

/**
 * Todas as reações da conversa inteira, numa chamada só — nunca por
 * mensagem nem por página. `PainelConversa` busca isto uma vez na carga
 * inicial e mantém atualizado depois só via Realtime (ver migration:
 * `mensagem_reacoes` está na publicação); como mensagem antiga ainda não
 * carregada pela paginação pode já ter reação, guardar tudo de uma vez
 * evita ter que buscar de novo a cada página que entra.
 */
export async function obterReacoesDaConversa(conversaId: string): Promise<ReacaoMensagem[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mensagem_reacoes')
    .select('mensagem_id, usuario_id, emoji, mensagens!inner(conversa_id), profiles(nome)')
    .eq('mensagens.conversa_id', conversaId)

  if (error) {
    console.error('reacoes whatsapp', error)
    return []
  }

  return (data ?? []).map((r) => ({
    mensagemId: r.mensagem_id,
    usuarioId: r.usuario_id,
    usuarioNome: r.profiles?.nome ?? 'Alguém',
    emoji: r.emoji,
  }))
}

/** Reage (ou troca a reação) à mensagem — `upsert` por `(mensagem_id, usuario_id)`: só uma reação por pessoa por mensagem, igual ao WhatsApp. */
export async function reagirMensagem(mensagemId: string, emoji: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase
    .from('mensagem_reacoes')
    .upsert({ mensagem_id: mensagemId, usuario_id: usuario.id, emoji }, { onConflict: 'mensagem_id,usuario_id' })

  if (error) {
    console.error('reagir whatsapp', error)
    return { ok: false, mensagem: 'Não foi possível reagir.' }
  }
  return { ok: true }
}

/** Remove a própria reação — RLS só deixa apagar a linha do próprio `usuario_id`, mas o filtro já garante isso explicitamente. */
export async function removerReacao(mensagemId: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const { error } = await supabase
    .from('mensagem_reacoes')
    .delete()
    .eq('mensagem_id', mensagemId)
    .eq('usuario_id', usuario.id)

  if (error) {
    console.error('remover reacao whatsapp', error)
    return { ok: false, mensagem: 'Não foi possível remover a reação.' }
  }
  return { ok: true }
}

export type ConversaParaEncaminhar = {
  conversaId: string
  clienteId: string
  clienteNome: string
  clienteEmpresa: string | null
}

/**
 * Conversas elegíveis como destino de "Encaminhar" — mesma visibilidade de
 * sempre (RLS de `conversas`/`clientes`: gerente vê tudo, closer só as
 * próprias), excluindo a conversa atual (não faz sentido encaminhar pra ela
 * mesma) e clientes excluídos (soft-delete).
 */
export async function listarConversasParaEncaminhar(conversaAtualId: string): Promise<ConversaParaEncaminhar[]> {
  await getUsuarioAtual()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('conversas')
    .select('id, ultima_mensagem_em, clientes!inner(id, nome, empresa, deleted_at)')
    .not('cliente_id', 'is', null)
    .is('clientes.deleted_at', null)
    .neq('id', conversaAtualId)
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('listar conversas pra encaminhar', error)
    return []
  }

  return (data ?? []).map((c) => ({
    conversaId: c.id,
    clienteId: c.clientes.id,
    clienteNome: c.clientes.nome,
    clienteEmpresa: c.clientes.empresa,
  }))
}

export type MensagemEncaminhada = {
  id: string
  createdAt: string
  tipo: TipoMensagem
  conteudo: string | null
  arquivoUrl: string | null
  arquivoNome: string | null
  arquivoDuracaoSegundos: number | null
}

/**
 * Encaminha um lote de mensagens pra outra conversa — best-effort por
 * mensagem (uma falha isolada não derruba o lote inteiro). Cada uma vira
 * uma linha `pendente` NOVA na conversa destino (mesmo ciclo de qualquer
 * envio — o whatsapp-service, hoje pausado, vai pegar quando voltar, sem
 * precisar de nenhuma mudança nele). Mídia nunca reaproveita o
 * `arquivo_path` original: a RLS de `storage.objects` autoriza pelo
 * primeiro segmento do path (o `conversa_id` de origem) — reaproveitar
 * quebraria o acesso de quem só vê a conversa destino. `storage.copy` faz
 * isso no servidor do Storage, sem baixar/subir bytes por aqui.
 */
export async function encaminharMensagens(
  conversaDestinoId: string,
  mensagemIds: string[],
): Promise<{ enviadas: MensagemEncaminhada[]; falhas: number }> {
  const usuario = await getUsuarioAtual()
  const supabase = await createClient()

  const enviadas: MensagemEncaminhada[] = []
  let falhas = 0

  for (const mensagemId of mensagemIds) {
    const resultado = await encaminharUmaMensagem(supabase, usuario.id, conversaDestinoId, mensagemId)
    if (resultado) enviadas.push(resultado)
    else falhas++
  }

  return { enviadas, falhas }
}

async function encaminharUmaMensagem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  usuarioId: string,
  conversaDestinoId: string,
  mensagemId: string,
): Promise<MensagemEncaminhada | null> {
  const { data: original, error: erroOriginal } = await supabase
    .from('mensagens')
    .select('tipo, conteudo, arquivo_path, arquivo_mime, arquivo_nome, arquivo_tamanho, arquivo_duracao_segundos')
    .eq('id', mensagemId)
    .maybeSingle()

  if (erroOriginal || !original) return null

  let novoPath: string | null = null
  if (original.arquivo_path) {
    const extensao = original.arquivo_path.split('.').pop() ?? 'bin'
    novoPath = `${conversaDestinoId}/${crypto.randomUUID()}.${extensao}`

    const { error: erroCopia } = await supabase.storage.from(BUCKET_MIDIA).copy(original.arquivo_path, novoPath)
    if (erroCopia) {
      console.error('copiar mídia pra encaminhar', erroCopia)
      return null
    }
  }

  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: conversaDestinoId,
      direcao: 'saida',
      tipo: original.tipo,
      status: 'pendente',
      conteudo: original.conteudo,
      autor_id: usuarioId,
      arquivo_path: novoPath,
      arquivo_mime: original.arquivo_mime,
      arquivo_nome: original.arquivo_nome,
      arquivo_tamanho: original.arquivo_tamanho,
      arquivo_duracao_segundos: original.arquivo_duracao_segundos,
      encaminhada_de_id: mensagemId,
    })
    .select('id, created_at')
    .single()

  if (error) {
    console.error('encaminhar mensagem whatsapp', error)
    if (novoPath) await supabase.storage.from(BUCKET_MIDIA).remove([novoPath])
    return null
  }

  return {
    id: data.id,
    createdAt: data.created_at,
    tipo: original.tipo,
    conteudo: original.conteudo,
    arquivoUrl: novoPath ? await assinarUrlAnexo(supabase, novoPath) : null,
    arquivoNome: original.arquivo_nome,
    arquivoDuracaoSegundos: original.arquivo_duracao_segundos,
  }
}
