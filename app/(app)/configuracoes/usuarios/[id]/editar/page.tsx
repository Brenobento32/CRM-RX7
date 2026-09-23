import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarUsuarioAction } from '@/lib/actions/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterUsuario } from '@/lib/dal/usuarios'
import { formatarTelefone } from '@/lib/utils/documentos'

import { UsuarioForm } from '../../_components/usuario-form'

export const metadata: Metadata = {
  title: 'Editar usuário',
}

export default async function EditarUsuarioPage({
  params,
}: PageProps<'/configuracoes/usuarios/[id]/editar'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const usuario = await obterUsuario(id)
  if (!usuario) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Editar usuário</h1>

      <UsuarioForm
        modo="editar"
        action={editarUsuarioAction.bind(null, usuario.id)}
        fotoAtual={usuario.fotoUrl}
        proprioUsuario={usuario.id === eu.id}
        valoresIniciais={{
          nome: usuario.nome,
          email: usuario.email,
          telefone: usuario.telefone ? formatarTelefone(usuario.telefone) : '',
          role: usuario.role,
          ativo: usuario.ativo ? 'sim' : 'nao',
        }}
      />
    </div>
  )
}
