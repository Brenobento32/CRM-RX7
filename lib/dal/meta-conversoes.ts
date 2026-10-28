import 'server-only'

import { banco, exigirAdministrador, falhaDoBanco, podeAdministrarIntegracoes, type Resultado } from '@/lib/dal/integracoes-oficiais'

/**
 * Franquia mensal do WhatsApp (painel do Administrador) e Meta Ads —
 * Conversões do CRM. O banco decide empresa, cargo, plano e o que pode sair;
 * nenhum token chega aqui.
 */

// ------------------------------------------------------------------ WhatsApp: franquia mensal
export type FranquiaWhatsapp = {
  numeroId: string
  numero: string | null
  mes: string
  limite: number
  margem: number
  limiteEstimado: number
  usadas: number
  reservadas: number
  gratuitasConfirmadas: number
  cobradas: number
  utilizadasMeta: number | null
  confirmacao: 'desconhecida' | 'confirmada'
  reconciliadaEm: string | null
  situacao: 'liberada' | 'esgotada' | 'nao_confirmada'
  alertas: { 80: string | null; 90: string | null; 100: string | null }
  ultimoErro: string | null
}

export async function franquiaWhatsapp(): Promise<FranquiaWhatsapp[]> {
  if (!(await podeAdministrarIntegracoes())) return []
  const { rpc } = await banco()
  const { data, error } = await rpc('whatsapp_franquia_empresa')
  if (error) throw new Error('Não foi possível carregar a franquia do WhatsApp.', { cause: error })
  type L = {
    numero_id: string; numero: string | null; mes: string; limite: number; margem: number; limite_estimado: number; usadas: number; reservadas: number
    gratuitas_confirmadas: number; cobradas: number; utilizadas_meta: number | null; confirmacao: FranquiaWhatsapp['confirmacao']; reconciliada_em: string | null
    situacao: FranquiaWhatsapp['situacao']; alerta_80_em: string | null; alerta_90_em: string | null; alerta_100_em: string | null; ultimo_erro: string | null
  }
  return ((data as L[]) ?? []).map((f) => ({
    numeroId: f.numero_id,
    numero: f.numero,
    mes: f.mes,
    limite: f.limite,
    margem: f.margem,
    limiteEstimado: f.limite_estimado,
    usadas: f.usadas,
    reservadas: f.reservadas,
    gratuitasConfirmadas: f.gratuitas_confirmadas,
    cobradas: f.cobradas,
    utilizadasMeta: f.utilizadas_meta,
    confirmacao: f.confirmacao,
    reconciliadaEm: f.reconciliada_em,
    situacao: f.situacao,
    alertas: { 80: f.alerta_80_em, 90: f.alerta_90_em, 100: f.alerta_100_em },
    ultimoErro: f.ultimo_erro,
  }))
}

// ------------------------------------------------------------------ Meta Ads — Conversões do CRM
export type ConexaoMetaAds = {
  elegivel: boolean
  conexaoId: string | null
  situacao: 'configurando' | 'ativa' | 'pausada' | 'erro_autorizacao' | null
  datasetId: string | null
  datasetNome: string | null
  enviarContatoHash: boolean
  codigoTeste: string | null
  ativadaEm: string | null
  ultimoEnvioEm: string | null
  enviados: number
  rejeitados: number
  pendentes: number
  semCorrespondencia: number
  ultimoErro: string | null
  funis: string[]
  mapeamento: { funilId: string; etapaId: string; evento: string; enviarValor: boolean }[]
}

export async function conexaoMetaAds(): Promise<ConexaoMetaAds | null> {
  if (!(await podeAdministrarIntegracoes())) return null
  const { rpc } = await banco()
  const { data, error } = await rpc('capi_da_empresa')
  if (error) throw new Error('Não foi possível carregar a conexão Meta Ads.', { cause: error })
  const c = (data as Record<string, unknown>[] | null)?.[0]
  if (!c) return null
  const mapa = (c.mapeamento as { funil_id: string; etapa_id: string; evento: string; enviar_valor: boolean }[]) ?? []
  return {
    elegivel: Boolean(c.elegivel),
    conexaoId: (c.conexao_id as string) ?? null,
    situacao: (c.situacao as ConexaoMetaAds['situacao']) ?? null,
    datasetId: (c.dataset_id as string) ?? null,
    datasetNome: (c.dataset_nome as string) ?? null,
    enviarContatoHash: Boolean(c.enviar_contato_hash),
    codigoTeste: (c.codigo_teste as string) ?? null,
    ativadaEm: (c.ativada_em as string) ?? null,
    ultimoEnvioEm: (c.ultimo_envio_em as string) ?? null,
    enviados: Number(c.enviados ?? 0),
    rejeitados: Number(c.rejeitados ?? 0),
    pendentes: Number(c.pendentes ?? 0),
    semCorrespondencia: Number(c.sem_correspondencia ?? 0),
    ultimoErro: (c.ultimo_erro as string) ?? null,
    funis: (c.funis as string[]) ?? [],
    mapeamento: mapa.map((m) => ({ funilId: m.funil_id, etapaId: m.etapa_id, evento: m.evento, enviarValor: m.enviar_valor })),
  }
}

export type EventoMetaAds = {
  id: number
  evento: string
  situacao: 'pendente' | 'enviando' | 'enviado' | 'rejeitado' | 'sem_correspondencia' | 'expirado'
  negociacaoId: string
  clienteNome: string | null
  funilNome: string | null
  eventTime: string
  enviadoEm: string | null
  tentativas: number
  ultimoErro: string | null
}

export async function eventosMetaAds(limite = 50): Promise<EventoMetaAds[]> {
  if (!(await podeAdministrarIntegracoes())) return []
  const { rpc } = await banco()
  const { data, error } = await rpc('capi_eventos_recentes', { p_limite: limite })
  if (error) throw new Error('Não foi possível carregar o histórico de envios.', { cause: error })
  type L = {
    id: number; evento: string; situacao: EventoMetaAds['situacao']; negociacao_id: string; cliente_nome: string | null; funil_nome: string | null
    event_time: string; enviado_em: string | null; tentativas: number; ultimo_erro: string | null
  }
  return ((data as L[]) ?? []).map((e) => ({
    id: e.id,
    evento: e.evento,
    situacao: e.situacao,
    negociacaoId: e.negociacao_id,
    clienteNome: e.cliente_nome,
    funilNome: e.funil_nome,
    eventTime: e.event_time,
    enviadoEm: e.enviado_em,
    tentativas: e.tentativas,
    ultimoErro: e.ultimo_erro,
  }))
}

/** Funis ativos com TODAS as etapas ativas (a etapa de fechamento também é mapeável). */
export async function funisComEtapas(): Promise<{ id: string; nome: string; etapas: { id: string; nome: string; tipo: string }[] }[]> {
  const { supabase } = await banco()
  const [{ data: funis, error: e1 }, { data: etapas, error: e2 }] = await Promise.all([
    supabase.from('funis').select('id, nome, ordem').eq('ativo', true).order('ordem'),
    supabase.from('etapas_funil').select('id, nome, funil_id, tipo, ordem').eq('ativo', true).order('ordem'),
  ])
  if (e1 || e2) throw new Error('Não foi possível carregar os funis.', { cause: e1 ?? e2 })
  return funis.map((f) => ({
    id: f.id,
    nome: f.nome,
    etapas: etapas.filter((e) => e.funil_id === f.id).map((e) => ({ id: e.id, nome: e.nome, tipo: String(e.tipo) })),
  }))
}

export async function configurarMetaAds(
  funis: string[],
  mapeamento: { etapa_id: string; evento: string; enviar_valor: boolean }[],
  enviarContatoHash: boolean,
): Promise<Resultado> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { error } = await rpc('capi_definir_configuracao', { p_funis: funis, p_mapeamento: mapeamento, p_enviar_contato_hash: enviarContatoHash })
  return error ? falhaDoBanco(error, 'Não foi possível salvar a configuração.') : { ok: true }
}

export async function acaoMetaAds(acao: 'ativar' | 'retomar' | 'pausar' | 'definir_codigo_teste' | 'desconectar', codigoTeste?: string | null): Promise<Resultado> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { error } = await rpc('capi_acao', { p_acao: acao, p_codigo_teste: codigoTeste ?? null })
  return error ? falhaDoBanco(error, 'Não foi possível alterar a conexão.') : { ok: true }
}

export async function reprocessarEventoMetaAds(id: number): Promise<Resultado> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { error } = await rpc('capi_reprocessar', { p_evento: id })
  return error ? falhaDoBanco(error, 'Não foi possível reenviar o evento.') : { ok: true }
}
