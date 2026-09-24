import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarServicoAction } from '@/lib/actions/servicos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarCategoriasDeServico } from '@/lib/dal/servicos'

import { ServicoForm } from '../_components/servico-form'

export const metadata: Metadata = {
  title: 'Novo serviço',
}

export default async function NovoServicoPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const categorias = await listarCategoriasDeServico()

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Novo serviço</h1>
      <ServicoForm
        action={criarServicoAction}
        valoresIniciais={{}}
        categorias={categorias}
        rotuloEnviar="Criar serviço"
      />
    </div>
  )
}
