import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarAlvosDeMeta } from '@/lib/dal/metas'
import { lerMes } from '@/lib/utils/periodo'
import { ALVO_EMPRESA } from '@/lib/validations/meta'

import { MetaForm } from '../_components/meta-form'

export const metadata: Metadata = {
  title: 'Nova meta',
}

/** `?alvo=` e `?mes=` vêm do botão "Definir meta" da lista. */
export default async function NovaMetaPage({ searchParams }: PageProps<'/metas/nova'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { alvo, mes: param } = await searchParams
  const mes = lerMes(param)
  const alvos = await listarAlvosDeMeta()
  const alvoInicial = alvos.some((a) => a.valor === alvo) ? String(alvo) : ALVO_EMPRESA

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova meta</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uma meta por mês para a empresa e para cada closer.
        </p>
      </div>

      <MetaForm
        action={criarMetaAction}
        alvos={alvos}
        valoresIniciais={{ alvo: alvoInicial, mes }}
        cancelarHref={`/metas?mes=${mes}`}
        rotuloEnviar="Criar meta"
      />
    </div>
  )
}
