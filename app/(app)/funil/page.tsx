import type { Metadata } from 'next'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarEtapas } from '@/lib/dal/etapas'
import { DIAS_VISIVEIS_ENCERRADOS, listarCardsFunil } from '@/lib/dal/funil'
import { obterMetricasFunil } from '@/lib/dal/funil-metricas'
import { chavePeriodo, resolverPeriodo } from '@/lib/utils/periodo'

import { SeletorPeriodo } from '../_components/dashboard/seletor-periodo'

import { Kanban } from './_components/kanban'
import { MetricasFunilPainel } from './_components/metricas-funil'

export const metadata: Metadata = {
  title: 'Funil',
}

export default async function FunilPage({ searchParams }: PageProps<'/funil'>) {
  const usuario = await getUsuarioAtual()
  const { periodo: param } = await searchParams
  const periodo = resolverPeriodo(chavePeriodo(param))

  const [cards, etapas, metricas] = await Promise.all([
    listarCardsFunil(),
    listarEtapas(),
    obterMetricasFunil(periodo),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Funil</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.role === 'gerente' ? 'Negociações de toda a equipe.' : 'Suas negociações.'} O
            período vale para as métricas; no quadro, fechadas e perdidas aparecem por{' '}
            {DIAS_VISIVEIS_ENCERRADOS} dias.
          </p>
        </div>
        <SeletorPeriodo atual={periodo.chave} caminho="/funil" />
      </div>

      <MetricasFunilPainel metricas={metricas} />

      <Kanban
        cards={cards}
        etapas={etapas.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo }))}
      />
    </div>
  )
}
