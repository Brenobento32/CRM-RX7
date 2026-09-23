import type { Metadata } from 'next'

import { criarClienteAction } from '@/lib/actions/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'

import { ClienteForm } from '../_components/cliente-form'

export const metadata: Metadata = {
  title: 'Novo cliente',
}

export default async function NovoClientePage() {
  const usuario = await getUsuarioAtual()
  const responsaveis = await listarResponsaveis()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Novo cliente</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uma negociação em “Reunião agendada” é aberta automaticamente para o
          cliente.
        </p>
      </div>

      <ClienteForm
        action={criarClienteAction}
        valoresIniciais={{ tipo_cliente: 'pessoa_fisica', owner_id: usuario.id }}
        responsaveis={responsaveis}
        rotuloEnviar="Cadastrar cliente"
        cancelarHref="/clientes"
      />
    </div>
  )
}
