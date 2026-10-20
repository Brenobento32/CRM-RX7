import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMetricasFunil, obterRealizadoFunil } from '@/lib/dal/funil-metricas'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { obterProgressoMetas, obterProgressoMetasFunis } from '@/lib/dal/metas'
import { formatarData, hojeSaoPaulo } from '@/lib/utils/formatacao'
import { chavePeriodoFunil, lerMes, resolverPeriodoFunil } from '@/lib/utils/periodo'
import { COOKIE_FUNIL } from '@/lib/utils/preferencia-funil'

import { SeletorMes } from '../../metas/_components/seletor-mes'
import { ContextoFunilSelecionado } from '../_components/contexto-funil'
import { DonutMetaMensal } from '../_components/donut-meta-mensal'
import { FunilVisual, TaxaPorFunil } from '../_components/funil-visual'
import { MetaMensal } from '../_components/meta-mensal'
import { MetricasFunilPainel } from '../_components/metricas-funil'
import { ResultadosPeriodo } from '../_components/resultados-periodo'
import { SeletorFunil } from '../_components/seletor-funil'
import { SeletorPeriodoFunil } from '../_components/seletor-periodo-funil'

export const metadata: Metadata = {
  title: 'Métricas do funil',
}

export default async function MetricasFunilPage({ searchParams }: PageProps<'/funil/metricas'>) {
  const [usuario, cookieStore] = await Promise.all([getUsuarioAtual(), cookies()])
  const { periodo: param, inicio, fim, funil: funilParam, mesMeta } = await searchParams
  const hoje = hojeSaoPaulo()
  const periodo = resolverPeriodoFunil(chavePeriodoFunil(param), { inicio, fim }, hoje)
  // Mês da Meta Mensal: seletor PRÓPRIO (`?mesMeta=`), independente do
  // período operacional acima (`?periodo=`/`inicio`/`fim`) — `lerMes` já cai
  // no mês atual sozinho quando `mesMeta` está ausente ou é inválido.
  const mes = lerMes(mesMeta)

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

  // Duas perguntas diferentes, duas fontes de dados diferentes, nunca
  // misturadas num cálculo só:
  //   - Meta mensal (donut + cards): mês calendário inteiro, sempre o
  //     escolhido no seletor PRÓPRIO, SEM proporção — `obterProgressoMetas`
  //     (RPC `metas_progresso`, geral) e `obterProgressoMetasFunis` (RPC
  //     `metas_funis_progresso`, migration 20261019180000, meta real por
  //     funil — nunca mais uma divisão inventada da meta geral).
  //   - Análise do período: tudo que segue o seletor de período
  //     (`SeletorPeriodoFunil`) — métricas/funil visual/resultados do funil
  //     selecionado, e a comparação entre funis disponíveis.
  const [progressoMes, progressoFunisMes, metricasPorFunil, realizadoFunilPeriodo] = await Promise.all([
    obterProgressoMetas(mes),
    obterProgressoMetasFunis(mes),
    Promise.all(funis.map((f) => obterMetricasFunil(periodo, f.id))),
    obterRealizadoFunil(periodo, funilSelecionado.id),
  ])

  const indiceFunilSelecionado = funis.findIndex((f) => f.id === funilSelecionado.id)
  const metricasSelecionado = metricasPorFunil[indiceFunilSelecionado]

  // Base da URL para o seletor de mês da Meta Mensal: preserva funil e
  // período OPERACIONAL (nunca o inverso — trocar o mês da meta não pode
  // resetar "Dias 15"/"Personalizado" escolhido abaixo, e vice-versa).
  const queryOperacional = new URLSearchParams({ funil: funilSelecionado.id, periodo: periodo.chave })
  if (periodo.chave === 'personalizado') {
    queryOperacional.set('inicio', periodo.inicio)
    queryOperacional.set('fim', periodo.fim)
  }
  const caminhoBaseMetaMes = `/funil/metricas?${queryOperacional.toString()}&`

  const periodoLabel = `${formatarData(periodo.inicio)} → ${formatarData(periodo.fim)}`

  return (
    // `@container`: a largura REAL disponível aqui depende da rota (ver
    // `ROTAS_LARGURA_AMPLIADA` em `components/layout/shell-app.tsx`) e do
    // estado da sidebar — nunca fixa. Os grids abaixo decidem colunas pela
    // largura REAL deste container (`@lg:`/`@min-[...]:`), não pelo viewport
    // (`lg:`/`xl:` mediriam a tela inteira, errado quando a sidebar e o
    // padding já consomem uma fatia variável dela).
    <div className="@container w-full space-y-6">
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

      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <SeletorFunil funis={funis} funilId={funilSelecionado.id} />
          {/* key = identidade COMPLETA do período (chave+início+fim), não só a
              chave: força remontar tanto ao trocar de atalho (nunca deixar o
              calendário personalizado visível depois de escolher outro, e
              vice-versa) quanto ao trocar de um período "personalizado" pra
              outro (mesma chave nos dois) — sem isso o calendário reabre
              preso no mês da primeira vez que montou, nunca no do período
              atual. Ver comentário completo no próprio componente. */}
          <SeletorPeriodoFunil
            key={`${periodo.chave}-${periodo.inicio}-${periodo.fim}`}
            caminho="/funil/metricas"
            funilId={funilSelecionado.id}
            atual={periodo}
            hoje={hoje}
          />
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Período de análise: {periodoLabel}</p>
      </div>

      {/* Três painéis principais: funil visual (esquerda), meta mensal em
          círculo (centro), resultados do período em barras (direita). Linha
          de destaque da tela — mesma altura mínima nos três.
          `@min-[1100px]`: entre 2 colunas (`@lg`, 512px de container) e 3
          colunas (1.1fr/1fr/1fr) — valor escolhido para separar telas tipo
          1366×768 (container ~1062px → 2+1, três colunas ficariam
          apertadas) de telas tipo 1440×900 (container ~1136px → 3 colunas
          cabem legíveis); documentado aqui para não ser "mágico". */}
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @min-[1100px]:grid-cols-[1.1fr_1fr_1fr]">
        <div className="flex min-h-[460px] flex-col rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <FunilVisual metricas={metricasSelecionado} funilNome={funilSelecionado.nome} />
        </div>
        <DonutMetaMensal progresso={progressoMes.empresa} />
        <ResultadosPeriodo
          resumo={metricasSelecionado.resumo}
          funilNome={funilSelecionado.nome}
          periodoLabel={periodoLabel}
        />
      </div>

      <MetaMensal
        mes={mes}
        progressoEmpresa={progressoMes.empresa}
        progressoFunis={progressoFunisMes}
        seletorMes={<SeletorMes mes={mes} caminhoBase={caminhoBaseMetaMes} nomeParametro="mesMeta" />}
      />

      <details className="space-y-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Detalhes por etapa
        </summary>

        <div className="mt-4 space-y-6">
          <ContextoFunilSelecionado realizadoFunil={realizadoFunilPeriodo} funilNome={funilSelecionado.nome} />

          <TaxaPorFunil
            resumos={funis.map((f, i) => ({ funilId: f.id, nome: f.nome, metricas: metricasPorFunil[i] }))}
          />

          <MetricasFunilPainel metricas={metricasSelecionado} />
        </div>
      </details>
    </div>
  )
}
