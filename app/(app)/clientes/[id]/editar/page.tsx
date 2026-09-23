import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { atualizarClienteAction } from '@/lib/actions/clientes'
import { listarResponsaveis, obterCliente } from '@/lib/dal/clientes'
import { formatarCnpj, formatarCpf, formatarTelefone } from '@/lib/utils/documentos'

import { ClienteForm } from '../../_components/cliente-form'

export const metadata: Metadata = {
  title: 'Editar cliente',
}

export default async function EditarClientePage({
  params,
}: PageProps<'/clientes/[id]/editar'>) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const [cliente, responsaveis] = await Promise.all([
    obterCliente(id),
    listarResponsaveis(),
  ])
  if (!cliente) notFound()

  // O id vai amarrado no servidor, não num campo oculto do formulário.
  const action = atualizarClienteAction.bind(null, cliente.id)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/clientes/${cliente.id}`} className="text-sm text-zinc-500 hover:underline">
          ← {cliente.nome}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Editar cliente</h1>
      </div>

      <ClienteForm
        action={action}
        valoresIniciais={{
          tipo_cliente: cliente.tipo_cliente,
          nome: cliente.nome,
          empresa: cliente.empresa ?? '',
          cpf: cliente.cpf ? formatarCpf(cliente.cpf) : '',
          cnpj: cliente.cnpj ? formatarCnpj(cliente.cnpj) : '',
          telefone: cliente.telefone ? formatarTelefone(cliente.telefone) : '',
          whatsapp: cliente.whatsapp ? formatarTelefone(cliente.whatsapp) : '',
          email: cliente.email ?? '',
          responsavel: cliente.responsavel ?? '',
          cargo: cliente.cargo ?? '',
          observacoes: cliente.observacoes ?? '',
          owner_id: cliente.owner_id,
        }}
        responsaveis={responsaveis}
        rotuloEnviar="Salvar alterações"
        cancelarHref={`/clientes/${cliente.id}`}
      />
    </div>
  )
}
