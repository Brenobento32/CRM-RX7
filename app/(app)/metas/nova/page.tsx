import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { criarMetaAction } from '@/lib/actions/metas'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarAlvosDeMeta } from '@/lib/dal/metas'
import { lerMes } from '@/lib/utils/periodo'
import { ALVO_EMPRESA, TIPOS_META } from '@/lib/validations/meta'

import { MetaForm } from '../_components/meta-form'

export const metadata: Metadata = {
  title: 'Nova meta',
}

/** `?alvo=`, `?tipo=` e `?mes=` vêm do botão "Definir meta" da lista. */
export default async function NovaMetaPage({ searchParams }: PageProps<'/metas/nova'>) {
  const eu = await getUsuarioAtual()
  if (eu.role !== 'gerente') notFound()

  const { alvo, tipo, mes: param } = await searchParams
  const mes = lerMes(param)
  const alvos = await listarAlvosDeMeta()
  const alvoInicial = alvos.some((a) => a.valor === alvo) ? String(alvo) : ALVO_EMPRESA
  const tipoInicial = (TIPOS_META as readonly string[]).includes(String(tipo)) ? String(tipo) : TIPOS_META[0]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova meta</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uma meta por mês, por tipo (TCV ou MRR), para a empresa e para cada closer.
        </p>
      </div>

      <MetaForm
        action={criarMetaAction}
        alvos={alvos}
        valoresIniciais={{ alvo: alvoInicial, tipo_meta: tipoInicial, mes }}
        cancelarHref={`/metas?mes=${mes}`}
        rotuloEnviar="Criar meta"
      />
    </div>
  )
}
