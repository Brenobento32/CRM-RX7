import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMetricasFunil, obterRealizadoFunil } from '@/lib/dal/funil-metricas'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { obterMetaPeriodo, obterRealizadoGeral } from '@/lib/dal/metas'
import { formatarData, hojeSaoPaulo } from '@/lib/utils/formatacao'
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

  // "Meta do período" é SEMPRE a visão geral (empresa, todos os funis,
  // todos os responsáveis) — pra GERENTE, SDR e CLOSER igual (regra desta
  // rodada: todo mundo pode ver o geral; só a linha INDIVIDUAL de outro
  // CLOSER é que fica restrita, e essa tela nunca mostrou isso). Por isso
  // sempre `null` aqui — nunca `usuario.id`. `obterMetaPeriodo`/
  // `obterRealizadoGeral` já restringem no servidor quem pode ver o quê
  // (ver `metas_progresso`/`realizado_periodo`, migration 20261016200000):
  // a linha de usuario_id null (geral, sem PII) agora é visível pra
  // qualquer autenticado.
  const [metricas, realizadoFunil, realizadoGeral, metaPeriodo] = await Promise.all([
    obterMetricasFunil(periodo, funilSelecionado.id),
    obterRealizadoFunil(periodo, funilSelecionado.id),
    obterRealizadoGeral(periodo, null),
    obterMetaPeriodo(periodo, null),
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
          <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Período: {formatarData(periodo.inicio)} → {formatarData(periodo.fim)}
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
        funilNome={funilSelecionado.nome}
      />

      <FunilVisual metricas={metricas} />

      <MetricasFunilPainel metricas={metricas} />
    </div>
  )
}
