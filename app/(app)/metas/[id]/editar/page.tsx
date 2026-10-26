import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMeta } from '@/lib/dal/metas'
import { rotuloMes } from '@/lib/utils/periodo'
import { ROTULO_TIPO_META } from '@/lib/validations/meta'
import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Secao } from '@/components/ui/secao'

import { MetaForm } from '../../_components/meta-form'

export const metadata: Metadata = {
  title: 'Editar meta',
}

export default async function EditarMetaPage({ params }: PageProps<'/metas/[id]/editar'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const meta = await obterMeta(id)
  if (!meta) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderPremium
        titulo="Editar meta"
        subtitulo={`${meta.alvo} · ${meta.tipoMeta ? ROTULO_TIPO_META[meta.tipoMeta] : 'Não classificada'} · ${rotuloMes(meta.mes)}`}
        voltar={{ href: `/metas?mes=${meta.mes}`, rotulo: 'Metas' }}
      />

      <Secao>
        <MetaForm
          action={editarMetaAction.bind(null, meta.id, meta.mes)}
          valoresIniciais={{ valor_meta: meta.valorMeta.toFixed(2).replace('.', ',') }}
          cancelarHref={`/metas?mes=${meta.mes}`}
          rotuloEnviar="Salvar"
        />
      </Secao>
    </div>
  )
}
