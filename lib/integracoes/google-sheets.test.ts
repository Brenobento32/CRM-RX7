import { describe, expect, it } from 'vitest'

import {
  ErroGoogle,
  emailDoIdToken,
  extrairPlanilhaDoLink,
  lerLinhas,
  lerMetadados,
  mapeamentoValido,
  montarLeads,
  renovarAcesso,
  sugerirMapeamento,
  urlDeAutorizacao,
  type ConfigGoogle,
} from '../../supabase/functions/_shared/google-sheets.ts'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc'
const cfg: ConfigGoogle = {
  clientId: 'cliente.apps.googleusercontent.com',
  clientSecret: 'segredo',
  redirectUri: 'https://exemplo.supabase.co/functions/v1/integracoes/google/callback',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  sheetsUrl: 'https://sheets.googleapis.com/v4',
}
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status })

describe('link da planilha', () => {
  it('aceita link do Google Sheets (com e sem gid) e o ID puro', () => {
    expect(extrairPlanilhaDoLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`)).toEqual({ planilhaId: ID, gid: 123 })
    expect(extrairPlanilhaDoLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7#gid=7`)).toEqual({ planilhaId: ID, gid: 7 })
    expect(extrairPlanilhaDoLink(`https://docs.google.com/spreadsheets/d/${ID}`)).toEqual({ planilhaId: ID, gid: null })
    expect(extrairPlanilhaDoLink(`  ${ID}  `)).toEqual({ planilhaId: ID, gid: null })
  })

  it('recusa outros domínios, http e documentos que não são planilhas', () => {
    expect(extrairPlanilhaDoLink(`http://docs.google.com/spreadsheets/d/${ID}/edit`)).toBeNull()
    expect(extrairPlanilhaDoLink(`https://docs.google.com.evil.com/spreadsheets/d/${ID}/edit`)).toBeNull()
    expect(extrairPlanilhaDoLink(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull()
    expect(extrairPlanilhaDoLink('nada')).toBeNull()
    expect(extrairPlanilhaDoLink('')).toBeNull()
  })
})

describe('OAuth do Google', () => {
  it('pede só openid, email e drive.file, com acesso offline e state', () => {
    const u = new URL(urlDeAutorizacao(cfg, 'estado-assinado'))
    expect(u.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/drive.file')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('state')).toBe('estado-assinado')
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.redirectUri)
    expect(u.searchParams.get('scope')).not.toContain('spreadsheets')
  })

  it('lê o e-mail verificado do id_token', () => {
    const corpo = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    expect(emailDoIdToken(`x.${corpo({ email: 'Admin@Empresa.com', email_verified: true })}.y`)).toBe('admin@empresa.com')
    expect(emailDoIdToken(`x.${corpo({ email: 'a@b.com', email_verified: false })}.y`)).toBeNull()
    expect(emailDoIdToken('quebrado')).toBeNull()
    expect(emailDoIdToken(undefined)).toBeNull()
  })

  it('invalid_grant vira erro de autorização (reconectar), não erro genérico', async () => {
    const buscar = async () => resposta(400, { error: 'invalid_grant' })
    await expect(renovarAcesso(buscar, cfg, 'r')).rejects.toMatchObject({ tipo: 'autorizacao' })
    const ok = async () => resposta(200, { access_token: 'novo' })
    expect(await renovarAcesso(ok, cfg, 'r')).toBe('novo')
  })
})

describe('Sheets API', () => {
  it('403/404 pede autorização do arquivo; 429 é cota; 401 é autorização', async () => {
    for (const [status, tipo] of [
      [403, 'sem_acesso'],
      [404, 'sem_acesso'],
      [429, 'cota'],
      [401, 'autorizacao'],
      [500, 'rede'],
    ] as const) {
      const e = await lerMetadados(async () => resposta(status, {}), cfg, 't', ID).catch((x) => x)
      expect(e).toBeInstanceOf(ErroGoogle)
      expect(e.tipo).toBe(tipo)
    }
  })

  it('lê abas e linhas com faixa entre aspas e numeração real da linha', async () => {
    const pedidas: string[] = []
    const buscar = async (url: string) => {
      pedidas.push(url)
      if (url.includes('/values/'))
        return resposta(200, { values: [['Nome', 'Telefone'], ['Ana', '11 99999-0001'], [], ['Bia', '11 99999-0002']] })
      return resposta(200, { properties: { title: 'Leads' }, sheets: [{ properties: { sheetId: 0, title: "Página 1's", gridProperties: { rowCount: 10, columnCount: 3 } } }] })
    }
    const meta = await lerMetadados(buscar, cfg, 't', ID)
    expect(meta).toEqual({ titulo: 'Leads', abas: [{ id: 0, titulo: "Página 1's", linhas: 10, colunas: 3 }] })
    const r = await lerLinhas(buscar, cfg, 't', ID, "Página 1's", 2, 100)
    expect(decodeURIComponent(pedidas[1])).toContain("'Página 1''s'!A2:AZ102")
    expect(r.cabecalho).toEqual(['Nome', 'Telefone'])
    expect(r.linhas.map((l) => l.numero)).toEqual([3, 4, 5])
  })
})

describe('mapeamento de colunas', () => {
  it('sugere nome, telefone, e-mail e a coluna identificadora', () => {
    const s = sugerirMapeamento(['Carimbo de data/hora', 'Nome completo', 'WhatsApp', 'E-mail', 'Empresa'])
    expect(s.mapeamento).toEqual({ nome: 'Nome completo', telefone: 'WhatsApp', email: 'E-mail', empresa: 'Empresa' })
    expect(s.chave).toBe('Carimbo de data/hora')
  })

  it('exige telefone ou e-mail e colunas existentes', () => {
    expect(mapeamentoValido({ nome: 'Nome' }, ['Nome'])).toMatch(/Telefone ou de E-mail/)
    expect(mapeamentoValido({ telefone: 'Fone' }, ['Telefone'])).toMatch(/não existe/)
    expect(mapeamentoValido({ telefone: 'Telefone' }, ['Telefone'])).toBeNull()
  })
})

describe('chave estável (idempotência)', () => {
  const cab = ['ID', 'Nome', 'Telefone', 'Email']
  const m = { nome: 'Nome', telefone: 'Telefone', email: 'Email' }
  const linhas = [
    { numero: 2, valores: ['10', 'Ana', '(11) 99999-0001', 'ana@x.com'] },
    { numero: 3, valores: ['11', 'Bia', '11999990002', ''] },
    { numero: 4, valores: ['', '', '', ''] },
  ]

  it('com coluna identificadora: a chave é o ID, não a linha', async () => {
    const { leads, vazias } = await montarLeads(cab, linhas, m, 'ID')
    expect(leads.map((l) => l.chave)).toEqual(['id:10', 'id:11'])
    expect(vazias).toBe(1)
    const reordenadas = [linhas[1], { ...linhas[0], numero: 9 }]
    expect((await montarLeads(cab, reordenadas, m, 'ID')).leads.map((l) => l.chave).sort()).toEqual(['id:10', 'id:11'])
  })

  it('sem coluna identificadora: impressão digital do contato, imune a reordenar/inserir/apagar linhas', async () => {
    const a = (await montarLeads(cab, linhas, m, null)).leads
    const inserida = [{ numero: 2, valores: ['', 'Nova', '21988887777', ''] }, ...linhas.map((l) => ({ ...l, numero: l.numero + 1 }))]
    const b = (await montarLeads(cab, inserida, m, null)).leads
    expect(b.filter((l) => a.some((x) => x.chave === l.chave)).length).toBe(2)
    // formatação do telefone e caixa do e-mail não mudam a chave
    const formatada = [{ numero: 2, valores: ['', 'ANA', '11 99999 0001', 'ANA@X.COM'] }]
    expect((await montarLeads(cab, formatada, m, null)).leads[0].chave).toBe(a[0].chave)
  })

  it('a mesma chave duas vezes na leitura entra uma vez só', async () => {
    const dup = [linhas[0], { ...linhas[0], numero: 8 }]
    expect((await montarLeads(cab, dup, m, 'ID')).leads).toHaveLength(1)
  })
})
