import type { Metadata } from 'next'

import { criarClienteAction } from '@/lib/actions/clientes'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { getEmpresaAtual } from '@/lib/dal/empresa'
import { listarFunis } from '@/lib/dal/funis'

import { ClienteForm } from '../_components/cliente-form'

export const metadata: Metadata = {
  title: 'Novo cliente',
}

export default async function NovoClientePage() {
  const [usuario, empresa] = await Promise.all([getUsuarioAtual(), getEmpresaAtual()])

  if (empresa.somenteLeitura) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Novo cliente</h1>
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Esta empresa é somente leitura. Não é possível cadastrar clientes aqui.
        </p>
      </div>
    )
  }

  const [responsaveis, funis] = await Promise.all([listarResponsaveis(), listarFunis()])
  const funisAtivos = funis.filter((f) => f.ativo)

  if (funisAtivos.length === 0) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Novo cliente</h1>
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Você ainda não tem acesso a nenhum funil. Peça ao gerente para configurar suas permissões.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Novo cliente</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uma negociação é aberta automaticamente, na primeira etapa aberta do funil escolhido abaixo.
        </p>
      </div>

      <ClienteForm
        action={criarClienteAction}
        valoresIniciais={{ tipo_cliente: 'pessoa_fisica', owner_id: usuario.id }}
        responsaveis={responsaveis}
        funis={funisAtivos}
        rotuloEnviar="Cadastrar cliente"
        cancelarHref="/clientes"
      />
    </div>
  )
}
