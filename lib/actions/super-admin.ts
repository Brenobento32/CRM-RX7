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
  salvarCadastroEmpresa,
  slugEmUso,
  definirAssinatura,
  reativarEmpresa,
  salvarPlano,
  suspenderEmpresa,
} from '@/lib/dal/super-admin'
import {
  assinaturaSchema,
  dadosEmpresaSchema,
  motivoSchema,
  novaEmpresaSchema,
  planoSchema,
  validarLogo,
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

  const parsed = dadosEmpresaSchema.safeParse({
    nome: texto(formData, 'nome'),
    telefone: texto(formData, 'telefone'),
    email: texto(formData, 'email'),
    responsavel_nome: texto(formData, 'responsavel_nome'),
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
