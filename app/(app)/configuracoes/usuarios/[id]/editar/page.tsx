import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarUsuarioAction } from '@/lib/actions/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapas } from '@/lib/dal/etapas'
import { listarFunis } from '@/lib/dal/funis'
import { listarPermissoesDoColaborador } from '@/lib/dal/permissoes'
import { coresEmUso, obterUsuario } from '@/lib/dal/usuarios'
import { formatarTelefone } from '@/lib/utils/documentos'

import { PermissoesComerciais } from '../../_components/permissoes-comerciais'
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

  const [usuario, cores] = await Promise.all([obterUsuario(id), coresEmUso(id)])
  if (!usuario) notFound()

  // Permissões comerciais só fazem sentido pra SDR/CLOSER — gerente já tem
  // acesso total e o banco nem deixa configurar uma linha para ele.
  const mostrarPermissoes = usuario.role !== 'gerente'
  const [funis, permissoesAtuais] = mostrarPermissoes
    ? await Promise.all([listarFunis(), listarPermissoesDoColaborador(usuario.id)])
    : [[], []]
  const etapasPorFunil = mostrarPermissoes
    ? Object.fromEntries(
        await Promise.all(
          funis.map(async (f) => [f.id, await listarEtapas(f.id)] as const),
        ),
      )
    : {}

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Editar usuário</h1>

      <UsuarioForm
        modo="editar"
        action={editarUsuarioAction.bind(null, usuario.id)}
        fotoAtual={usuario.fotoUrl}
        proprioUsuario={usuario.id === eu.id}
        coresEmUso={cores}
        valoresIniciais={{
          nome: usuario.nome,
          email: usuario.email,
          telefone: usuario.telefone ? formatarTelefone(usuario.telefone) : '',
          role: usuario.role,
          cor_agenda: usuario.corAgenda ?? '',
          ativo: usuario.ativo ? 'sim' : 'nao',
        }}
      />

      {mostrarPermissoes && (
        <PermissoesComerciais
          usuarioId={usuario.id}
          funis={funis}
          etapasPorFunil={etapasPorFunil}
          permissoesAtuais={permissoesAtuais}
        />
      )}
    </div>
  )
}
