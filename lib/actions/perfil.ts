'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { createClient } from '@/lib/supabase/server'
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
