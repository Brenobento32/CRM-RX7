import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarServicoAction } from '@/lib/actions/servicos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarCategoriasDeServico } from '@/lib/dal/servicos'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

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
      <PageHeaderPremium titulo="Novo serviço" voltar={{ href: '/configuracoes/servicos', rotulo: 'Serviços' }} />
      <Secao>
        <ServicoForm
          action={criarServicoAction}
          valoresIniciais={{}}
          categorias={categorias}
          rotuloEnviar="Criar serviço"
        />
      </Secao>
    </div>
  )
}
