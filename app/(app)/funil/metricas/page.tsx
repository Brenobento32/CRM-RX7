import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMetricasFunil, obterRealizadoFunil } from '@/lib/dal/funil-metricas'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { obterMetaPeriodo, obterRealizadoGeral } from '@/lib/dal/metas'
import { hojeSaoPaulo } from '@/lib/utils/formatacao'
import { chavePeriodoFunil, resolverPeriodoFunil } from '@/lib/utils/periodo'
import { COOKIE_FUNIL } from '@/lib/utils/preferencia-funil'

import { FinanceiroFunil } from '../_components/financeiro-funil'
import { FunilVisual } from '../_components/funil-visual'
import { SeletorFunil } from '../_components/seletor-funil'
import { MetricasFunilPainel } from '../_components/metricas-funil'
import { SeletorPeriodoFunil } from '../_components/seletor-periodo-funil'

export const metadata: Metadata = {
  title: 'Métricas do funil',
}

export default async function MetricasFunilPage({ searchParams }: PageProps<'/funil/metricas'>) {
  const [usuario, cookieStore] = await Promise.all([getUsuarioAtual(), cookies()])
  const { periodo: param, inicio, fim, funil: funilParam } = await searchParams
  const hoje = hojeSaoPaulo()
  const periodo = resolverPeriodoFunil(chavePeriodoFunil(param), { inicio, fim }, hoje)

  const funilSelecionado = await resolverFunilSelecionado(funilParam, cookieStore.get(COOKIE_FUNIL)?.value)
  const funis = await listarFunis()

  if (!funilSelecionado) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Métricas do funil</h1>
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Você ainda não tem acesso a nenhum funil. Peça ao gerente para configurar suas permissões.
        </p>
      </div>
    )
  }

  // Meta é da empresa (gerente, usuario_id null) ou da própria pessoa
  // (closer) — mesma distinção de /metas. `obterMetaPeriodo` já devolve a
  // meta PROPORCIONADA ao período selecionado (nunca a do mês corrente
  // inteiro) — ver lib/utils/financeiro-periodo.ts#metaProporcionalPeriodo.
  // `obterRealizadoGeral` é o par certo dela: TODOS os funis, nunca só o
  // selecionado (achado desta rodada — ver comentário na migration
  // 20261016190000 e em FinanceiroFunil). `obterRealizadoFunil` continua
  // existindo só pro vendido/ticket médio DESTE funil, nunca pra comparar
  // com a meta.
  const usuarioIdMeta = usuario.role === 'gerente' ? null : usuario.id

  const [metricas, realizadoFunil, realizadoGeral, metaPeriodo] = await Promise.all([
    obterMetricasFunil(periodo, funilSelecionado.id),
    obterRealizadoFunil(periodo, funilSelecionado.id),
    obterRealizadoGeral(periodo, usuarioIdMeta),
    obterMetaPeriodo(periodo, usuarioIdMeta),
  ])

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
        {usuario.role === 'gerente' && (
          <Link href={`/configuracoes/funis/${funilSelecionado.id}`} className={botaoSecundarioClass}>
            Configurar funil
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <SeletorFunil funis={funis} funilId={funilSelecionado.id} />
        {/* key={periodo.chave}: força remontar ao trocar de atalho, pra nunca
            deixar o calendário personalizado visível depois de escolher outro
            atalho (e vice-versa) — ver comentário no próprio componente. */}
        <SeletorPeriodoFunil
          key={periodo.chave}
          caminho="/funil/metricas"
          funilId={funilSelecionado.id}
          atual={periodo}
          hoje={hoje}
        />
      </div>

      <FinanceiroFunil
        metaPeriodo={metaPeriodo}
        realizadoGeral={realizadoGeral}
        realizadoFunil={realizadoFunil}
        periodo={periodo}
      />

      <FunilVisual metricas={metricas} />

      <MetricasFunilPainel metricas={metricas} />
    </div>
  )
}
