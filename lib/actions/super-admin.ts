'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  criarEmpresa,
  definirAssinatura,
  reativarEmpresa,
  salvarPlano,
  suspenderEmpresa,
} from '@/lib/dal/super-admin'
import { assinaturaSchema, motivoSchema, novaEmpresaSchema, planoSchema } from '@/lib/validations/super-admin'

/**
 * Ações do Super Admin. Cada DAL confere o Super Admin, e cada RPC confere
 * de novo no banco; aqui só validamos o formulário e voltamos à tela com a
 * mensagem.
 */

const uuid = z.uuid()

function texto(formData: FormData, campo: string): string {
  const v = formData.get(campo)
  return typeof v === 'string' ? v : ''
}

function comMensagem(destino: string, chave: 'erro' | 'ok', mensagem: string) {
  return `${destino}${destino.includes('?') ? '&' : '?'}${chave}=${encodeURIComponent(mensagem)}`
}

export async function criarEmpresaAction(formData: FormData): Promise<void> {
  const destino = '/admin/empresas/nova'
  const parsed = novaEmpresaSchema.safeParse({
    nome: texto(formData, 'nome'),
    slug: texto(formData, 'slug'),
    admin_nome: texto(formData, 'admin_nome'),
    admin_email: texto(formData, 'admin_email'),
    admin_senha: texto(formData, 'admin_senha'),
  })
  if (!parsed.success) redirect(comMensagem(destino, 'erro', parsed.error.issues[0]?.message ?? 'Dados inválidos.'))

  const r = await criarEmpresa(parsed.data)
  if (!r.ok) redirect(comMensagem(destino, 'erro', r.mensagem))
  revalidatePath('/admin')
  redirect(comMensagem(`/admin/empresas/${r.id}`, 'ok', 'Empresa criada com funil inicial e assinatura de teste.'))
}

export async function salvarPlanoAction(formData: FormData): Promise<void> {
  const destino = '/admin/planos'
  const parsed = planoSchema.safeParse({
    codigo: texto(formData, 'codigo'),
    nome: texto(formData, 'nome'),
    preco_mensal: texto(formData, 'preco_mensal'),
    preco_anual: texto(formData, 'preco_anual'),
    limite_usuarios: texto(formData, 'limite_usuarios'),
    limite_integracoes: texto(formData, 'limite_integracoes'),
    dias_teste: texto(formData, 'dias_teste'),
    recursos: formData.getAll('recursos').filter((v): v is string => typeof v === 'string'),
    status: texto(formData, 'status'),
  })
  if (!parsed.success) redirect(comMensagem(destino, 'erro', parsed.error.issues[0]?.message ?? 'Dados inválidos.'))

  const r = await salvarPlano(parsed.data)
  revalidatePath('/admin', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? `Plano ${parsed.data.nome} salvo.` : r.mensagem))
}

export async function definirAssinaturaAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'tenant_id'))
  if (!id.success) redirect('/admin')
  const destino = `/admin/empresas/${id.data}`

  const parsed = assinaturaSchema.safeParse({
    plano_codigo: texto(formData, 'plano_codigo'),
    status: texto(formData, 'status'),
    ciclo: texto(formData, 'ciclo'),
    renovacao_em: texto(formData, 'renovacao_em'),
    teste_ate: texto(formData, 'teste_ate'),
    motivo: texto(formData, 'motivo'),
    provedor: texto(formData, 'provedor'),
    provedor_assinatura_id: texto(formData, 'provedor_assinatura_id'),
  })
  if (!parsed.success) redirect(comMensagem(destino, 'erro', parsed.error.issues[0]?.message ?? 'Dados inválidos.'))

  const r = await definirAssinatura(id.data, parsed.data)
  revalidatePath('/admin', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? 'Assinatura atualizada.' : r.mensagem))
}

export async function alterarSituacaoEmpresaAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'tenant_id'))
  if (!id.success) redirect('/admin')
  const destino = `/admin/empresas/${id.data}`

  const motivo = motivoSchema.safeParse(texto(formData, 'motivo'))
  if (!motivo.success) redirect(comMensagem(destino, 'erro', motivo.error.issues[0]?.message ?? 'Informe o motivo.'))

  const acao = texto(formData, 'acao')
  const r =
    acao === 'suspender'
      ? await suspenderEmpresa(id.data, motivo.data)
      : acao === 'reativar'
        ? await reativarEmpresa(id.data, motivo.data)
        : ({ ok: false, mensagem: 'Ação desconhecida.' } as const)

  revalidatePath('/admin', 'layout')
  redirect(
    comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? (acao === 'suspender' ? 'Empresa suspensa.' : 'Empresa reativada.') : r.mensagem),
  )
}
