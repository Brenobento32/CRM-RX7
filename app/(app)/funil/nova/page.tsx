import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'
import { listarFunis } from '@/lib/dal/funis'

import { NovaEntradaForm } from './_components/nova-entrada-form'

export const metadata: Metadata = {
  title: 'Nova entrada',
}

export default async function NovaEntradaPage({ searchParams }: PageProps<'/funil/nova'>) {
  const { funil: funilParam } = await searchParams
  const funis = await listarFunis()
  const funil = funis.find((f) => f.id === funilParam && f.ativo)
  if (!funil) notFound()

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeaderPremium
        titulo={`Nova entrada em “${funil.nome}”`}
        subtitulo="Para um cliente já cadastrado. O responsável é sempre o dono atual do cliente."
        voltar={{ href: `/funil?funil=${funil.id}`, rotulo: 'Funil' }}
      />

      <Secao>
        <NovaEntradaForm funilId={funil.id} cancelarHref={`/funil?funil=${funil.id}`} />
      </Secao>
    </div>
  )
}
