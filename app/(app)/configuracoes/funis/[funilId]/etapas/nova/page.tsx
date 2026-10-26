import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { criarEtapaAction } from '@/lib/actions/etapas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterFunil } from '@/lib/dal/funis'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { EtapaForm } from '../../../_components/etapa-form'

export const metadata: Metadata = {
  title: 'Nova etapa',
}

export default async function NovaEtapaPage({ params }: PageProps<'/configuracoes/funis/[funilId]/etapas/nova'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { funilId } = await params
  if (!z.uuid().safeParse(funilId).success) notFound()
  const funil = await obterFunil(funilId)
  if (!funil) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo={`Nova etapa em “${funil.nome}”`}
        subtitulo="Etapas comerciais ficam antes do fechamento. Etapas de recuperação ficam depois de Fechado/Perdido."
        voltar={{ href: `/configuracoes/funis/${funil.id}`, rotulo: funil.nome }}
      />

      <Secao>
        <EtapaForm
          action={criarEtapaAction.bind(null, funilId)}
          valoresIniciais={{ cor: 'ciano', posFechamento: 'pipeline', participaConversao: true }}
          mostrarZona
          rotuloEnviar="Criar etapa"
          cancelarHref={`/configuracoes/funis/${funilId}`}
        />
      </Secao>
    </div>
  )
}
