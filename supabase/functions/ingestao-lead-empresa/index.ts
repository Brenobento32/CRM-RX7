/**
 * Edge Function `ingestao-lead-empresa` — webhook de leads por empresa (SaaS).
 *
 * Cada empresa gera a própria credencial no CRM (`gerar_credencial_ingestao`,
 * só admin_empresa) e configura no formulário/automação dela:
 *   POST .../functions/v1/ingestao-lead-empresa
 *   Authorization: Bearer rx7_<id>_<segredo>      (ou X-RX7-Credencial)
 *   { external_id, formulario_slug?, nicho_slug?, dados: { nome, telefone?, email?, empresa?, instagram? },
 *     respostas?: [{ pergunta_externa, resposta }], atribuicao?: {...} }
 *
 * - A empresa é decidida pelo BANCO a partir da credencial
 *   (`ingerir_lead_por_credencial`); tenant_id no corpo é recusado.
 * - Só por header: credencial na URL não é aceita (vai para log/histórico).
 * - Reenvio do mesmo external_id não duplica (lock + unique por empresa);
 *   dedup de cliente só dentro da empresa; empresa suspensa/cancelada/
 *   arquivo e credencial revogada são recusadas.
 *
 * Fontes de leads (T14): token `rx7f_<fonte>_<segredo>` de uma fonte do tipo
 * webhook, Google Sheets (Apps Script) ou Respondi da empresa. O Respondi
 * pode mandar o token em `?token=` se não aceitar header; os demais, nunca.
 *
 * Servidor → servidor: o segredo nunca vai para o navegador. Deploy com
 * --no-verify-jwt (o chamador não tem JWT do CRM; a credencial é a
 * autenticação). Não substitui nem altera `ingestao-lead` (Respondi atual).
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

import { validarLead } from '../_shared/lead.ts'
import { credencialDaRequisicao } from '../_shared/requisicao.ts'
import { mapearRespondi, type CamposRespondi } from '../_shared/respondi.ts'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Teto do corpo: lead de formulário não chega perto disso. */
const LIMITE_BYTES = 64 * 1024

function json(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}
const erro = (status: number, codigo: string, mensagem: string) => json(status, { ok: false, codigo, mensagem })

const TOKEN_FONTE = /^rx7f_[0-9a-f]{32}_[0-9a-f]{64}$/

type Fonte = { id: string; tipo: 'webhook' | 'respondi' | 'google_sheets'; configuracao: { campos?: CamposRespondi } }

/**
 * Fonte de leads (T14): token `rx7f_…` da fonte. Webhook e Google Sheets
 * (Apps Script) mandam o formato interno; Respondi da empresa manda o
 * formato nativo dele. O banco resolve a empresa, o funil e a etapa pela fonte.
 */
async function ingerirPorFonte(token: string, tokenNaUrl: boolean, corpo: unknown): Promise<Response> {
  const { data, error } = await admin.rpc('fonte_por_token', { p_token: token })
  const fonte = (data as Fonte[] | null)?.[0]
  if (error || !fonte) return erro(401, 'credencial_invalida', 'Credencial ausente ou inválida.')
  // Só o Respondi pode exigir o token na URL (quando não envia header próprio).
  if (tokenNaUrl && fonte.tipo !== 'respondi') {
    return erro(400, 'credencial_na_url', 'Envie a credencial no header Authorization, nunca na URL.')
  }

  let lead: { external_id: string; nome: string | null; telefone: string | null; email: string | null;
              empresa: string | null; instagram?: string | null; respostas: unknown[]; atribuicao: unknown }
  if (fonte.tipo === 'respondi') {
    const r = mapearRespondi(corpo, fonte.configuracao?.campos ?? {})
    if (!r) return erro(400, 'pedido_invalido', 'Payload do Respondi inválido.')
    lead = r
  } else {
    const v = validarLead(corpo)
    if (!v.ok) return erro(400, 'pedido_invalido', v.mensagem)
    lead = v.lead
  }

  const { data: res, error: erroRpc } = await admin.rpc('ingerir_lead_fonte', {
    p_fonte: fonte.id,
    p_external_id: lead.external_id,
    p_nome: lead.nome,
    p_telefone: lead.telefone,
    p_email: lead.email,
    p_empresa: lead.empresa,
    p_instagram: lead.instagram ?? null,
    p_respostas: lead.respostas,
    p_atribuicao: lead.atribuicao,
  })
  if (erroRpc) {
    console.error('ingestao-lead-empresa fonte:', erroRpc.code)
    return erro(500, 'erro_interno', 'Erro inesperado ao processar o lead.')
  }
  const r = (res as { resultado: string; negociacao_id: string | null; erro_codigo: string | null }[] | null)?.[0]
  if (r?.resultado === 'criado' || r?.resultado === 'atualizado') {
    return json(r.resultado === 'criado' ? 201 : 200, { ok: true, negociacao_id: r.negociacao_id, criado: r.resultado === 'criado' })
  }
  if (r?.resultado === 'recusado') return erro(403, r.erro_codigo ?? 'recusado', 'Fonte ou empresa indisponível para receber leads.')
  return erro(400, 'payload_invalido', 'Dados inválidos: informe nome e telefone ou e-mail válidos.')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return erro(405, 'metodo', 'Use POST.')

  const tokenNaUrl = new URL(req.url).searchParams.get('token')
  const credencialHeader = credencialDaRequisicao(req.headers)
  const tokenFonteHeader = /^Bearer\s+(rx7f_\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
    ?? req.headers.get('x-rx7-credencial')?.trim()

  const bruto = await req.text()
  if (bruto.length > LIMITE_BYTES) return erro(413, 'grande_demais', 'Payload grande demais.')

  let corpo: unknown
  try {
    corpo = JSON.parse(bruto)
  } catch {
    return erro(400, 'pedido_invalido', 'JSON inválido.')
  }

  const tokenFonte = tokenFonteHeader && TOKEN_FONTE.test(tokenFonteHeader) ? tokenFonteHeader
    : tokenNaUrl && TOKEN_FONTE.test(tokenNaUrl) ? tokenNaUrl : null
  if (tokenFonte) return ingerirPorFonte(tokenFonte, tokenFonte === tokenNaUrl && !tokenFonteHeader, corpo)

  // Credencial genérica da empresa (T10): só por header.
  if (tokenNaUrl) {
    return erro(400, 'credencial_na_url', 'Envie a credencial no header Authorization, nunca na URL.')
  }
  const credencial = credencialHeader
  if (!credencial) return erro(401, 'credencial_invalida', 'Credencial ausente ou inválida.')

  const validado = validarLead(corpo)
  if (!validado.ok) return erro(400, 'pedido_invalido', validado.mensagem)
  const lead = validado.lead

  const { data, error } = await admin.rpc('ingerir_lead_por_credencial', {
    p_credencial: credencial,
    p_external_id: lead.external_id,
    p_nome: lead.nome,
    p_formulario_slug: lead.formulario_slug,
    p_nicho_slug: lead.nicho_slug,
    p_telefone: lead.telefone,
    p_email: lead.email,
    p_empresa: lead.empresa,
    p_instagram: lead.instagram,
    p_respostas: lead.respostas,
    p_atribuicao: lead.atribuicao,
  })

  if (error) {
    // Log interno sem dado pessoal; resposta pública genérica.
    console.error('ingestao-lead-empresa:', error.code, error.message)
    if (error.code === '28P01') return erro(401, 'credencial_invalida', 'Credencial ausente ou inválida.')
    if (error.code === '42501') return erro(403, 'empresa_indisponivel', 'Empresa indisponível para receber leads.')
    if (['22023', 'P0002', '23514', '23505'].includes(error.code)) {
      return erro(400, 'payload_invalido', 'Dados inválidos: verifique formulário, nicho e dados do lead.')
    }
    return erro(500, 'erro_interno', 'Erro inesperado ao processar o lead.')
  }

  const resultado = (data as { cliente_id: string; negociacao_id: string; criado: boolean }[] | null)?.[0]
  return json(resultado?.criado ? 201 : 200, {
    ok: true,
    negociacao_id: resultado?.negociacao_id,
    criado: resultado?.criado ?? false,
  })
})
