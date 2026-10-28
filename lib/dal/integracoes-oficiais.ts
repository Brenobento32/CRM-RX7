import 'server-only'

import { FunctionsHttpError } from '@supabase/supabase-js'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { createClient } from '@/lib/supabase/server'

/**
 * Integrações oficiais por empresa: Google Sheets (OAuth do Google) e WhatsApp
 * Business (Cloud API, Embedded Signup).
 *
 * Tudo que fala com Google/Meta passa pela Edge Function `integracoes`; o Next
 * nunca vê refresh token, token da Meta nem client secret. O banco decide
 * empresa, cargo, destino (funil/etapa/responsável) e custo em cada chamada;
 * as travas daqui só evitam idas inúteis ao servidor.
 *
 * RPCs novas (migration 20261030100000) ainda não estão nos tipos gerados:
 * `rpc()` abaixo é tipado aqui até `npm run db:types` rodar com ela aplicada.
 */

export type SituacaoIntegracao = 'aguardando' | 'ativa' | 'pausada' | 'erro' | 'erro_autorizacao' | 'desconectada' | 'conectado' | 'pausado' | 'desconectado' | 'revogada'

export type IntegracaoOficial = {
  fonteId: string
  tipo: 'google_sheets' | 'whatsapp_cloud'
  nome: string
  status: string
  situacao: SituacaoIntegracao
  funilId: string
  funilNome: string | null
  etapaId: string
  etapaNome: string | null
  responsavelId: string
  responsavelNome: string | null
  detalhe: string | null
  conta: string | null
  ultimaSincronizacaoEm: string | null
  proximaSincronizacaoEm: string | null
  importados: number
  existentes: number
  erros: number
  ultimoErro: string | null
  ultimoLeadEm: string | null
  numeroId: string | null
  bloqueadoPorCobranca: boolean
  limiteEnviosDia: number | null
  contaId: string | null
  planilhaId: string | null
}

export type ContaGoogle = { id: string; email: string; conectadoEm: string; ativa: boolean; ultimoErro: string | null }

export type ConsumoWhatsapp = { numeroId: string; numero: string | null; dia: string; recebidas: number; enviadasGratuitas: number; bloqueadas: number; cobrancasMeta: number }

export type ConversaOficial = {
  id: string
  numeroId: string
  numero: string | null
  telefone: string
  nomeContato: string | null
  clienteId: string | null
  clienteNome: string | null
  ultimaMensagemEm: string | null
  ultimaEntradaEm: string | null
  previa: string | null
  previaDirecao: 'entrada' | 'saida' | null
}

export type Janela = {
  aberta: boolean
  abertaAte: string | null
  motivo: 'ok' | 'fora_da_janela' | 'numero_inativo' | 'bloqueado_por_cobranca' | 'sem_numero' | 'franquia_esgotada' | 'franquia_nao_confirmada'
}

export type Falha = { ok: false; codigo: string; mensagem: string }
export type Resultado<T = object> = ({ ok: true } & T) | Falha

type ErroRpc = { code?: string; message?: string } | null
type Rpc = (nome: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: ErroRpc }>

export async function banco() {
  const supabase = await createClient()
  return { supabase, rpc: supabase.rpc.bind(supabase) as unknown as Rpc }
}

export type IntegracoesHabilitadas = { googleSheets: boolean; whatsappOficial: boolean; metaConversoes: boolean }

/**
 * Chaves da plataforma (o dono liga cada integração depois da homologação).
 * Falha fechada: se não der para ler (ex.: migration ainda não aplicada), tudo desligado.
 */
export async function integracoesHabilitadas(): Promise<IntegracoesHabilitadas> {
  const desligado = { googleSheets: false, whatsappOficial: false, metaConversoes: false }
  try {
    const { rpc } = await banco()
    const { data, error } = await rpc('integracoes_habilitadas')
    const c = (data as { google_sheets: boolean; whatsapp_oficial: boolean; meta_conversoes: boolean }[] | null)?.[0]
    if (error || !c) return desligado
    return { googleSheets: c.google_sheets === true, whatsappOficial: c.whatsapp_oficial === true, metaConversoes: c.meta_conversoes === true }
  } catch {
    return desligado
  }
}

/** Administrador da empresa (Administrador ou Super Admin em "Acessar CRM"), fora do modo somente leitura. */
export async function podeAdministrarIntegracoes(): Promise<boolean> {
  const empresa = await getEmpresaAtual()
  return (empresa.papel === 'admin_empresa' || empresa.papel === 'gerente') && !empresa.somenteLeitura
}

export async function exigirAdministrador(): Promise<Falha | null> {
  if (await podeAdministrarIntegracoes()) return null
  return { ok: false, codigo: 'sem_permissao', mensagem: 'Somente o Administrador da empresa gerencia as integrações.' }
}

/** Mensagens das NOSSAS regras do banco vão para a tela; o resto vira genérico. */
export function falhaDoBanco(error: ErroRpc, padrao: string): Falha {
  const code = error?.code ?? ''
  if (code === '42501') return { ok: false, codigo: 'sem_permissao', mensagem: error?.message ?? padrao }
  if (['P0002', '23505', '23514', '22023', '23503'].includes(code) || code.startsWith('RX')) {
    return { ok: false, codigo: code, mensagem: code === '23503' ? 'Funil, etapa ou responsável inválido para esta empresa.' : (error?.message ?? padrao) }
  }
  console.error('integrações oficiais', code)
  return { ok: false, codigo: 'interno', mensagem: padrao }
}

/** Chamada à Edge Function `integracoes/<rota>` com a sessão e a empresa da requisição. */
export async function chamarIntegracoes<T>(rota: string, corpo: Record<string, unknown> = {}): Promise<Resultado<T>> {
  const { supabase } = await banco()
  const { data, error } = await supabase.functions.invoke<Resultado<T>>(`integracoes${rota}`, { body: corpo })
  if (!error) return data ?? { ok: false, codigo: 'vazio', mensagem: 'Resposta vazia do servidor.' }
  if (error instanceof FunctionsHttpError) {
    try {
      const c = (await error.context.json()) as Partial<Falha> & Record<string, unknown>
      return { ...c, ok: false, codigo: String(c.codigo ?? 'erro'), mensagem: String(c.mensagem ?? 'Não foi possível concluir.') } as Falha
    } catch {
      // genérico abaixo
    }
  }
  console.error('integracoes', rota, error?.name)
  return { ok: false, codigo: 'indisponivel', mensagem: 'O serviço de integrações não respondeu. Tente de novo em instantes.' }
}

// ------------------------------------------------------------------ leitura
type LinhaIntegracao = {
  fonte_id: string; tipo: 'google_sheets' | 'whatsapp_cloud'; nome: string; status: string; situacao: SituacaoIntegracao
  funil_id: string; funil_nome: string | null; etapa_id: string; etapa_nome: string | null; responsavel_id: string; responsavel_nome: string | null
  detalhe: string | null; conta: string | null; ultima_sincronizacao_em: string | null; proxima_sincronizacao_em: string | null
  importados: number; existentes: number; erros: number; ultimo_erro: string | null; ultimo_lead_em: string | null
  numero_id: string | null; bloqueado_por_cobranca: boolean | null; limite_envios_dia: number | null
  conta_id: string | null; planilha_id: string | null
}

/** Integrações oficiais da empresa (só o Administrador; outros cargos recebem lista vazia). */
export async function listarIntegracoesOficiais(): Promise<IntegracaoOficial[]> {
  if (!(await podeAdministrarIntegracoes())) return []
  const { rpc } = await banco()
  const { data, error } = await rpc('integracoes_da_empresa')
  if (error) throw new Error('Não foi possível carregar as integrações.', { cause: error })
  return ((data as LinhaIntegracao[]) ?? []).map((l) => ({
    fonteId: l.fonte_id,
    tipo: l.tipo,
    nome: l.nome,
    status: l.status,
    situacao: l.situacao,
    funilId: l.funil_id,
    funilNome: l.funil_nome,
    etapaId: l.etapa_id,
    etapaNome: l.etapa_nome,
    responsavelId: l.responsavel_id,
    responsavelNome: l.responsavel_nome,
    detalhe: l.detalhe,
    conta: l.conta,
    ultimaSincronizacaoEm: l.ultima_sincronizacao_em,
    proximaSincronizacaoEm: l.proxima_sincronizacao_em,
    importados: l.importados,
    existentes: l.existentes,
    erros: l.erros,
    ultimoErro: l.ultimo_erro,
    ultimoLeadEm: l.ultimo_lead_em,
    numeroId: l.numero_id,
    bloqueadoPorCobranca: Boolean(l.bloqueado_por_cobranca),
    limiteEnviosDia: l.limite_envios_dia,
    contaId: l.conta_id,
    planilhaId: l.planilha_id,
  }))
}

export async function listarContasGoogle(): Promise<ContaGoogle[]> {
  if (!(await podeAdministrarIntegracoes())) return []
  const { rpc } = await banco()
  const { data, error } = await rpc('google_contas_da_empresa')
  if (error) throw new Error('Não foi possível carregar as contas Google.', { cause: error })
  return ((data as { id: string; conta_email: string; conectado_em: string; ativa: boolean; ultimo_erro: string | null }[]) ?? []).map((c) => ({
    id: c.id,
    email: c.conta_email,
    conectadoEm: c.conectado_em,
    ativa: c.ativa,
    ultimoErro: c.ultimo_erro,
  }))
}

export async function consumoWhatsapp(dias = 30): Promise<ConsumoWhatsapp[]> {
  if (!(await podeAdministrarIntegracoes())) return []
  const { rpc } = await banco()
  const { data, error } = await rpc('whatsapp_consumo_empresa', { p_dias: dias })
  if (error) throw new Error('Não foi possível carregar o consumo do WhatsApp.', { cause: error })
  return (
    (data as { numero_id: string; numero: string | null; dia: string; recebidas: number; enviadas_gratuitas: number; bloqueadas: number; cobrancas_meta: number }[]) ?? []
  ).map((c) => ({
    numeroId: c.numero_id,
    numero: c.numero,
    dia: c.dia,
    recebidas: c.recebidas,
    enviadasGratuitas: c.enviadas_gratuitas,
    bloqueadas: c.bloqueadas,
    cobrancasMeta: c.cobrancas_meta,
  }))
}

/** Conversas do WhatsApp oficial que este usuário atende (o banco aplica a regra da carteira). */
export async function listarConversasOficiais(limite = 100): Promise<ConversaOficial[]> {
  await getUsuarioAtual()
  const { rpc } = await banco()
  const { data, error } = await rpc('whatsapp_caixa_entrada', { p_limite: limite })
  if (error) throw new Error('Não foi possível carregar as conversas.', { cause: error })
  return (
    (data as {
      conversa_id: string; numero_id: string; numero: string | null; telefone: string; nome_contato: string | null; cliente_id: string | null
      cliente_nome: string | null; ultima_mensagem_em: string | null; ultima_entrada_em: string | null; previa: string | null; previa_direcao: 'entrada' | 'saida' | null
    }[]) ?? []
  ).map((c) => ({
    id: c.conversa_id,
    numeroId: c.numero_id,
    numero: c.numero,
    telefone: c.telefone,
    nomeContato: c.nome_contato,
    clienteId: c.cliente_id,
    clienteNome: c.cliente_nome,
    ultimaMensagemEm: c.ultima_mensagem_em,
    ultimaEntradaEm: c.ultima_entrada_em,
    previa: c.previa,
    previaDirecao: c.previa_direcao,
  }))
}

export type MensagemOficial = { id: string; direcao: 'entrada' | 'saida'; tipo: string; conteudo: string | null; status: string | null; createdAt: string }

/** Últimas mensagens da conversa (RLS de mensagens: mesma regra da carteira). */
export async function mensagensDaConversa(conversaId: string, limite = 80): Promise<MensagemOficial[]> {
  await getUsuarioAtual()
  const { supabase } = await banco()
  const { data, error } = await supabase
    .from('mensagens_visiveis')
    .select('id, direcao, tipo, conteudo, status, created_at')
    .eq('conversa_id', conversaId)
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error('Não foi possível carregar as mensagens.', { cause: error })
  // View: colunas chegam anuláveis nos tipos gerados, mas são NOT NULL na tabela.
  return (data ?? []).reverse().flatMap((m) =>
    m.id && m.direcao && m.created_at
      ? [{ id: m.id, direcao: m.direcao, tipo: m.tipo ?? 'texto', conteudo: m.conteudo, status: m.status, createdAt: m.created_at }]
      : [],
  )
}

export async function janelaDaConversa(conversaId: string): Promise<Janela | null> {
  const { rpc } = await banco()
  const { data } = await rpc('whatsapp_janela', { p_conversa: conversaId })
  const j = (data as { aberta: boolean; aberta_ate: string | null; motivo: Janela['motivo'] }[] | null)?.[0]
  return j ? { aberta: Boolean(j.aberta), abertaAte: j.aberta_ate, motivo: j.motivo } : null
}

// ------------------------------------------------------------------ escrita
export type NovaPlanilha = {
  contaId: string
  planilhaId: string
  planilhaNome: string
  abaId: number
  abaNome: string
  linhaCabecalho: number
  mapeamento: Partial<Record<'nome' | 'telefone' | 'email' | 'empresa', string>>
  colunaChave: string | null
  importarExistentes: boolean
  nome: string
  funilId: string
  etapaId: string
  responsavelId: string
}

export async function criarPlanilha(p: NovaPlanilha): Promise<Resultado<{ id: string }>> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { data, error } = await rpc('sheets_criar_fonte', {
    p_conta: p.contaId,
    p_planilha_id: p.planilhaId,
    p_planilha_nome: p.planilhaNome,
    p_aba_id: p.abaId,
    p_aba_nome: p.abaNome,
    p_linha_cabecalho: p.linhaCabecalho,
    p_mapeamento: p.mapeamento,
    p_coluna_chave: p.colunaChave,
    p_importar_existentes: p.importarExistentes,
    p_nome: p.nome,
    p_funil: p.funilId,
    p_etapa: p.etapaId,
    p_responsavel: p.responsavelId,
  })
  if (error || typeof data !== 'string') return falhaDoBanco(error, 'Não foi possível conectar a planilha.')
  return { ok: true, id: data }
}

export async function acaoPlanilha(fonteId: string, acao: 'pausar' | 'retomar' | 'reprocessar_erros' | 'remover'): Promise<Resultado> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { error } = await rpc('sheets_acao', { p_fonte: fonteId, p_acao: acao })
  return error ? falhaDoBanco(error, 'Não foi possível alterar a planilha.') : { ok: true }
}

export async function acaoWhatsapp(numeroId: string, acao: 'pausar' | 'retomar' | 'desconectar' | 'revisar_cobranca'): Promise<Resultado> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { error } = await rpc('whatsapp_acao', { p_numero: numeroId, p_acao: acao })
  return error ? falhaDoBanco(error, 'Não foi possível alterar o número.') : { ok: true }
}

export async function alterarDestino(fonteId: string, funilId: string, etapaId: string, responsavelId: string): Promise<Resultado> {
  const recusa = await exigirAdministrador()
  if (recusa) return recusa
  const { rpc } = await banco()
  const { error } = await rpc('integracao_alterar_destino', { p_fonte: fonteId, p_funil: funilId, p_etapa: etapaId, p_responsavel: responsavelId })
  return error ? falhaDoBanco(error, 'Não foi possível alterar o destino.') : { ok: true }
}

/** Situação das integrações de uma empresa no painel do Super Admin (sem segredos). */
export type IntegracaoPainel = { tipo: string; nome: string; status: string; situacao: string; ultimoErro: string | null; ultimaAtividade: string | null }

export async function integracoesDaEmpresaNoPainel(tenantId: string): Promise<IntegracaoPainel[]> {
  const { rpc } = await banco()
  const { data, error } = await rpc('admin_integracoes_empresa', { p_tenant: tenantId })
  if (error) return []
  return ((data as { tipo: string; nome: string; status: string; situacao: string; ultimo_erro: string | null; ultima_atividade: string | null }[]) ?? []).map((i) => ({
    tipo: i.tipo,
    nome: i.nome,
    status: i.status,
    situacao: i.situacao,
    ultimoErro: i.ultimo_erro,
    ultimaAtividade: i.ultima_atividade,
  }))
}
