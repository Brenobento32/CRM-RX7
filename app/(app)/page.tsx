import type { Metadata } from 'next'

import { getUsuarioAtual } from '@/lib/dal/auth'
import { MESES_EVOLUCAO, obterDashboard } from '@/lib/dal/dashboard'
import { formatarDia } from '@/lib/utils/formatacao'
import { chavePeriodo, resolverPeriodo } from '@/lib/utils/periodo'

import { FunilVisual } from './_components/dashboard/funil-visual'
import { GraficoEtapas } from './_components/dashboard/grafico-etapas'
import { GraficoVendas } from './_components/dashboard/grafico-vendas'
import { CardsKpi } from './_components/dashboard/kpis'
import { AtividadesRecentes, UltimasMovimentacoes } from './_components/dashboard/recentes'
import { SeletorPeriodo } from './_components/dashboard/seletor-periodo'
import { TabelaPerformance } from './_components/dashboard/tabela-performance'

export const metadata: Metadata = {
  title: 'Início',
}

function Painel({
  titulo,
  descricao,
  children,
  className = '',
}: {
  titulo: string
  descricao?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      <h2 className="font-semibold">{titulo}</h2>
      {descricao && <p className="mt-0.5 text-xs text-zinc-500">{descricao}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default async function InicioPage({ searchParams }: PageProps<'/'>) {
  const usuario = await getUsuarioAtual()
  const { periodo: param } = await searchParams
  const periodo = resolverPeriodo(chavePeriodo(param))
  const dashboard = await obterDashboard(periodo)

  const gerente = usuario.role === 'gerente'
  const primeiroNome = usuario.nome.split(' ')[0]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Olá, {primeiroNome}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {gerente ? 'Visão da equipe' : 'Seus números'} de {formatarDia(periodo.inicio)} a{' '}
            {formatarDia(periodo.fim)}.
          </p>
        </div>
        <SeletorPeriodo atual={periodo.chave} />
      </div>

      <CardsKpi kpis={dashboard.kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Painel
          titulo="Funil"
          descricao="Negociações por etapa. Fechado e perdido contam só as encerradas no período."
        >
          <FunilVisual etapas={dashboard.etapas} />
        </Painel>
        <Painel
          titulo="Valor por etapa"
          descricao="Estimado nas etapas abertas; vendido em fechado (no período)."
        >
          <GraficoEtapas dados={dashboard.etapas} />
        </Painel>
      </div>

      <Painel
        titulo="Evolução de vendas"
        descricao={`Valor vendido por mês de fechamento, últimos ${MESES_EVOLUCAO} meses.`}
      >
        <GraficoVendas dados={dashboard.vendasMensais} />
      </Painel>

      {gerente && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Performance por closer</h2>
            <p className="text-xs text-zinc-500">
              Pipeline e abertas: situação atual. Demais colunas: no período. Próximas reuniões:
              próximos 7 dias.
            </p>
          </div>
          <TabelaPerformance pessoas={dashboard.porUsuario} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Painel titulo="Últimas atividades">
          <AtividadesRecentes itens={dashboard.atividadesRecentes} />
        </Painel>
        <Painel titulo="Últimas movimentações no funil">
          <UltimasMovimentacoes itens={dashboard.movimentacoes} />
        </Painel>
      </div>
    </div>
  )
}
