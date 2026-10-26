import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarServicoAction } from '@/lib/actions/servicos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarCategoriasDeServico, obterServico } from '@/lib/dal/servicos'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { ServicoForm } from '../../_components/servico-form'

export const metadata: Metadata = {
  title: 'Editar serviço',
}

export default async function EditarServicoPage({ params }: PageProps<'/configuracoes/servicos/[id]/editar'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const [servico, categorias] = await Promise.all([obterServico(id), listarCategoriasDeServico()])
  if (!servico) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Editar serviço"
        subtitulo={servico.ativo ? undefined : 'Serviço desativado: continua nas negociações que já o usam.'}
        voltar={{ href: '/configuracoes/servicos', rotulo: 'Serviços' }}
      />
      <Secao>
        <ServicoForm
          action={editarServicoAction.bind(null, servico.id)}
          valoresIniciais={{ nome: servico.nome, categoria: servico.categoria ?? '' }}
          categorias={categorias}
          rotuloEnviar="Salvar"
        />
      </Secao>
    </div>
  )
}
