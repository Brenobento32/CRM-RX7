/**
 * Serviço `integracoes` — Google Sheets (OAuth + sincronização) e WhatsApp
 * oficial (Embedded Signup, webhook, envio com controle de custo).
 *
 * Dependências injetadas: o MESMO código roda na Edge Function (Deno, com a
 * service_role do Supabase) e no emulador local (Node, com Google/Meta falsos).
 *
 * Regras:
 *  - empresa SEMPRE do banco (JWT + header da aba para o usuário; state OAuth
 *    gravado; phone_number_id assinado pela Meta) — nunca do corpo;
 *  - segredos (refresh token do Google, token da Meta) só saem do Vault aqui
 *    dentro, nunca vão para a resposta (exceção documentada: token de ACESSO
 *    curto do Google, escopo drive.file, entregue ao próprio Administrador só
 *    para abrir o seletor oficial do Google);
 *  - custo: quem decide se uma mensagem pode sair é o banco
 *    (whatsapp_preparar_envio), antes de qualquer chamada à Meta.
 */
import { assinarEstado, verificarEstado } from './estado-oauth.ts'
import {
  ErroGoogle,
  emailDoIdToken,
  extrairPlanilhaDoLink,
  lerLinhas,
  lerMetadados,
  mapeamentoValido,
  montarLeads,
  renovarAcesso,
  revogar,
  sugerirMapeamento,
  trocarCodigo,
  urlDeAutorizacao,
  ESCOPOS_GOOGLE_SHEETS,
  type Busca,
  type ConfigGoogle,
  type Mapeamento,
} from './google-sheets.ts'
import { assinaturaMetaValida, respostaVerificacao } from './meta.ts'
import { enviarEvento, idExternoDaEmpresa, lerInstalacao, nomeDoDataset, tokenDeSistema, type EventoFila } from './meta-conversoes.ts'
import {
  ErroMeta,
  conferirNumero,
  enviarTexto,
  extrairEventosWhatsapp,
  inscreverApp,
  lerServicoDoMes,
  telefoneParaApi,
  trocarCodigoEmbedded,
  type ConfigMeta,
} from './whatsapp-cloud.ts'

export type ErroBanco = { code?: string; message: string } | null
export type ClienteBanco = {
  rpc(nome: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: ErroBanco }>
}
export type ClienteUsuario = ClienteBanco & {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> }
}

export type Dependencias = {
  admin: ClienteBanco
  comoUsuario: (req: Request) => ClienteUsuario
  buscar: Busca
  google: (ConfigGoogle & { chaveApiPicker: string; appIdPicker: string }) | null
  meta: (ConfigMeta & { verifyToken: string }) | null
  segredoEstado: string
  segredoCron: string
  urlApp: string
}

const LIMITE_CORPO = 64 * 1024
const LINHAS_POR_RODADA = 5000
const LOTE_BANCO = 200

function json(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
const erro = (status: number, codigo: string, mensagem: string) => json(status, { ok: false, codigo, mensagem })

/** Erro do banco → HTTP. Só as mensagens das NOSSAS regras vão para a tela. */
function erroDoBanco(e: ErroBanco, padrao = 'Não foi possível concluir a operação.'): Response {
  const code = e?.code ?? ''
  const msg = e?.message ?? padrao
  if (code === '42501') return erro(403, 'sem_permissao', msg)
  if (code === 'P0002') return erro(404, 'nao_encontrado', msg)
  if (code === '23505') return erro(409, 'conflito', msg)
  if (code === 'RX010' || code === 'RX023') return erro(429, 'limite', msg)
  if (code === '22023' || code === '23514' || code.startsWith('RX')) return erro(422, 'regra', msg)
  return erro(500, 'interno', padrao)
}

async function lerCorpo(req: Request): Promise<Record<string, unknown> | null> {
  const bruto = await req.text()
  if (bruto.length > LIMITE_CORPO) return null
  try {
    const v = bruto ? JSON.parse(bruto) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)
const txt = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null)

function comparacaoSegura(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** Usuário logado + empresa da aba; o Administrador é conferido no banco. */
async function contextoAdmin(deps: Dependencias, req: Request) {
  const usuario = deps.comoUsuario(req)
  const { data: u } = await usuario.auth.getUser()
  if (!u?.user) return { resposta: erro(401, 'nao_autenticado', 'Sessão ausente ou expirada.') }
  const { data: tenant, error } = await usuario.rpc('exigir_administrador_integracoes')
  if (error || typeof tenant !== 'string') return { resposta: erroDoBanco(error, 'Somente o Administrador da empresa gerencia as integrações.') }
  return { usuario, userId: u.user.id, tenantId: tenant }
}

async function contasDaEmpresa(usuario: ClienteBanco): Promise<{ id: string; ativa: boolean }[]> {
  const { data } = await usuario.rpc('google_contas_da_empresa')
  return (data as { id: string; ativa: boolean }[] | null) ?? []
}

async function acessoGoogle(deps: Dependencias, contaId: string): Promise<string> {
  const { data: refresh } = await deps.admin.rpc('google_obter_refresh_token', { p_conta: contaId })
  if (typeof refresh !== 'string' || !refresh) {
    throw new ErroGoogle('autorizacao', 'A conta Google foi desconectada. Conecte de novo.')
  }
  return renovarAcesso(deps.buscar, deps.google!, refresh)
}

function respostaErroGoogle(e: unknown): Response {
  if (e instanceof ErroGoogle) {
    const status = e.tipo === 'autorizacao' ? 401 : e.tipo === 'sem_acesso' ? 403 : e.tipo === 'cota' ? 429 : e.tipo === 'invalido' ? 422 : 502
    return erro(status, e.tipo === 'sem_acesso' ? 'autorizar_arquivo' : `google_${e.tipo}`, e.message)
  }
  return erro(502, 'google_rede', 'Falha ao falar com o Google.')
}

// =============================================================== Google Sheets
async function googleIniciar(deps: Dependencias, req: Request): Promise<Response> {
  if (!deps.google) return erro(503, 'nao_configurado', 'A integração com o Google ainda não foi configurada na plataforma.')
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const corpo = (await lerCorpo(req)) ?? {}
  const retorno = txt(corpo.retorno, 200)
  const { data: nonce, error } = await ctx.usuario.rpc('integracao_criar_estado', { p_provedor: 'google', p_retorno: retorno })
  if (error || typeof nonce !== 'string') return erroDoBanco(error)
  const state = await assinarEstado(deps.segredoEstado, { n: nonce, t: ctx.tenantId })
  return json(200, { ok: true, url: urlDeAutorizacao(deps.google, state) })
}

async function googleCallback(deps: Dependencias, url: URL): Promise<Response> {
  const voltar = (retorno: string, params: Record<string, string>) => {
    // Só caminho interno do AVANTE ("//outro-site" seria redirecionamento aberto).
    const interno = /^\/[A-Za-z0-9_-][A-Za-z0-9/_?=&.-]*$/.test(retorno) && !retorno.includes('//')
    const destino = new URL(interno ? retorno : '/configuracoes/integracoes', deps.urlApp)
    for (const [k, v] of Object.entries(params)) destino.searchParams.set(k, v)
    return new Response(null, { status: 302, headers: { Location: destino.toString(), 'Cache-Control': 'no-store' } })
  }
  if (!deps.google) return voltar('/configuracoes/integracoes', { google: 'erro', motivo: 'nao_configurado' })
  const assinado = await verificarEstado(deps.segredoEstado, url.searchParams.get('state') ?? '')
  if (!assinado) return voltar('/configuracoes/integracoes', { google: 'erro', motivo: 'estado_invalido' })
  const { data: estados } = await deps.admin.rpc('integracao_consumir_estado', { p_nonce: assinado.n })
  const estado = (estados as { tenant_id: string; usuario_id: string; provedor: string; retorno: string }[] | null)?.[0]
  if (!estado || estado.tenant_id !== assinado.t || estado.provedor !== 'google') {
    return voltar('/configuracoes/integracoes', { google: 'erro', motivo: 'estado_expirado' })
  }
  if (url.searchParams.get('error')) return voltar(estado.retorno, { google: 'cancelado' })
  const code = url.searchParams.get('code')
  if (!code) return voltar(estado.retorno, { google: 'erro', motivo: 'sem_codigo' })
  try {
    const tokens = await trocarCodigo(deps.buscar, deps.google, code)
    const escopos = (tokens.scope ?? '').split(' ').filter(Boolean)
    if (!escopos.includes('https://www.googleapis.com/auth/drive.file')) {
      if (tokens.refresh_token) await revogar(deps.buscar, deps.google, tokens.refresh_token)
      return voltar(estado.retorno, { google: 'erro', motivo: 'permissao_negada' })
    }
    const email = emailDoIdToken(tokens.id_token)
    if (!email || !tokens.refresh_token) return voltar(estado.retorno, { google: 'erro', motivo: 'sem_refresh' })
    const { data: contaId, error } = await deps.admin.rpc('google_salvar_conta', {
      p_tenant: estado.tenant_id,
      p_usuario: estado.usuario_id,
      p_email: email,
      p_refresh_token: tokens.refresh_token,
      p_escopos: escopos,
    })
    if (error || typeof contaId !== 'string') {
      await revogar(deps.buscar, deps.google, tokens.refresh_token)
      return voltar(estado.retorno, { google: 'erro', motivo: 'nao_salvo' })
    }
    return voltar(estado.retorno, { google: 'conectado', conta: contaId })
  } catch {
    return voltar(estado.retorno, { google: 'erro', motivo: 'google_recusou' })
  }
}

async function googleAcessoSeletor(deps: Dependencias, req: Request): Promise<Response> {
  if (!deps.google) return erro(503, 'nao_configurado', 'Google não configurado.')
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const conta = uuid(((await lerCorpo(req)) ?? {}).conta)
  if (!conta || !(await contasDaEmpresa(ctx.usuario)).some((c) => c.id === conta && c.ativa)) {
    return erro(404, 'nao_encontrado', 'Conta Google não encontrada nesta empresa.')
  }
  try {
    const accessToken = await acessoGoogle(deps, conta)
    // Token de ACESSO curto (1 h, escopo drive.file) só para o seletor oficial do Google.
    return json(200, { ok: true, accessToken, chaveApi: deps.google.chaveApiPicker, appId: deps.google.appIdPicker, escopo: ESCOPOS_GOOGLE_SHEETS[2] })
  } catch (e) {
    return respostaErroGoogle(e)
  }
}

async function googlePlanilha(deps: Dependencias, req: Request): Promise<Response> {
  if (!deps.google) return erro(503, 'nao_configurado', 'Google não configurado.')
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const corpo = (await lerCorpo(req)) ?? {}
  const conta = uuid(corpo.conta)
  const alvo = extrairPlanilhaDoLink(String(corpo.link ?? ''))
  if (!alvo) return erro(422, 'link_invalido', 'Cole o link de uma planilha do Google Sheets (docs.google.com/spreadsheets/...).')
  if (!conta || !(await contasDaEmpresa(ctx.usuario)).some((c) => c.id === conta && c.ativa)) {
    return erro(404, 'nao_encontrado', 'Conta Google não encontrada nesta empresa.')
  }
  try {
    const token = await acessoGoogle(deps, conta)
    const meta = await lerMetadados(deps.buscar, deps.google, token, alvo.planilhaId)
    return json(200, { ok: true, planilhaId: alvo.planilhaId, titulo: meta.titulo, abas: meta.abas, abaSugerida: alvo.gid })
  } catch (e) {
    const r = respostaErroGoogle(e)
    if (r.status === 403) return json(403, { ok: false, codigo: 'autorizar_arquivo', planilhaId: alvo.planilhaId, mensagem: (e as Error).message })
    return r
  }
}

async function googleColunas(deps: Dependencias, req: Request): Promise<Response> {
  if (!deps.google) return erro(503, 'nao_configurado', 'Google não configurado.')
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const corpo = (await lerCorpo(req)) ?? {}
  const conta = uuid(corpo.conta)
  const planilha = extrairPlanilhaDoLink(String(corpo.planilhaId ?? ''))
  const aba = txt(corpo.aba, 100)
  const linhaCabecalho = Number.isInteger(corpo.linhaCabecalho) ? Math.min(Math.max(Number(corpo.linhaCabecalho), 1), 50) : 1
  if (!conta || !planilha || !aba) return erro(422, 'dados_invalidos', 'Escolha a planilha e a aba.')
  if (!(await contasDaEmpresa(ctx.usuario)).some((c) => c.id === conta && c.ativa)) return erro(404, 'nao_encontrado', 'Conta Google não encontrada.')
  try {
    const token = await acessoGoogle(deps, conta)
    const { cabecalho, linhas } = await lerLinhas(deps.buscar, deps.google, token, planilha.planilhaId, aba, linhaCabecalho, 5)
    if (!cabecalho.some(Boolean)) return erro(422, 'sem_cabecalho', `A linha ${linhaCabecalho} da aba está vazia: ela precisa ter os nomes das colunas.`)
    const sugestao = sugerirMapeamento(cabecalho)
    return json(200, { ok: true, cabecalho, amostra: linhas.slice(0, 3).map((l) => l.valores), ...sugestao })
  } catch (e) {
    return respostaErroGoogle(e)
  }
}

async function googleDesconectar(deps: Dependencias, req: Request): Promise<Response> {
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const conta = uuid(((await lerCorpo(req)) ?? {}).conta)
  if (!conta) return erro(422, 'dados_invalidos', 'Conta inválida.')
  const { error } = await ctx.usuario.rpc('google_preparar_desconexao', { p_conta: conta })
  if (error) return erroDoBanco(error)
  const { data: refresh } = await deps.admin.rpc('google_obter_refresh_token', { p_conta: conta })
  if (deps.google && typeof refresh === 'string') await revogar(deps.buscar, deps.google, refresh)
  const { error: e2 } = await deps.admin.rpc('google_remover_conta', { p_conta: conta, p_usuario: ctx.userId })
  return e2 ? erroDoBanco(e2) : json(200, { ok: true })
}

type Reservada = {
  fonte_id: string
  conta_id: string
  planilha_id: string
  aba_nome: string
  linha_cabecalho: number
  mapeamento: Mapeamento
  coluna_chave: string | null
  primeira: boolean
}

/** Uma rodada da fila: reserva (lease + SKIP LOCKED), lê, deduplica, registra. */
export async function processarFila(deps: Dependencias, opcoes: { limite?: number; fonte?: string | null } = {}) {
  const resumo: Record<string, unknown>[] = []
  if (!deps.google) return resumo
  const { data, error } = await deps.admin.rpc('sheets_reservar', { p_limite: opcoes.limite ?? 5, p_lease_segundos: 300, p_fonte: opcoes.fonte ?? null })
  if (error) throw new Error('Falha ao reservar a fila de planilhas.')
  const acessos = new Map<string, string>()
  for (const f of (data as Reservada[] | null) ?? []) {
    try {
      let token = acessos.get(f.conta_id)
      if (!token) {
        token = await acessoGoogle(deps, f.conta_id)
        acessos.set(f.conta_id, token)
      }
      const { cabecalho, linhas } = await lerLinhas(deps.buscar, deps.google, token, f.planilha_id, f.aba_nome, f.linha_cabecalho, LINHAS_POR_RODADA)
      const invalido = mapeamentoValido(f.mapeamento, cabecalho)
      if (invalido) throw new ErroGoogle('invalido', `Colunas mudaram na planilha: ${invalido} Ajuste o mapeamento.`)
      const { leads } = await montarLeads(cabecalho, linhas, f.mapeamento, f.coluna_chave)
      const total: Record<string, number> = {}
      for (let i = 0; i < Math.max(leads.length, 1); i += LOTE_BANCO) {
        const lote = leads.slice(i, i + LOTE_BANCO)
        if (lote.length === 0 && !f.primeira) break
        const { data: r, error: e } = await deps.admin.rpc('sheets_processar_linhas', { p_fonte: f.fonte_id, p_linhas: lote, p_primeira: f.primeira })
        if (e) throw new Error('Falha ao registrar as linhas.')
        for (const [k, v] of Object.entries((r as Record<string, number>) ?? {})) total[k] = (total[k] ?? 0) + v
      }
      await deps.admin.rpc('sheets_concluir', { p_fonte: f.fonte_id, p_ok: true, p_erro: null, p_linhas_lidas: linhas.length, p_autorizacao: false })
      resumo.push({ fonte: f.fonte_id, ok: true, linhas: linhas.length, ...total })
    } catch (e) {
      const autorizacao = e instanceof ErroGoogle && e.tipo === 'autorizacao'
      const mensagem = e instanceof Error ? e.message : 'Falha inesperada.'
      if (autorizacao) await deps.admin.rpc('google_registrar_erro_conta', { p_conta: f.conta_id, p_erro: mensagem })
      await deps.admin.rpc('sheets_concluir', { p_fonte: f.fonte_id, p_ok: false, p_erro: mensagem, p_linhas_lidas: null, p_autorizacao: autorizacao })
      resumo.push({ fonte: f.fonte_id, ok: false, erro: mensagem })
    }
  }
  return resumo
}

async function googleSincronizarAgora(deps: Dependencias, req: Request): Promise<Response> {
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const fonte = uuid(((await lerCorpo(req)) ?? {}).fonte)
  if (!fonte) return erro(422, 'dados_invalidos', 'Planilha inválida.')
  const { error } = await ctx.usuario.rpc('sheets_acao', { p_fonte: fonte, p_acao: 'sincronizar_agora' })
  if (error) return erroDoBanco(error)
  const resumo = await processarFila(deps, { limite: 1, fonte })
  return json(200, { ok: true, resultado: resumo[0] ?? { fonte, ok: true, emAndamento: true } })
}

/**
 * Franquia gratuita do WhatsApp: confere com a Meta quantas mensagens de serviço
 * o número já usou no mês. Sem confirmação recente, o banco bloqueia os envios.
 */
export async function reconciliarFranquias(deps: Dependencias, limite = 10) {
  const resumo: Record<string, unknown>[] = []
  if (!deps.meta) return resumo
  const { data, error } = await deps.admin.rpc('whatsapp_numeros_para_reconciliar', { p_limite: limite })
  if (error) return resumo
  type N = { numero_id: string; waba_id: string; numero_exibicao: string | null; mes: string; inicio_unix: number; fim_unix: number }
  for (const n of (data as N[] | null) ?? []) {
    try {
      const { data: cred } = await deps.admin.rpc('whatsapp_obter_token', { p_numero: n.numero_id })
      const token = (cred as { token: string }[] | null)?.[0]?.token
      if (!token) throw new ErroMeta('sem_token', 'Número sem credencial.')
      const usadas = await lerServicoDoMes(deps.buscar, deps.meta, token, n.waba_id, n.numero_exibicao, Number(n.inicio_unix), Number(n.fim_unix))
      await deps.admin.rpc('whatsapp_reconciliar_franquia', { p_numero: n.numero_id, p_mes: n.mes, p_utilizadas: usadas })
      resumo.push({ numero: n.numero_id, ok: true, usadas })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao consultar a Meta.'
      await deps.admin.rpc('whatsapp_reconciliar_erro', { p_numero: n.numero_id, p_erro: msg })
      resumo.push({ numero: n.numero_id, ok: false })
    }
  }
  return resumo
}

async function cron(deps: Dependencias, req: Request): Promise<Response> {
  if (!comparacaoSegura(req.headers.get('x-cron-secret') ?? '', deps.segredoCron)) return erro(401, 'nao_autorizado', 'Não autorizado.')
  const resumo = await processarFila(deps, { limite: 10 })
  const franquias = await reconciliarFranquias(deps)
  const conversoes = await processarConversoes(deps)
  return json(200, { ok: true, processadas: resumo.length, resumo, franquias, conversoes })
}

// =============================================================== WhatsApp
async function whatsappConfig(deps: Dependencias, req: Request): Promise<Response> {
  // Chave da plataforma para a empresa da aba (global ou liberação de homologação):
  // desligada = indisponível, mesmo com o app da Meta configurado.
  const { data: chaves } = await deps.comoUsuario(req).rpc('integracoes_habilitadas')
  const ligada = (chaves as { whatsapp_oficial: boolean }[] | null)?.[0]?.whatsapp_oficial === true
  const disponivel = ligada && Boolean(deps.meta?.appId && deps.meta?.configId)
  return json(200, { ok: true, disponivel, appId: disponivel ? deps.meta!.appId : null, configId: disponivel ? deps.meta!.configId : null })
}

async function whatsappConcluir(deps: Dependencias, req: Request): Promise<Response> {
  if (!deps.meta?.appId || !deps.meta.appSecret) return erro(503, 'nao_configurado', 'A integração com a Meta ainda não foi configurada na plataforma.')
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return ctx.resposta!
  const c = (await lerCorpo(req)) ?? {}
  const code = txt(c.code, 2000)
  const waba = txt(c.wabaId, 30)
  const phone = txt(c.phoneNumberId, 30)
  const funil = uuid(c.funil)
  const etapa = uuid(c.etapa)
  const responsavel = uuid(c.responsavel)
  if (!code || !waba || !/^\d{5,30}$/.test(waba) || !phone || !/^\d{5,30}$/.test(phone) || !funil || !etapa || !responsavel) {
    return erro(422, 'dados_invalidos', 'Conclua a autorização da Meta e escolha funil, etapa e responsável.')
  }
  try {
    const token = await trocarCodigoEmbedded(deps.buscar, deps.meta, code)
    const numero = await conferirNumero(deps.buscar, deps.meta, token, waba, phone)
    await inscreverApp(deps.buscar, deps.meta, token, waba)
    const { data: numeroId, error } = await deps.admin.rpc('whatsapp_salvar_numero', {
      p_tenant: ctx.tenantId,
      p_usuario: ctx.userId,
      p_phone_number_id: phone,
      p_waba_id: waba,
      p_numero_exibicao: numero.numeroExibicao,
      p_nome_verificado: numero.nomeVerificado,
      p_token: token,
      p_nome: txt(c.nome, 80) ?? `WhatsApp ${numero.numeroExibicao ?? ''}`.trim(),
      p_funil: funil,
      p_etapa: etapa,
      p_responsavel: responsavel,
    })
    if (error) return erroDoBanco(error)
    return json(200, { ok: true, numero: numeroId, numeroExibicao: numero.numeroExibicao, nomeVerificado: numero.nomeVerificado })
  } catch (e) {
    if (e instanceof ErroMeta) return erro(502, `meta_${e.codigo}`, e.message)
    return erro(502, 'meta_rede', 'Falha ao falar com a Meta.')
  }
}

async function whatsappWebhook(deps: Dependencias, req: Request, url: URL): Promise<Response> {
  if (!deps.meta) return erro(503, 'nao_configurado', 'Meta não configurada.')
  if (req.method === 'GET') {
    const desafio = respostaVerificacao(url.searchParams, deps.meta.verifyToken)
    return desafio ? new Response(desafio, { status: 200 }) : erro(403, 'verificacao', 'Verificação recusada.')
  }
  const bruto = await req.text()
  if (bruto.length > 512 * 1024) return erro(413, 'grande_demais', 'Evento grande demais.')
  if (!(await assinaturaMetaValida(deps.meta.appSecret, bruto, req.headers.get('x-hub-signature-256')))) {
    return erro(401, 'assinatura_invalida', 'Assinatura inválida.')
  }
  let corpo: unknown
  try {
    corpo = JSON.parse(bruto)
  } catch {
    return erro(400, 'json', 'JSON inválido.')
  }
  const { mensagens, status } = extrairEventosWhatsapp(corpo)
  let falhou = false
  for (const m of mensagens) {
    const { error } = await deps.admin.rpc('whatsapp_registrar_entrada', {
      p_phone_number_id: m.phoneNumberId,
      p_wa_message_id: m.waMessageId,
      p_de: m.de,
      p_nome: m.nome,
      p_tipo: m.tipo,
      p_texto: m.texto,
      p_recebida_em: m.recebidaEm,
      p_referral: m.referral,
    })
    if (error && error.code !== '22023') falhou = true
  }
  for (const s of status) {
    const { error } = await deps.admin.rpc('whatsapp_registrar_status', {
      p_phone_number_id: s.phoneNumberId,
      p_wa_message_id: s.waMessageId,
      p_status: s.status,
      p_cobravel: s.cobravel,
      p_categoria: s.categoria,
      p_erro: s.erro,
      p_tipo_preco: s.tipoPreco,
    })
    if (error) falhou = true
  }
  // 500 faz a Meta reenviar; a gravação é idempotente pelo ID da mensagem.
  return falhou ? erro(500, 'reenviar', 'Falha temporária.') : json(200, { ok: true, mensagens: mensagens.length, status: status.length })
}

async function whatsappEnviar(deps: Dependencias, req: Request): Promise<Response> {
  const usuario = deps.comoUsuario(req)
  const { data: u } = await usuario.auth.getUser()
  if (!u?.user) return erro(401, 'nao_autenticado', 'Sessão ausente ou expirada.')
  const c = (await lerCorpo(req)) ?? {}
  const conversa = uuid(c.conversa)
  const texto = typeof c.texto === 'string' ? c.texto : ''
  if (!conversa) return erro(422, 'dados_invalidos', 'Conversa inválida.')
  // O BANCO decide: permissão, janela gratuita de 24 h, limite diário, bloqueio por cobrança.
  const { data, error } = await usuario.rpc('whatsapp_preparar_envio', { p_conversa: conversa, p_texto: texto })
  if (error) return erroDoBanco(error)
  const envio = (data as { mensagem_id: string | null; numero_id: string; phone_number_id: string | null; destino: string | null; bloqueio: string | null; mensagem: string | null }[] | null)?.[0]
  if (!envio) return erro(500, 'interno', 'Envio não preparado.')
  // Bloqueado pelo controle de custo: nada vai para a Meta.
  if (envio.bloqueio || !envio.mensagem_id || !envio.phone_number_id || !envio.destino) {
    return erro(envio.bloqueio === 'limite_diario' ? 429 : 422, envio.bloqueio ?? 'bloqueado', envio.mensagem ?? 'Envio bloqueado.')
  }
  const { data: cred } = await deps.admin.rpc('whatsapp_obter_token', { p_numero: envio.numero_id })
  const token = (cred as { token: string }[] | null)?.[0]?.token
  const para = telefoneParaApi(envio.destino)
  if (!deps.meta || !token || !para) {
    await deps.admin.rpc('whatsapp_confirmar_envio', { p_mensagem: envio.mensagem_id, p_wa_message_id: null, p_ok: false, p_erro: 'Número sem credencial válida.' })
    return erro(503, 'sem_credencial', 'O número não está pronto para enviar (credencial ausente).')
  }
  try {
    const waId = await enviarTexto(deps.buscar, deps.meta, token, envio.phone_number_id, para, texto.trim())
    await deps.admin.rpc('whatsapp_confirmar_envio', { p_mensagem: envio.mensagem_id, p_wa_message_id: waId, p_ok: true, p_erro: null })
    return json(200, { ok: true, mensagem: envio.mensagem_id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha no envio.'
    await deps.admin.rpc('whatsapp_confirmar_envio', { p_mensagem: envio.mensagem_id, p_wa_message_id: null, p_ok: false, p_erro: msg })
    return erro(502, 'meta_envio', msg)
  }
}

// =============================================================== Meta Ads — Conversões do CRM
type ContextoAdmin = { usuario: ClienteUsuario; userId: string; tenantId: string }

async function capiContexto(deps: Dependencias, req: Request): Promise<{ resposta: Response } | ContextoAdmin> {
  const ctx = await contextoAdmin(deps, req)
  if ('resposta' in ctx) return { resposta: ctx.resposta! }
  // O banco confere a chave da plataforma (RX030) e o plano (RX003).
  const { error } = await ctx.usuario.rpc('capi_exigir')
  if (error?.code === 'RX003') return { resposta: erro(403, 'plano', error.message) }
  if (error) return { resposta: erroDoBanco(error) }
  return ctx as ContextoAdmin
}

async function metaAdsConfig(deps: Dependencias, req: Request): Promise<Response> {
  const ctx = await capiContexto(deps, req)
  if ('resposta' in ctx) return ctx.resposta
  return json(200, {
    ok: true,
    disponivel: Boolean(deps.meta?.appId && deps.meta.appSecret),
    appId: deps.meta?.appId ?? null,
    idExterno: await idExternoDaEmpresa(deps.segredoEstado, ctx.tenantId),
  })
}

/** Code da janela da Meta (MBE) → instalação desta empresa → token de sistema no cofre. */
async function metaAdsConcluir(deps: Dependencias, req: Request): Promise<Response> {
  if (!deps.meta?.appId || !deps.meta.appSecret) return erro(503, 'nao_configurado', 'A integração com a Meta ainda não foi configurada na plataforma.')
  const ctx = await capiContexto(deps, req)
  if ('resposta' in ctx) return ctx.resposta
  const code = txt(((await lerCorpo(req)) ?? {}).code, 2000)
  if (!code) return erro(422, 'dados_invalidos', 'Conclua a autorização na janela da Meta.')
  try {
    const idExterno = await idExternoDaEmpresa(deps.segredoEstado, ctx.tenantId)
    const tokenUsuario = await trocarCodigoEmbedded(deps.buscar, deps.meta, code)
    // A instalação é procurada pelo ID externo DESTA empresa: outra empresa não consegue trazer o dataset dela para cá.
    const inst = await lerInstalacao(deps.buscar, deps.meta.graphUrl, tokenUsuario, idExterno)
    const tokenSistema = await tokenDeSistema(deps.buscar, deps.meta.graphUrl, tokenUsuario, deps.meta.appSecret, inst.businessId, idExterno)
    const nome = await nomeDoDataset(deps.buscar, deps.meta.graphUrl, tokenSistema, inst.datasetId)
    const { error } = await deps.admin.rpc('capi_salvar_conexao', {
      p_tenant: ctx.tenantId,
      p_usuario: ctx.userId,
      p_business_id: inst.businessId,
      p_dataset_id: inst.datasetId,
      p_dataset_nome: nome,
      p_token: tokenSistema,
    })
    if (error) return erroDoBanco(error)
    return json(200, { ok: true, datasetId: inst.datasetId, datasetNome: nome })
  } catch (e) {
    if (e instanceof ErroMeta) return erro(502, `meta_${e.codigo}`, e.message)
    return erro(502, 'meta', e instanceof Error ? e.message : 'Falha ao falar com a Meta.')
  }
}

/** Fila de conversões: lote com lease; por conexão, para no primeiro aviso de limite da API. */
export async function processarConversoes(deps: Dependencias, limite = 50) {
  const resumo = { enviados: 0, rejeitados: 0, adiados: 0 }
  if (!deps.meta?.appSecret) return resumo
  const { data, error } = await deps.admin.rpc('capi_reservar', { p_limite: limite })
  if (error) return resumo
  const tokens = new Map<string, string | null>()
  const pausadas = new Set<string>()
  for (const ev of (data as EventoFila[] | null) ?? []) {
    if (pausadas.has(ev.conexao_id)) {
      await deps.admin.rpc('capi_concluir', { p_evento: ev.evento_id, p_resultado: 'temporario', p_erro: 'Limite da API da Meta: nova tentativa mais tarde.', p_fbtrace: null })
      resumo.adiados++
      continue
    }
    if (!tokens.has(ev.conexao_id)) {
      const { data: t } = await deps.admin.rpc('capi_obter_token', { p_conexao: ev.conexao_id })
      tokens.set(ev.conexao_id, typeof t === 'string' && t ? t : null)
    }
    const token = tokens.get(ev.conexao_id)
    const r = token
      ? await enviarEvento(deps.buscar, deps.meta.graphUrl, token, deps.meta.appSecret, ev)
      : { resultado: 'autorizacao' as const, erro: 'Conexão sem credencial.', fbtrace: null }
    if (r.resultado === 'limite' || r.resultado === 'autorizacao') pausadas.add(ev.conexao_id)
    await deps.admin.rpc('capi_concluir', {
      p_evento: ev.evento_id,
      p_resultado: r.resultado === 'limite' ? 'temporario' : r.resultado,
      p_erro: r.erro,
      p_fbtrace: r.fbtrace,
    })
    if (r.resultado === 'ok') resumo.enviados++
    else if (r.resultado === 'permanente') resumo.rejeitados++
    else resumo.adiados++
  }
  return resumo
}

// =============================================================== roteador
export async function tratarIntegracoes(req: Request, deps: Dependencias): Promise<Response> {
  const url = new URL(req.url)
  const rota = url.pathname.replace(/^.*\/integracoes/, '') || '/'
  try {
    if (rota === '/google/callback' && req.method === 'GET') return await googleCallback(deps, url)
    if (rota === '/whatsapp/webhook' && (req.method === 'GET' || req.method === 'POST')) return await whatsappWebhook(deps, req, url)
    if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')
    switch (rota) {
      case '/google/iniciar':
        return await googleIniciar(deps, req)
      case '/google/acesso-seletor':
        return await googleAcessoSeletor(deps, req)
      case '/google/planilha':
        return await googlePlanilha(deps, req)
      case '/google/colunas':
        return await googleColunas(deps, req)
      case '/google/sincronizar':
        return await googleSincronizarAgora(deps, req)
      case '/google/desconectar':
        return await googleDesconectar(deps, req)
      case '/cron':
        return await cron(deps, req)
      case '/whatsapp/config':
        return await whatsappConfig(deps, req)
      case '/whatsapp/concluir':
        return await whatsappConcluir(deps, req)
      case '/whatsapp/enviar':
        return await whatsappEnviar(deps, req)
      case '/meta-ads/config':
        return await metaAdsConfig(deps, req)
      case '/meta-ads/concluir':
        return await metaAdsConcluir(deps, req)
      default:
        return erro(404, 'rota', 'Rota desconhecida.')
    }
  } catch {
    return erro(500, 'interno', 'Erro inesperado nas integrações.')
  }
}
