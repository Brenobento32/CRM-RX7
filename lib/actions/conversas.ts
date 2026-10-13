'use server'

import { z } from 'zod'

import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  encaminharMensagens,
  enviarMensagemAudio,
  enviarMensagemDocumento,
  enviarMensagemImagem,
  enviarMensagemTexto,
  excluirMensagensParaMim,
  listarConversasParaEncaminhar,
  obterConversaDoCliente,
  obterMensagensAnteriores,
  obterReacoesDaConversa,
  obterStatusMensagem,
  obterUrlAnexo,
  reagirMensagem,
  reenviarMensagemMidia,
  removerReacao,
  type ConversaCliente,
  type ConversaParaEncaminhar,
  type MensagemEncaminhada,
  type MensagensAntigas,
  type ReacaoMensagem,
  type RespostaASnapshot,
  type StatusMensagem,
  type TipoMensagem,
} from '@/lib/dal/conversas'
import { validarAnexoAudio, validarAnexoDocumento, validarAnexoImagem } from '@/lib/validations/mensagem'

/** Carga inicial do `PainelConversa` — o Realtime assume a partir daqui. */
export async function obterConversaAction(clienteId: string): Promise<ConversaCliente | null> {
  if (!z.uuid().safeParse(clienteId).success) return null
  return obterConversaDoCliente(clienteId)
}

/** Id do usuário logado — só pra `PainelConversa` saber se uma reação já carregada é a própria (destacar/permitir remover com um clique). Nunca usado pra autorização: isso é sempre RLS/`getUsuarioAtual` no servidor. */
export async function obterUsuarioAtualIdAction(): Promise<string | null> {
  const usuario = await getUsuarioAtual()
  return usuario.id
}

const cursorMensagensAntigasSchema = z.object({
  conversaId: z.uuid(),
  cursorCreatedAt: z.iso.datetime({ offset: true }),
  cursorId: z.uuid(),
})

/** Página de mensagens mais antigas que o cursor — `PainelConversa` chama ao rolar pro topo do histórico já carregado. */
export async function obterMensagensAntigasAction(
  conversaId: string,
  cursorCreatedAt: string,
  cursorId: string,
): Promise<MensagensAntigas | null> {
  const cursor = cursorMensagensAntigasSchema.safeParse({ conversaId, cursorCreatedAt, cursorId })
  if (!cursor.success) return null
  return obterMensagensAnteriores(cursor.data.conversaId, cursor.data.cursorCreatedAt, cursor.data.cursorId)
}

/** Fallback pontual (uma mensagem, uma vez) pro caso do UPDATE do Realtime não chegar no remetente. */
export async function obterStatusMensagemAction(id: string): Promise<StatusMensagem | null> {
  if (!z.uuid().safeParse(id).success) return null
  return obterStatusMensagem(id)
}

/** Signed URL de uma mensagem de imagem que chegou via Realtime (sem URL no payload). */
export async function obterUrlAnexoAction(mensagemId: string): Promise<string | null> {
  if (!z.uuid().safeParse(mensagemId).success) return null
  return obterUrlAnexo(mensagemId)
}

export type EstadoEnvioMensagem = {
  ok?: boolean
  erro?: string
  /** Só presentes quando `ok` — pra `PainelConversa` mostrar a própria mensagem sem esperar o Realtime. */
  id?: string
  createdAt?: string
  conteudo?: string
  /** Só presentes quando `ok` e a mensagem é de mídia (imagem, documento ou áudio). */
  arquivoUrl?: string
  arquivoNome?: string
  /** Só presente pra áudio — segundos, arredondado. */
  arquivoDuracaoSegundos?: number
  /** Só presente no retorno de `reenviarMensagemMidiaAction` — a UI não sabe de antemão qual mídia está sendo reenviada. */
  tipo?: TipoMensagem
  /** Snapshot da mensagem respondida, quando o envio foi feito em modo resposta (ver `menu-mensagem.tsx`/composer). */
  respostaA?: RespostaASnapshot | null
}

const uuid = z.uuid()
/** `respostaAId` é opcional e sempre validado como uuid quando presente — nunca aceito "cru" do FormData. */
const respostaAIdSchema = z.uuid().nullable().optional()

function lerRespostaAId(formData: FormData): string | null {
  const bruto = formData.get('respostaAId')
  if (typeof bruto !== 'string' || !bruto) return null
  const parsed = respostaAIdSchema.safeParse(bruto)
  return parsed.success ? (parsed.data ?? null) : null
}

/** Envio de texto pelo `PainelConversa` — vazio é barrado aqui e, por garantia, pelo CHECK no banco. */
export async function enviarMensagemAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const texto = String(formData.get('texto') ?? '').trim()
  if (!texto) return { erro: 'Escreva uma mensagem antes de enviar.' }

  const resultado = await enviarMensagemTexto(conversaId, texto, lerRespostaAId(formData))
  if (!resultado.ok) return { erro: resultado.mensagem }

  return { ok: true, id: resultado.id, createdAt: resultado.createdAt, conteudo: texto, respostaA: resultado.respostaA }
}

/** Envio de imagem pelo `PainelConversa` — mesmo ciclo pendente→enviando→enviado/falhou do texto. */
export async function enviarMensagemImagemAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const arquivo = validarAnexoImagem(formData.get('arquivo'))
  if (typeof arquivo === 'string') return { erro: arquivo }
  if (!arquivo) return { erro: 'Selecione uma imagem.' }

  const legenda = String(formData.get('texto') ?? '').trim()

  const resultado = await enviarMensagemImagem(conversaId, arquivo, legenda || null, lerRespostaAId(formData))
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    conteudo: resultado.conteudo ?? undefined,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
    respostaA: resultado.respostaA,
  }
}

/** Envio de documento pelo `PainelConversa` — mesmo ciclo pendente→enviando→enviado/falhou do texto/imagem. */
export async function enviarMensagemDocumentoAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const arquivo = validarAnexoDocumento(formData.get('arquivo'))
  if (typeof arquivo === 'string') return { erro: arquivo }
  if (!arquivo) return { erro: 'Selecione um documento.' }

  const legenda = String(formData.get('texto') ?? '').trim()

  const resultado = await enviarMensagemDocumento(conversaId, arquivo, legenda || null, lerRespostaAId(formData))
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    conteudo: resultado.conteudo ?? undefined,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
    arquivoNome: resultado.arquivoNome ?? undefined,
    respostaA: resultado.respostaA,
  }
}

/** Envio de áudio (gravado no navegador) pelo `PainelConversa` — mesmo ciclo pendente→enviando→enviado/falhou. Sem legenda. */
export async function enviarMensagemAudioAction(
  conversaId: string,
  _estado: EstadoEnvioMensagem | undefined,
  formData: FormData,
): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(conversaId).success) return { erro: 'Conversa inválida.' }

  const arquivo = validarAnexoAudio(formData.get('arquivo'))
  if (typeof arquivo === 'string') return { erro: arquivo }
  if (!arquivo) return { erro: 'Grave um áudio antes de enviar.' }

  const duracaoSegundos = Number(formData.get('duracao') ?? 0)

  const resultado = await enviarMensagemAudio(conversaId, arquivo, duracaoSegundos, lerRespostaAId(formData))
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
    arquivoDuracaoSegundos: resultado.arquivoDuracaoSegundos ?? undefined,
    respostaA: resultado.respostaA,
  }
}

/** "Tentar novamente" numa mensagem de mídia (imagem, documento ou áudio) `falhou` — reaproveita o arquivo já no Storage. */
export async function reenviarMensagemMidiaAction(mensagemId: string): Promise<EstadoEnvioMensagem> {
  if (!uuid.safeParse(mensagemId).success) return { erro: 'Mensagem inválida.' }

  const resultado = await reenviarMensagemMidia(mensagemId)
  if (!resultado.ok) return { erro: resultado.mensagem }

  return {
    ok: true,
    id: resultado.id,
    createdAt: resultado.createdAt,
    tipo: resultado.tipo,
    conteudo: resultado.conteudo ?? undefined,
    arquivoUrl: resultado.arquivoUrl ?? undefined,
    arquivoNome: resultado.arquivoNome ?? undefined,
    arquivoDuracaoSegundos: resultado.arquivoDuracaoSegundos ?? undefined,
    respostaA: resultado.respostaA,
  }
}

const mensagemIdsSchema = z.array(z.uuid()).min(1).max(50)

/** "Excluir pra mim" (uma ou várias) — some da tela de quem excluiu, local e imediato (ver `PainelConversa`); nunca afeta quem mais vê a conversa. */
export async function excluirMensagensParaMimAction(mensagemIds: string[]): Promise<{ ok: boolean; erro?: string }> {
  const parsed = mensagemIdsSchema.safeParse(mensagemIds)
  if (!parsed.success) return { ok: false, erro: 'Seleção inválida.' }
  const resultado = await excluirMensagensParaMim(parsed.data)
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.mensagem }
}

/** Todas as reações da conversa, numa chamada só — ver `obterReacoesDaConversa`. */
export async function obterReacoesDaConversaAction(conversaId: string): Promise<ReacaoMensagem[]> {
  if (!z.uuid().safeParse(conversaId).success) return []
  return obterReacoesDaConversa(conversaId)
}

const emojiSchema = z.string().trim().min(1).max(32)

/** Reagir (ou trocar o emoji da própria reação) a uma mensagem — CRM-only, nunca sincroniza com o WhatsApp nesta fase. */
export async function reagirMensagemAction(mensagemId: string, emoji: string): Promise<{ ok: boolean; erro?: string }> {
  const parsed = z.object({ mensagemId: uuid, emoji: emojiSchema }).safeParse({ mensagemId, emoji })
  if (!parsed.success) return { ok: false, erro: 'Reação inválida.' }

  const resultado = await reagirMensagem(parsed.data.mensagemId, parsed.data.emoji)
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.mensagem }
}

/** Remove a própria reação de uma mensagem. */
export async function removerReacaoAction(mensagemId: string): Promise<{ ok: boolean; erro?: string }> {
  if (!uuid.safeParse(mensagemId).success) return { ok: false, erro: 'Mensagem inválida.' }
  const resultado = await removerReacao(mensagemId)
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.mensagem }
}

/** Lista de conversas elegíveis como destino de "Encaminhar" — ver `listarConversasParaEncaminhar`. */
export async function listarConversasParaEncaminharAction(conversaAtualId: string): Promise<ConversaParaEncaminhar[]> {
  if (!z.uuid().safeParse(conversaAtualId).success) return []
  return listarConversasParaEncaminhar(conversaAtualId)
}

const encaminharSchema = z.object({
  conversaDestinoId: z.uuid(),
  mensagemIds: mensagemIdsSchema,
})

/** Encaminha um lote de mensagens (1 a 50) pra outra conversa — CRM-only, nunca chama o whatsapp-service diretamente (vira envio `pendente` normal). */
export async function encaminharMensagensAction(
  conversaDestinoId: string,
  mensagemIds: string[],
): Promise<{ ok: boolean; enviadas: MensagemEncaminhada[]; falhas: number; erro?: string }> {
  const parsed = encaminharSchema.safeParse({ conversaDestinoId, mensagemIds })
  if (!parsed.success) return { ok: false, enviadas: [], falhas: 0, erro: 'Seleção inválida.' }

  const resultado = await encaminharMensagens(parsed.data.conversaDestinoId, parsed.data.mensagemIds)
  return { ok: true, enviadas: resultado.enviadas, falhas: resultado.falhas }
}
