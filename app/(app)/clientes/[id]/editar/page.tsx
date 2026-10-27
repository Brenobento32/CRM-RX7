import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'
import { atualizarClienteAction } from '@/lib/actions/clientes'
import { listarResponsaveis, obterCliente } from '@/lib/dal/clientes'
import { formatarCnpj, formatarCpf, formatarTelefone } from '@/lib/utils/documentos'

import { ClienteForm } from '../../_components/cliente-form'

export const metadata: Metadata = {
  title: 'Editar cliente',
}

export default async function EditarClientePage({ params }: PageProps<'/clientes/[id]/editar'>) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const cliente = await obterCliente(id)
  if (!cliente) notFound()
  // O responsável atual continua na lista (mesmo um Super Admin histórico): editar não troca a carteira sem querer.
  const responsaveis = await listarResponsaveis(cliente.owner_id)

  // O id vai amarrado no servidor, não num campo oculto do formulário.
  const action = atualizarClienteAction.bind(null, cliente.id)

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium titulo="Editar cliente" voltar={{ href: `/clientes/${cliente.id}`, rotulo: cliente.nome }} />

      <Secao>
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
      </Secao>
    </div>
  )
}
