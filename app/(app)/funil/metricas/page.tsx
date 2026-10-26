import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { cartaoClass } from '@/components/ui/estilos'
import { exigirCargo } from '@/lib/dal/auth'
import { CARGOS_POR_AREA } from '@/lib/validations/usuario'
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
import { SeletorPeriodoFunil } from '../_components/seletor-periodo-funil'

export const metadata: Metadata = {
  title: 'Métricas do funil',
}

export default async function MetricasFunilPage({ searchParams }: PageProps<'/funil/metricas'>) {
  const [usuario, cookieStore] = await Promise.all([exigirCargo(CARGOS_POR_AREA.relatorios), cookies()])
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
      <div className="@container w-full space-y-6">
        <PageHeaderPremium titulo="Métricas do funil" usuario={usuario} />
        <p className="rounded-lg border border-dashed border-premium-borda p-6 text-center text-sm text-premium-mudo">
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
    // `ROTAS_PREMIUM` em `components/layout/shell-app.tsx`) e do estado da
    // sidebar — nunca fixa. Os grids abaixo decidem colunas pela largura
    // REAL deste container (`@lg:`/`@min-[...]:`), não pelo viewport
    // (`lg:`/`xl:` mediriam a tela inteira, errado quando a sidebar e o
    // padding já consomem uma fatia variável dela).
    <div className="@container w-full space-y-5 text-premium-texto">
      <PageHeaderPremium
        titulo="Métricas do funil"
        subtitulo={`${usuario.role === 'gerente' ? 'Acompanhe a evolução da equipe' : 'Acompanhe suas negociações'} em cada etapa e o desempenho de vendas no período selecionado.`}
        usuario={usuario}
      />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* O seletor de FUNIL saiu daqui: agora mora no cabeçalho do painel
              "Funil de vendas" (item 9 da rodada) e controla os dois painéis
              principais (funil + meta). O período continua aqui, global. */}
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
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-premium-borda bg-premium-card px-3 py-2 text-sm font-medium tabular-nums text-premium-secundario">
            {periodoLabel}
          </span>
          {usuario.role === 'gerente' && (
            <Link
              href={`/configuracoes/funis/${funilSelecionado.id}`}
              className="rounded-lg border border-premium-borda px-3 py-2 text-sm text-premium-secundario transition hover:border-premium-mudo/50 hover:text-premium-texto"
            >
              Configurar funil
            </Link>
          )}
        </div>
      </div>

      {/* Dois painéis principais: funil visual (esquerda/maior) e meta de
          faturamento GERAL da empresa (direita — não existe meta por funil;
          a comparação por funil mora só nos cards abaixo, `MetaMensal`).
          "Resultados do período" saiu (item 8 de uma rodada anterior).
          Responsividade já aprovada: celular/tablet vertical pode empilhar,
          tablet horizontal em diante mostra as duas colunas na mesma linha.
          `@2xl` (672px de container): com a sidebar em 232px + 24px de
          padding por lado, um tablet horizontal de 1024px chega em ~756px
          de container, acima do limiar. Segunda coluna com piso de 320px
          (`minmax(320px,...)`) pra nunca espremer o donut, primeira com
          1.15fr (um pouco mais larga — é o painel principal da tela). */}
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="flex min-h-[460px] flex-col rounded-2xl border border-premium-borda bg-premium-card p-5">
          <FunilVisual metricas={metricasSelecionado} funis={funis} funilId={funilSelecionado.id} />
        </div>
        <DonutMetaMensal progresso={progressoMes.empresa} mes={mes} />
      </div>

      <MetaMensal
        mes={mes}
        progressoEmpresa={progressoMes.empresa}
        progressoFunis={progressoFunisMes}
        seletorMes={<SeletorMes mes={mes} caminhoBase={caminhoBaseMetaMes} nomeParametro="mesMeta" variant="premium" />}
      />

      <details className={`${cartaoClass} space-y-6 p-5`}>
        <summary className="cursor-pointer rounded-md text-sm font-semibold text-premium-secundario transition hover:text-premium-texto">
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
