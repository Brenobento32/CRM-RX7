import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Avatar } from '@/components/ui/avatar'
import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { definirAcessoAction } from '@/lib/actions/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarUsuarios } from '@/lib/dal/usuarios'
import { formatarTelefone } from '@/lib/utils/documentos'
import { ROTULO_PAPEL } from '@/lib/validations/usuario'

export const metadata: Metadata = {
  title: 'Usuários',
}

export default async function UsuariosPage({
  searchParams,
}: PageProps<'/configuracoes/usuarios'>) {
  const eu = await getUsuarioAtual()
  // Para o closer a rota simplesmente não existe.
  if (eu.role !== 'gerente') notFound()

  const { erro, aviso } = await searchParams
  const usuarios = await listarUsuarios()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/configuracoes" className="text-sm text-zinc-500 hover:underline">
            ← Configurações
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Usuários</h1>
        </div>
        <Link href="/configuracoes/usuarios/novo" className={botaoPrimarioClass}>
          Novo usuário
        </Link>
      </div>

      {typeof erro === 'string' && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {erro}
        </p>
      )}
      {typeof aviso === 'string' && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {aviso}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">Usuário</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">Perfil</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {usuarios.map((u) => (
              <tr key={u.id} className={u.ativo ? undefined : 'text-zinc-400'}>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-3">
                    <Avatar nome={u.nome} fotoUrl={u.fotoUrl} tamanho="sm" />
                    <span className="font-medium">
                      {u.nome}
                      {u.id === eu.id && <span className="ml-1 text-xs font-normal text-zinc-500">(você)</span>}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {u.telefone ? formatarTelefone(u.telefone) : '—'}
                </td>
                <td className="px-4 py-3">{ROTULO_PAPEL[u.role]}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      u.ativo
                        ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300'
                        : 'rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }
                  >
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex justify-end gap-2">
                    <Link href={`/configuracoes/usuarios/${u.id}/editar`} className={botaoSecundarioClass}>
                      Editar
                    </Link>
                    {u.id !== eu.id && (
                      <form action={definirAcessoAction.bind(null, u.id, !u.ativo)}>
                        <button type="submit" className={botaoSecundarioClass}>
                          {u.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                      </form>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        Usuários não são excluídos. Desativar bloqueia o login e mantém o histórico e a carteira —
        transfira os clientes para outra pessoa pela edição de cada cliente.
      </p>
    </div>
  )
}
