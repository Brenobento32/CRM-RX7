'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { alterarMinhaSenha, getUsuarioAtual } from '@/lib/dal/auth'
import { removerMinhaFoto, trocarMinhaFoto } from '@/lib/dal/usuarios'
import { createClient } from '@/lib/supabase/server'
import { lerFotoSegura } from '@/lib/utils/imagem'
import { alterarMinhaSenhaSchema } from '@/lib/validations/auth'
import { meuPerfilSchema } from '@/lib/validations/usuario'

export type EstadoMeuPerfil = {
  ok?: boolean
  erro?: string
  campos?: Partial<Record<'nome' | 'telefone' | 'cor_agenda', string[]>>
}

/**
 * "Editar perfil" do próprio usuário. Só nome, telefone e cor na agenda; o
 * `id` vem da sessão (nunca do formulário). Papel e status de acesso ficam
 * protegidos no banco (`profiles_guard_privilegios`) e a RLS só deixa o
 * usuário alterar o próprio perfil.
 */
export async function atualizarMeuPerfilAction(
  _estado: EstadoMeuPerfil | undefined,
  formData: FormData,
): Promise<EstadoMeuPerfil> {
  const usuario = await getUsuarioAtual()
  const parsed = meuPerfilSchema.safeParse({
    nome: formData.get('nome') ?? '',
    telefone: formData.get('telefone') ?? '',
    cor_agenda: formData.get('cor_agenda') ?? '',
  })
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors }

  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ nome: parsed.data.nome, telefone: parsed.data.telefone, cor_agenda: parsed.data.cor_agenda })
    .eq('id', usuario.id)

  if (error) return { erro: 'Não foi possível salvar o perfil. Tente de novo.' }

  revalidatePath('/', 'layout')
  return { ok: true }
}

export type EstadoMinhaSenha = {
  ok?: boolean
  erro?: string
  campos?: Partial<Record<'senha_atual' | 'nova_senha' | 'confirmar_senha', string[]>>
}

/**
 * Meu perfil → Segurança: o próprio usuário troca a senha. Exige sessão e a
 * senha atual; nenhuma senha é registrada em log ou devolvida na resposta.
 */
export async function alterarMinhaSenhaAction(
  _estado: EstadoMinhaSenha | undefined,
  formData: FormData,
): Promise<EstadoMinhaSenha> {
  await getUsuarioAtual()
  const parsed = alterarMinhaSenhaSchema.safeParse({
    senha_atual: formData.get('senha_atual') ?? '',
    nova_senha: formData.get('nova_senha') ?? '',
    confirmar_senha: formData.get('confirmar_senha') ?? '',
  })
  if (!parsed.success) return { campos: z.flattenError(parsed.error).fieldErrors }

  const r = await alterarMinhaSenha(parsed.data.senha_atual, parsed.data.nova_senha)
  if (!r.ok) return r.campo ? { campos: { [r.campo]: [r.mensagem] } } : { erro: r.mensagem }
  return { ok: true }
}

export type EstadoMinhaFoto = { ok?: 'trocada' | 'removida'; erro?: string }

/** Meu perfil → Foto: troca ou remove a PRÓPRIA foto (botão "remover" manda `acao=remover`). */
export async function minhaFotoAction(_estado: EstadoMinhaFoto | undefined, formData: FormData): Promise<EstadoMinhaFoto> {
  await getUsuarioAtual()
  if (formData.get('acao') === 'remover') {
    const r = await removerMinhaFoto()
    if (!r.ok) return { erro: r.mensagem }
    revalidatePath('/', 'layout')
    return { ok: 'removida' }
  }
  const foto = await lerFotoSegura(formData.get('foto'))
  if (!foto) return { erro: 'Escolha uma imagem JPG, PNG ou WebP de até 2 MB.' }
  if (!foto.ok) return { erro: foto.mensagem }
  const r = await trocarMinhaFoto(foto.arquivo)
  if (!r.ok) return { erro: r.mensagem }
  revalidatePath('/', 'layout')
  return { ok: 'trocada' }
}
