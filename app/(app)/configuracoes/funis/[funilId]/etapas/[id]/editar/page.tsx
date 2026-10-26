import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarEtapaAction } from '@/lib/actions/etapas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterEtapa } from '@/lib/dal/etapas'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { EtapaForm } from '../../../../_components/etapa-form'

export const metadata: Metadata = {
  title: 'Editar etapa',
}

export default async function EditarEtapaPage({
  params,
}: PageProps<'/configuracoes/funis/[funilId]/etapas/[id]/editar'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { funilId, id } = await params
  if (!z.uuid().safeParse(funilId).success || !z.uuid().safeParse(id).success) notFound()

  const etapa = await obterEtapa(id)
  if (!etapa || etapa.funilId !== funilId) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo={etapa.sistema ? `Cor de “${etapa.nome}”` : 'Editar etapa'}
        voltar={{ href: `/configuracoes/funis/${funilId}`, rotulo: 'Funil' }}
      />

      <Secao>
        <EtapaForm
          action={editarEtapaAction.bind(null, funilId, etapa.id)}
          valoresIniciais={{
            nome: etapa.nome,
            cor: etapa.cor,
            participaConversao: etapa.participaConversao,
          }}
          nomeTravado={etapa.sistema}
          tipo={etapa.tipo}
          posFechamentoFixo={etapa.posFechamento}
          rotuloEnviar="Salvar"
          cancelarHref={`/configuracoes/funis/${funilId}`}
        />
      </Secao>
    </div>
  )
}
