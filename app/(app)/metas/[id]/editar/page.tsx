import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { editarMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMeta } from '@/lib/dal/metas'
import { rotuloMes } from '@/lib/utils/periodo'

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
      <div>
        <h1 className="text-2xl font-semibold">Editar meta</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {meta.alvo} · {rotuloMes(meta.mes)}
        </p>
      </div>

      <MetaForm
        action={editarMetaAction.bind(null, meta.id, meta.mes)}
        valoresIniciais={{ valor_meta: meta.valorMeta.toFixed(2).replace('.', ',') }}
        cancelarHref={`/metas?mes=${meta.mes}`}
        rotuloEnviar="Salvar"
      />
    </div>
  )
}
