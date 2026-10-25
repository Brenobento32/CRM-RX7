'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { salvarDadosEmpresa } from '@/lib/dal/empresa-dados'
import { contatoEmpresaSchema, validarLogo } from '@/lib/validations/super-admin'

const DESTINO = '/configuracoes/empresa'

function texto(formData: FormData, campo: string): string {
  const v = formData.get(campo)
  return typeof v === 'string' ? v : ''
}

function voltar(chave: 'ok' | 'erro', mensagem: string): never {
  redirect(`${DESTINO}?${chave}=${encodeURIComponent(mensagem)}`)
}

/** Só os campos permitidos ao Gerente; qualquer outro campo do formulário é ignorado. */
export async function salvarDadosEmpresaAction(formData: FormData): Promise<void> {
  const parsed = contatoEmpresaSchema.safeParse({
    telefone: texto(formData, 'telefone'),
    email: texto(formData, 'email'),
    responsavel_nome: texto(formData, 'responsavel_nome'),
  })
  if (!parsed.success) voltar('erro', parsed.error.issues[0]?.message ?? 'Dados inválidos.')
  const logo = validarLogo(formData.get('logo'))
  if (typeof logo === 'string') voltar('erro', logo)

  const r = await salvarDadosEmpresa(parsed.data, logo, formData.get('remover_logo') === '1')
  revalidatePath('/', 'layout')
  if (!r.ok) voltar('erro', r.mensagem)
  voltar('ok', 'Dados da empresa salvos.')
}
