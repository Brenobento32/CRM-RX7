import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMetricasFunil } from '@/lib/dal/funil-metricas'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { chavePeriodo, resolverPeriodo } from '@/lib/utils/periodo'
import { COOKIE_FUNIL } from '@/lib/utils/preferencia-funil'

import { SeletorPeriodo } from '../../_components/dashboard/seletor-periodo'
import { SeletorFunil } from '../_components/seletor-funil'
import { MetricasFunilPainel } from '../_components/metricas-funil'

export const metadata: Metadata = {
  title: 'Métricas do funil',
}

export default async function MetricasFunilPage({ searchParams }: PageProps<'/funil/metricas'>) {
  const [usuario, cookieStore] = await Promise.all([getUsuarioAtual(), cookies()])
  const { periodo: param, funil: funilParam } = await searchParams
  const periodo = resolverPeriodo(chavePeriodo(param))

  const funilSelecionado = await resolverFunilSelecionado(funilParam, cookieStore.get(COOKIE_FUNIL)?.value)
  const funis = await listarFunis()
  const metricas = await obterMetricasFunil(periodo, funilSelecionado.id)

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
        <div className="flex flex-wrap items-center gap-3">
          <SeletorFunil funis={funis} funilId={funilSelecionado.id} />
          {usuario.role === 'gerente' && (
            <Link href={`/configuracoes/funis/${funilSelecionado.id}`} className={botaoSecundarioClass}>
              Configurar funil
            </Link>
          )}
          <SeletorPeriodo atual={periodo.chave} caminho="/funil/metricas" />
        </div>
      </div>

      <MetricasFunilPainel metricas={metricas} />
    </div>
  )
}
