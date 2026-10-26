import 'server-only'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { BUCKET_LOGOS, urlDoLogo } from '@/lib/dal/super-admin'
import { createClient } from '@/lib/supabase/server'
import { LOGO_TIPOS, type ContatoEmpresaInput } from '@/lib/validations/super-admin'

/**
 * Dados da empresa pelo Gerente (ou admin) da PRÓPRIA empresa: só logo,
 * telefone, e-mail e nome do responsável. Nome comercial, endereço (slug),
 * plano e IDs ficam só com o Super Admin. O banco confere tudo de novo
 * (`empresa_atualizar_contato`: empresa da requisição + papel gerente/admin;
 * policies do bucket só na pasta `<tenant_id>/`).
 */
export type DadosEmpresaGerente = {
  nome: string
  slug: string
  telefone: string | null
  email: string | null
  responsavelNome: string | null
  logoPath: string | null
  logoUrl: string | null
}

async function exigirGerente() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') throw new Error('Somente o administrador altera os dados da empresa.')
}

export async function obterDadosEmpresa(): Promise<DadosEmpresaGerente> {
  await exigirGerente()
  const empresa = await getEmpresaAtual()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('nome, slug, telefone, email, responsavel_nome, logo_path, updated_at')
    .eq('id', empresa.id)
    .single()
  if (error) throw new Error('Não foi possível carregar os dados da empresa.', { cause: error })
  return {
    nome: data.nome,
    slug: data.slug,
    telefone: data.telefone,
    email: data.email,
    responsavelNome: data.responsavel_nome,
    logoPath: data.logo_path,
    logoUrl: await urlDoLogo(data.logo_path, data.updated_at),
  }
}

/** Logo novo sobe primeiro; o antigo (outra extensão) só sai depois de gravado. */
export async function salvarDadosEmpresa(
  dados: ContatoEmpresaInput,
  logo: File | null,
  removerLogo: boolean,
): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  await exigirGerente()
  const empresa = await getEmpresaAtual()
  const atual = await obterDadosEmpresa()
  const supabase = await createClient()

  let logoPath = removerLogo ? null : atual.logoPath
  if (logo) {
    const extensao = LOGO_TIPOS[logo.type as keyof typeof LOGO_TIPOS]
    logoPath = `${empresa.id}/logo.${extensao}`
    const { error } = await supabase.storage.from(BUCKET_LOGOS).upload(logoPath, logo, { contentType: logo.type, upsert: true })
    if (error) {
      console.error('upload logo', error)
      return { ok: false, mensagem: 'Não foi possível enviar o logotipo.' }
    }
  }

  const { error } = await supabase.rpc('empresa_atualizar_contato', {
    p_telefone: dados.telefone,
    p_email: dados.email,
    p_responsavel_nome: dados.responsavel_nome,
    p_logo_path: logoPath,
  })
  if (error) {
    if (error.code === '42501') return { ok: false, mensagem: 'Sem permissão para alterar os dados da empresa.' }
    if (error.code === '23514' || error.code === '22023') return { ok: false, mensagem: 'Dados inválidos. Confira os campos.' }
    return { ok: false, mensagem: 'Não foi possível salvar os dados da empresa.' }
  }

  if (atual.logoPath && atual.logoPath !== logoPath) {
    await supabase.storage.from(BUCKET_LOGOS).remove([atual.logoPath])
  }
  return { ok: true }
}
