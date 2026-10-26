import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { FunilForm } from '../_components/funil-form'

export const metadata: Metadata = {
  title: 'Novo funil',
}

export default async function NovoFunilPage() {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Novo funil"
        subtitulo="Nasce sempre com uma etapa ganha e uma perdida — não dá pra ficar sem fechamento."
        voltar={{ href: '/configuracoes/funis', rotulo: 'Funis' }}
      />

      <Secao>
        <FunilForm />
      </Secao>
    </div>
  )
}
