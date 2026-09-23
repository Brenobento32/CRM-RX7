'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { criarUsuario, definirAcesso, editarUsuario } from '@/lib/dal/usuarios'
import {
  criarUsuarioSchema,
  editarUsuarioSchema,
  validarFoto,
  type CampoUsuario,
} from '@/lib/validations/usuario'

export type EstadoFormUsuario = {
  erro?: string
  campos?: Partial<Record<CampoUsuario, string[]>>
  /** Nunca inclui a senha: ela não volta para o navegador. */
  valores?: Partial<Record<CampoUsuario, string>>
}

const uuid = z.uuid()

function lerTexto(formData: FormData, campos: readonly CampoUsuario[]) {
  return Object.fromEntries(campos.map((c) => [c, String(formData.get(c) ?? '')])) as Record<
    CampoUsuario,
    string
  >
}

function revalidar(id?: string) {
  revalidatePath('/configuracoes/usuarios')
  if (id) revalidatePath(`/configuracoes/usuarios/${id}/editar`)
  // Nome e foto aparecem na sidebar, na timeline e na agenda.
  revalidatePath('/', 'layout')
}

export async function criarUsuarioAction(
  _estado: EstadoFormUsuario | undefined,
  formData: FormData,
): Promise<EstadoFormUsuario> {
  const valores = lerTexto(formData, ['nome', 'email', 'telefone', 'role'])
  const dados = { ...valores, senha: String(formData.get('senha') ?? '') }

  const foto = validarFoto(formData.get('foto'))
  const parsed = criarUsuarioSchema.safeParse(dados)

  if (!parsed.success || typeof foto === 'string') {
    return {
      campos: {
        ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors),
        ...(typeof foto === 'string' ? { foto: [foto] } : {}),
      },
      valores,
    }
  }

  const resultado = await criarUsuario(parsed.data, foto)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidar()
  redirect(
    resultado.aviso
      ? `/configuracoes/usuarios?aviso=${encodeURIComponent(resultado.aviso)}`
      : '/configuracoes/usuarios',
  )
}

export async function editarUsuarioAction(
  id: string,
  _estado: EstadoFormUsuario | undefined,
  formData: FormData,
): Promise<EstadoFormUsuario> {
  const valores = lerTexto(formData, ['nome', 'telefone', 'role', 'ativo', 'remover_foto'])
  if (!uuid.safeParse(id).success) return { erro: 'Usuário inválido.', valores }

  const foto = validarFoto(formData.get('foto'))
  const parsed = editarUsuarioSchema.safeParse(valores)

  if (!parsed.success || typeof foto === 'string') {
    return {
      campos: {
        ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors),
        ...(typeof foto === 'string' ? { foto: [foto] } : {}),
      },
      valores,
    }
  }

  const resultado = await editarUsuario(id, parsed.data, foto)
  if (!resultado.ok) {
    return resultado.campo
      ? { campos: { [resultado.campo]: [resultado.mensagem] }, valores }
      : { erro: resultado.mensagem, valores }
  }

  revalidar(id)
  redirect('/configuracoes/usuarios')
}

/** Botão "Desativar" / "Reativar" da lista. */
export async function definirAcessoAction(id: string, ativo: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) return

  const resultado = await definirAcesso(id, ativo)
  revalidar(id)
  if (!resultado.ok) {
    redirect(`/configuracoes/usuarios?erro=${encodeURIComponent(resultado.mensagem)}`)
  }
}
