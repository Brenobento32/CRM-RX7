/**
 * Janelas oficiais dos provedores, abertas no navegador do Administrador:
 *  - Google Picker (seletor de arquivos): com o escopo `drive.file`, o AVANTE
 *    só lê a planilha que o próprio usuário escolher aqui — o link sozinho não
 *    libera planilha privada;
 *  - Embedded Signup da Meta (cadastro do WhatsApp Business): devolve um
 *    `code` de uso único e os IDs da conta/número; a troca do code pelo token
 *    acontece SÓ no servidor (Edge Function `integracoes`).
 *
 * No ambiente local o servidor responde `simulado: true` e as mesmas funções
 * abrem as páginas simuladas do emulador (nada sai da máquina).
 *
 * Só navegador (usa `window`). Nenhum segredo passa por aqui: o token de acesso
 * do Google é curto (1 h), restrito a drive.file e não é guardado.
 */

type GooglePicker = {
  DocsView: new (viewId: unknown) => { setMode(m: unknown): unknown; setFileIds?(ids: string): unknown }
  ViewId: { SPREADSHEETS: unknown }
  DocsViewMode: { LIST: unknown }
  PickerBuilder: new () => {
    setAppId(id: string): GooglePickerBuilder
  }
  Action: { PICKED: string; CANCEL: string }
  Response: { ACTION: string; DOCUMENTS: string }
  Document: { ID: string }
}
type GooglePickerBuilder = {
  setAppId(id: string): GooglePickerBuilder
  setOAuthToken(t: string): GooglePickerBuilder
  setDeveloperKey(k: string): GooglePickerBuilder
  addView(v: unknown): GooglePickerBuilder
  setCallback(cb: (dados: Record<string, unknown>) => void): GooglePickerBuilder
  build(): { setVisible(v: boolean): void }
}
type JanelaComSdks = Window & {
  gapi?: { load(lib: string, cb: () => void): void }
  google?: { picker: GooglePicker }
  FB?: {
    init(o: Record<string, unknown>): void
    login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void
  }
}

const carregados = new Map<string, Promise<void>>()
function carregarScript(src: string): Promise<void> {
  if (!carregados.has(src)) {
    carregados.set(
      src,
      new Promise((ok, falha) => {
        const s = document.createElement('script')
        s.src = src
        s.async = true
        s.crossOrigin = 'anonymous'
        s.onload = () => ok()
        s.onerror = () => {
          carregados.delete(src)
          falha(new Error('Não foi possível carregar a janela do provedor. Confira a conexão e bloqueadores de anúncio.'))
        }
        document.head.appendChild(s)
      }),
    )
  }
  return carregados.get(src)!
}

function popup(url: string, nome: string) {
  const w = window.open(url, nome, 'width=560,height=720,noopener=no')
  if (!w) throw new Error('O navegador bloqueou a janela. Libere pop-ups para este site e tente de novo.')
  return w
}

/** Espera uma mensagem de `origem` que satisfaça `aceitar`, ou a janela fechar. */
function esperarMensagens<T>(origens: (o: string) => boolean, janela: Window | null, aceitar: (dados: unknown, acumulado: Partial<T>) => Partial<T> | 'fim' | null, pronto: (a: Partial<T>) => boolean): Promise<T | null> {
  return new Promise((resolver) => {
    let acumulado: Partial<T> = {}
    const fim = (v: T | null) => {
      window.removeEventListener('message', ouvir)
      clearInterval(vigia)
      resolver(v)
    }
    const ouvir = (ev: MessageEvent) => {
      if (!origens(ev.origin)) return
      let dados: unknown = ev.data
      if (typeof dados === 'string') {
        try {
          dados = JSON.parse(dados)
        } catch {
          return
        }
      }
      const r = aceitar(dados, acumulado)
      if (r === 'fim') return fim(null)
      if (r) acumulado = { ...acumulado, ...r }
      if (pronto(acumulado)) fim(acumulado as T)
    }
    window.addEventListener('message', ouvir)
    // Janela fechada sem concluir = cancelado (com folga para a última mensagem chegar).
    const vigia = setInterval(() => {
      if (janela?.closed) setTimeout(() => fim(pronto(acumulado) ? (acumulado as T) : null), 800)
    }, 500)
  })
}

// ------------------------------------------------------------------ Google Picker
export type AcessoSeletor = { accessToken: string; chaveApi: string; appId: string; simulado?: boolean; urlSeletor?: string }

/** Abre o seletor; devolve o ID da planilha escolhida (ou null se cancelado). */
export async function escolherPlanilhaNoGoogle(acesso: AcessoSeletor, planilhaSugerida?: string | null): Promise<string | null> {
  if (acesso.simulado && acesso.urlSeletor) {
    const u = new URL(acesso.urlSeletor)
    // Fragmento (#): não vai para servidor nem para log.
    u.hash = new URLSearchParams({ token: acesso.accessToken, ...(planilhaSugerida ? { planilha: planilhaSugerida } : {}) }).toString()
    const j = popup(u.toString(), 'seletor-google')
    const r = await esperarMensagens<{ planilhaId: string }>(
      (o) => o === u.origin,
      j,
      (d) => (d && typeof d === 'object' && (d as { origem?: string }).origem === 'seletor-google' ? { planilhaId: String((d as { planilhaId?: string }).planilhaId ?? '') } : null),
      (a) => Boolean(a.planilhaId),
    )
    return r?.planilhaId ?? null
  }

  const w = window as JanelaComSdks
  await carregarScript('https://apis.google.com/js/api.js')
  await new Promise<void>((ok) => w.gapi!.load('picker', ok))
  const g = w.google!.picker
  const visao = new g.DocsView(g.ViewId.SPREADSHEETS)
  visao.setMode(g.DocsViewMode.LIST)
  if (planilhaSugerida && visao.setFileIds) visao.setFileIds(planilhaSugerida)
  return new Promise((resolver) => {
    new g.PickerBuilder()
      .setAppId(acesso.appId)
      .setOAuthToken(acesso.accessToken)
      .setDeveloperKey(acesso.chaveApi)
      .addView(visao)
      .setCallback((dados) => {
        const acao = dados[g.Response.ACTION]
        if (acao === g.Action.PICKED) {
          const doc = (dados[g.Response.DOCUMENTS] as Record<string, string>[] | undefined)?.[0]
          resolver(doc?.[g.Document.ID] ?? null)
        } else if (acao === g.Action.CANCEL) resolver(null)
      })
      .build()
      .setVisible(true)
  })
}

// ------------------------------------------------------------------ Embedded Signup (Meta)
export type ConfigMeta = { appId: string | null; configId: string | null; simulado?: boolean; urlCadastro?: string }
export type CadastroMeta = { code: string; wabaId: string; phoneNumberId: string }

type Sessao = Partial<CadastroMeta>
function lerEventoMeta(d: unknown): Sessao | 'fim' | null {
  if (!d || typeof d !== 'object') return null
  const o = d as { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string }; origem?: string; code?: string }
  if (o.origem === 'cadastro-meta' && o.code) return { code: o.code }
  if (o.type !== 'WA_EMBEDDED_SIGNUP') return null
  if (o.event === 'CANCEL' || o.event === 'ERROR') return 'fim'
  if (o.event?.startsWith('FINISH') && o.data?.waba_id) {
    return { wabaId: String(o.data.waba_id), ...(o.data.phone_number_id ? { phoneNumberId: String(o.data.phone_number_id) } : {}) }
  }
  return null
}
const completo = (s: Sessao) => Boolean(s.code && s.wabaId && s.phoneNumberId)

/** Abre o cadastro incorporado da Meta; devolve code + IDs (ou null se cancelado). */
export async function cadastrarWhatsappNaMeta(cfg: ConfigMeta): Promise<CadastroMeta | null> {
  if (cfg.simulado && cfg.urlCadastro) {
    const origem = new URL(cfg.urlCadastro).origin
    const j = popup(cfg.urlCadastro, 'cadastro-meta')
    return esperarMensagens<CadastroMeta>((o) => o === origem, j, lerEventoMeta, completo)
  }
  if (!cfg.appId || !cfg.configId) throw new Error('O app da Meta ainda não foi configurado na plataforma.')

  const w = window as JanelaComSdks
  await carregarScript('https://connect.facebook.net/pt_BR/sdk.js')
  w.FB!.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: false, version: 'v23.0' })
  // Os IDs da conta/número chegam por mensagem da janela da Meta; o code, pelo retorno do login.
  let sessao: Sessao = {}
  let cancelado = false
  const ouvir = (ev: MessageEvent) => {
    if (ev.origin !== 'https://www.facebook.com' && ev.origin !== 'https://web.facebook.com') return
    let dados: unknown = ev.data
    try {
      dados = typeof dados === 'string' ? JSON.parse(dados) : dados
    } catch {
      return
    }
    const r = lerEventoMeta(dados)
    if (r === 'fim') cancelado = true
    else if (r) sessao = { ...sessao, ...r }
  }
  window.addEventListener('message', ouvir)
  try {
    const code = await new Promise<string | null>((ok) =>
      w.FB!.login((r) => ok(r.authResponse?.code ?? null), {
        config_id: cfg.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      }),
    )
    if (!code) return null
    sessao = { ...sessao, code }
    const limite = Date.now() + 15000
    while (!completo(sessao) && !cancelado && Date.now() < limite) await new Promise((ok) => setTimeout(ok, 250))
    return completo(sessao) ? (sessao as CadastroMeta) : null
  } finally {
    window.removeEventListener('message', ouvir)
  }
}

// ------------------------------------------------------------------ Meta Business Extension (Conversões do CRM)
export type ConfigMetaAds = { appId: string | null; idExterno: string; simulado?: boolean; urlMbe?: string }

/**
 * Janela oficial da Meta para ligar o AVANTE ao Gerenciador de Eventos da
 * empresa (canal CONVERSIONS_API). Devolve um code de uso único (ou null se
 * cancelado); o servidor troca pelo token de sistema e guarda no cofre.
 * No modo real depende da permissão `manage_business_extension` liberada pela Meta.
 */
export async function conectarMetaAds(cfg: ConfigMetaAds): Promise<string | null> {
  if (cfg.simulado && cfg.urlMbe) {
    const u = new URL(cfg.urlMbe)
    u.hash = new URLSearchParams({ externo: cfg.idExterno }).toString()
    const j = popup(u.toString(), 'mbe-meta')
    const r = await esperarMensagens<{ code: string }>(
      (o) => o === u.origin,
      j,
      (d) => {
        const o = d as { origem?: string; code?: string; cancelado?: boolean }
        if (!o || o.origem !== 'mbe-meta') return null
        return o.cancelado ? 'fim' : o.code ? { code: o.code } : null
      },
      (a) => Boolean(a.code),
    )
    return r?.code ?? null
  }
  if (!cfg.appId) throw new Error('O app da Meta ainda não foi configurado na plataforma.')
  const w = window as JanelaComSdks
  await carregarScript('https://connect.facebook.net/pt_BR/sdk.js')
  w.FB!.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: false, version: 'v23.0' })
  return new Promise<string | null>((ok) =>
    w.FB!.login((r) => ok(r.authResponse?.code ?? null), {
      scope: 'manage_business_extension',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: { external_business_id: cfg.idExterno, timezone: 'America/Sao_Paulo', currency: 'BRL', business_vertical: 'ECOMMERCE', channel: 'CONVERSIONS_API' },
        business_config: { business: { name: 'AVANTE CRM' } },
        repeat: false,
      },
    }),
  )
}
