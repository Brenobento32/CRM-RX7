import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarUsuarioAction } from '@/lib/actions/usuarios'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { coresEmUso } from '@/lib/dal/usuarios'

import { UsuarioForm } from '../_components/usuario-form'

export const metadata: Metadata = {
  title: 'Novo usuário',
}

export default async function NovoUsuarioPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const cores = await coresEmUso()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Novo usuário</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          O acesso é liberado na hora, sem e-mail de confirmação.
        </p>
      </div>

      <UsuarioForm
        modo="criar"
        action={criarUsuarioAction}
        valoresIniciais={{ role: 'closer' }}
        coresEmUso={cores}
      />
    </div>
  )
}
