import type { Metadata } from 'next'
import Link from 'next/link'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMetricasFunil } from '@/lib/dal/funil-metricas'
import { chavePeriodo, resolverPeriodo } from '@/lib/utils/periodo'

import { SeletorPeriodo } from '../../_components/dashboard/seletor-periodo'
import { MetricasFunilPainel } from '../_components/metricas-funil'

export const metadata: Metadata = {
  title: 'Métricas do funil',
}

export default async function MetricasFunilPage({ searchParams }: PageProps<'/funil/metricas'>) {
  const usuario = await getUsuarioAtual()
  const { periodo: param } = await searchParams
  const periodo = resolverPeriodo(chavePeriodo(param))
  const metricas = await obterMetricasFunil(periodo)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/funil" className="text-sm text-zinc-500 hover:underline">
            ← Kanban
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Métricas do funil</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.role === 'gerente' ? 'Da equipe inteira.' : 'Das suas negociações.'} Conversão,
            tempo por etapa e cards parados.
          </p>
        </div>
        <SeletorPeriodo atual={periodo.chave} caminho="/funil/metricas" />
      </div>

      <MetricasFunilPainel metricas={metricas} />
    </div>
  )
}
