'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { caminhoDaEmpresa } from '@/lib/empresa/rota'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import {
  acessarEmpresa,
  alterarSlugEmpresa,
  encerrarAcessoEmpresa,
  criarEmpresa,
  removerLogoPlataforma,
  salvarCadastroEmpresa,
  salvarLogoPlataforma,
  slugEmUso,
  definirAssinatura,
  reativarEmpresa,
  salvarPlano,
  suspenderEmpresa,
} from '@/lib/dal/super-admin'
import {
  assinaturaSchema,
  cadastroEmpresaAdminSchema,
  motivoSchema,
  novaEmpresaSchema,
  planoSchema,
  validarLogo,
  VARIANTES_LOGO,
} from '@/lib/validations/super-admin'

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

/**
 * Onboarding completo: a empresa e o gerente inicial pela Edge Function (como
 * sempre) e, logo em seguida, o cadastro (contato, responsável, logo). Se só
 * o cadastro falhar, a empresa já existe: a tela dela abre com o aviso.
 */
export async function criarEmpresaAction(formData: FormData): Promise<void> {
  const destino = '/admin/empresas/nova'
  const parsed = novaEmpresaSchema.safeParse({
    nome: texto(formData, 'nome'),
    slug: texto(formData, 'slug'),
    telefone: texto(formData, 'telefone'),
    email: texto(formData, 'email'),
    responsavel_nome: texto(formData, 'responsavel_nome'),
    admin_nome: texto(formData, 'admin_nome'),
    admin_email: texto(formData, 'admin_email'),
    admin_senha: texto(formData, 'admin_senha'),
  })
  if (!parsed.success) redirect(comMensagem(destino, 'erro', parsed.error.issues[0]?.message ?? 'Dados inválidos.'))
  const logo = validarLogo(formData.get('logo'))
  if (typeof logo === 'string') redirect(comMensagem(destino, 'erro', logo))

  // provisionar_empresa REAPROVEITA uma empresa existente com o mesmo endereço
  // (dando o vínculo de administrador ao e-mail informado). No cadastro de
  // empresa nova isso nunca é o que se quer: endereço em uso é recusado aqui.
  if (await slugEmUso(parsed.data.slug)) {
    redirect(comMensagem(destino, 'erro', 'Já existe uma empresa com esse endereço. Escolha outro.'))
  }

  const { telefone, email, responsavel_nome, ...onboarding } = parsed.data
  const r = await criarEmpresa(onboarding)
  if (!r.ok || !r.id) redirect(comMensagem(destino, 'erro', r.ok ? 'Não foi possível criar a empresa.' : r.mensagem))
  revalidatePath('/admin')

  const paginaEmpresa = `/admin/empresas/${r.id}`
  if (telefone || email || responsavel_nome || logo) {
    const c = await salvarCadastroEmpresa(r.id, { nome: onboarding.nome, telefone, email, responsavel_nome }, logo, false)
    if (!c.ok) redirect(comMensagem(paginaEmpresa, 'erro', `Empresa criada, mas o cadastro não foi salvo: ${c.mensagem}`))
  }
  redirect(comMensagem(paginaEmpresa, 'ok', 'Empresa criada com administrador inicial, funil e assinatura de teste.'))
}

export async function salvarCadastroEmpresaAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'tenant_id'))
  if (!id.success) redirect('/admin')
  const destino = `/admin/empresas/${id.data}`

  const parsed = cadastroEmpresaAdminSchema.safeParse({
    nome: texto(formData, 'nome'),
    nome_comercial: texto(formData, 'nome_comercial'),
    telefone: texto(formData, 'telefone'),
    email: texto(formData, 'email'),
    responsavel_nome: texto(formData, 'responsavel_nome'),
    observacoes: texto(formData, 'observacoes'),
  })
  if (!parsed.success) redirect(comMensagem(destino, 'erro', parsed.error.issues[0]?.message ?? 'Dados inválidos.'))
  const logo = validarLogo(formData.get('logo'))
  if (typeof logo === 'string') redirect(comMensagem(destino, 'erro', logo))

  const r = await salvarCadastroEmpresa(id.data, parsed.data, logo, formData.get('remover_logo') === '1')
  revalidatePath('/', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? 'Cadastro da empresa salvo.' : r.mensagem))
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
  // Números de WhatsApp e funis (vazio = a definir: novas conexões/funis bloqueados até definir).
  const inteiro = (campo: string, min: number) => {
    const bruto = texto(formData, campo)
    const n = bruto === '' ? null : Number(bruto)
    return n !== null && (!Number.isInteger(n) || n < min || n > 1000) ? Number.NaN : n
  }
  const numeros = inteiro('limite_numeros_whatsapp', 0)
  const funis = inteiro('limite_funis', 1)
  if (Number.isNaN(numeros)) redirect(comMensagem(destino, 'erro', 'Números de WhatsApp: informe de 0 a 1000.'))
  if (Number.isNaN(funis)) redirect(comMensagem(destino, 'erro', 'Funis: informe de 1 a 1000.'))
  const { definirLimitesPlano } = await import('@/lib/dal/central-integracoes')
  const rn = r.ok ? await definirLimitesPlano(parsed.data.codigo, { numeros, funis }) : r
  revalidatePath('/admin', 'layout')
  redirect(comMensagem(destino, rn.ok ? 'ok' : 'erro', rn.ok ? `Plano ${parsed.data.nome} salvo.` : rn.mensagem))
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

export async function alterarSlugEmpresaAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'tenant_id'))
  if (!id.success) redirect('/admin')
  const destino = `/admin/empresas/${id.data}`

  const slug = novaEmpresaSchema.shape.slug.safeParse(texto(formData, 'slug'))
  if (!slug.success) redirect(comMensagem(destino, 'erro', slug.error.issues[0]?.message ?? 'Endereço inválido.'))
  const motivo = motivoSchema.safeParse(texto(formData, 'motivo'))
  if (!motivo.success) redirect(comMensagem(destino, 'erro', motivo.error.issues[0]?.message ?? 'Informe o motivo.'))

  const r = await alterarSlugEmpresa(id.data, slug.data, motivo.data)
  revalidatePath('/admin', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? `Endereço alterado para /${slug.data}. O antigo redireciona para o novo.` : r.mensagem))
}

/**
 * Painel global → CRM da empresa. A RPC exige o Super Admin, abre a janela de
 * acesso e audita; só então a navegação entra na empresa (`/<slug>/`).
 */
export async function acessarEmpresaAction(formData: FormData) {
  const id = uuid.safeParse(formData.get('tenant_id'))
  if (!id.success) redirect('/admin')
  const motivo = texto(formData, 'motivo').trim().slice(0, 300) || null
  const r = await acessarEmpresa(id.data, motivo)
  if (!r.ok) redirect(comMensagem(`/admin/empresas/${id.data}`, 'erro', r.mensagem))
  redirect(caminhoDaEmpresa(r.slug, '/'))
}

/**
 * Dentro do CRM: encerra a janela de acesso global da empresa ATUAL (a da
 * URL, conferida no banco — nunca um id vindo do formulário) e volta ao painel.
 */
export async function encerrarAcessoEmpresaAction() {
  const empresa = await getEmpresaAtual()
  if (empresa.acessoGlobal) await encerrarAcessoEmpresa(empresa.id)
  redirect('/admin')
}

/** Logo do AVANTE CRM (identidade global): enviar uma nova para a variante. */
export async function salvarLogoPlataformaAction(formData: FormData): Promise<void> {
  const destino = '/admin/identidade'
  const variante = z.enum(VARIANTES_LOGO).safeParse(texto(formData, 'variante'))
  if (!variante.success) redirect(comMensagem(destino, 'erro', 'Variante de logo inválida.'))
  const logo = validarLogo(formData.get('logo'))
  if (typeof logo === 'string') redirect(comMensagem(destino, 'erro', logo))
  if (!logo) redirect(comMensagem(destino, 'erro', 'Escolha a imagem da logo.'))
  const r = await salvarLogoPlataforma(variante.data, logo)
  revalidatePath('/', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? `Logo do modo ${variante.data} salva.` : r.mensagem))
}

/** Remove a logo personalizada da variante (volta a logo oficial do AVANTE CRM). */
export async function removerLogoPlataformaAction(formData: FormData): Promise<void> {
  const destino = '/admin/identidade'
  const variante = z.enum(VARIANTES_LOGO).safeParse(texto(formData, 'variante'))
  if (!variante.success) redirect(comMensagem(destino, 'erro', 'Variante de logo inválida.'))
  const r = await removerLogoPlataforma(variante.data)
  revalidatePath('/', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? `Logo do modo ${variante.data} removida: voltou a logo oficial.` : r.mensagem))
}

// ------------------------------------------------------------------ Integrações por empresa
const REGRAS_INTEGRACAO = ['plano', 'liberar', 'bloquear']
const INTEGRACOES_EMPRESA = ['formularios', 'google_sheets', 'whatsapp_oficial', 'meta_conversoes']

/** Exceção por empresa (liberar/bloquear) ou volta à regra do plano. O banco exige Super Admin e motivo, e audita. */
export async function definirIntegracaoEmpresaAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'tenant_id'))
  if (!id.success) redirect('/admin')
  const destino = `/admin/empresas/${id.data}`
  const integracao = texto(formData, 'integracao')
  const regra = texto(formData, 'regra')
  if (!INTEGRACOES_EMPRESA.includes(integracao) || !REGRAS_INTEGRACAO.includes(regra)) redirect(comMensagem(destino, 'erro', 'Escolha a integração e a regra.'))
  const motivo = texto(formData, 'motivo').slice(0, 300)
  if (regra !== 'plano' && !motivo) redirect(comMensagem(destino, 'erro', 'Informe o motivo da exceção.'))
  const { definirIntegracaoEmpresa } = await import('@/lib/dal/central-integracoes')
  const r = await definirIntegracaoEmpresa(id.data, integracao, regra, regra === 'plano' ? null : motivo)
  revalidatePath('/admin', 'layout')
  redirect(comMensagem(destino, r.ok ? 'ok' : 'erro', r.ok ? 'Liberação da integração atualizada.' : r.mensagem))
}

/** Limite próprio da empresa (fontes de captação, números de WhatsApp ou funis). Vazio = volta ao limite do plano. */
export async function definirLimiteEmpresaAction(formData: FormData): Promise<void> {
  const id = uuid.safeParse(texto(formData, 'tenant_id'))
  if (!id.success) redirect('/admin')
  const destino = `/admin/empresas/${id.data}`
  const recurso = texto(formData, 'recurso')
  if (!['fontes', 'numeros_whatsapp', 'funis'].includes(recurso)) redirect(comMensagem(destino, 'erro', 'Recurso inválido.'))
  const bruto = texto(formData, 'limite')
  const limite = bruto === '' ? null : Number(bruto)
  if (limite !== null && (!Number.isInteger(limite) || limite < 0 || limite > 1000)) redirect(comMensagem(destino, 'erro', 'Limite inválido (0 a 1000).'))
  const motivo = texto(formData, 'motivo').slice(0, 300)
  if (limite !== null && !motivo) redirect(comMensagem(destino, 'erro', 'Informe o motivo do limite.'))
  const { definirLimiteEmpresa, limitesDaEmpresa } = await import('@/lib/dal/central-integracoes')
  const r = await definirLimiteEmpresa(id.data, recurso, limite, limite === null ? null : motivo)
  revalidatePath('/admin', 'layout')
  if (!r.ok) redirect(comMensagem(destino, 'erro', r.mensagem))
  // Limite abaixo do uso: nada é excluído; o aviso deixa isso claro para quem reduziu.
  const cota = (await limitesDaEmpresa(id.data)).find((c) => c.recurso === recurso)
  const acima = cota && cota.efetivoDefinido && cota.efetivo !== null && cota.uso > cota.efetivo
  redirect(comMensagem(destino, 'ok', acima
    ? `Limite salvo (${cota.efetivo}). A empresa já usa ${cota.uso}: nada foi excluído; novas criações ficam bloqueadas.`
    : 'Limite da empresa atualizado.'))
}
