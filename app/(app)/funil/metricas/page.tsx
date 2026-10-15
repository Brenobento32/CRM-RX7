import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { botaoSecundarioClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { obterMetricasFunil, obterRealizadoFunil } from '@/lib/dal/funil-metricas'
import { listarFunis, resolverFunilSelecionado } from '@/lib/dal/funis'
import { obterProgressoMetas, percentualMeta } from '@/lib/dal/metas'
import { formatarData, hojeSaoPaulo } from '@/lib/utils/formatacao'
import { chavePeriodoFunil, mesAtual, periodoCorrespondeAoMes, resolverPeriodoFunil, rotuloMes } from '@/lib/utils/periodo'
import { COOKIE_FUNIL } from '@/lib/utils/preferencia-funil'
import { ROTULO_TIPO_META, TIPOS_META } from '@/lib/validations/meta'

import { CardMeta } from '../../metas/_components/progresso'
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

  const mes = mesAtual(hoje)
  const [metricas, progressoMetas, realizado] = await Promise.all([
    obterMetricasFunil(periodo, funilSelecionado.id),
    obterProgressoMetas(mes),
    obterRealizadoFunil(periodo, funilSelecionado.id),
  ])

  // Meta (valor-alvo) é da empresa (gerente) ou da própria pessoa (closer),
  // sempre do mês corrente — o schema é mensal, sem meta por funil ainda.
  // Só o VALOR da meta vem daqui; "realizado"/"percentual" de
  // obterProgressoMetas são descartados nesta tela porque são sempre do mês
  // inteiro, sem filtro de funil — usar os dois juntos misturaria duas
  // janelas diferentes.
  const metaPessoaOuEmpresa =
    usuario.role === 'gerente' ? progressoMetas.empresa : (progressoMetas.pessoas.find((p) => p.usuarioId === usuario.id) ?? null)

  // "Atingido %" só faz sentido comparando o realizado do período
  // selecionado contra a meta mensal quando esse período É o mês da meta
  // (início no dia 1, fim dentro do mesmo mês) — nenhum atalho 7d/30d/90d/
  // ano bate com isso por acaso; só "Personalizado" ajustado manualmente
  // para o mês inteiro passa. Fora disso, o percentual é null de propósito
  // — nunca comparar uma janela arbitrária com a meta do mês.
  const periodoEhOMesDaMeta = periodoCorrespondeAoMes(periodo, mes)

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

      <div className="flex flex-wrap items-center gap-3">
        <SeletorFunil funis={funis} funilId={funilSelecionado.id} />
        <SeletorPeriodoFunil
          caminho="/funil/metricas"
          funilId={funilSelecionado.id}
          atual={periodo}
          hoje={hoje}
        />
      </div>

      {metaPessoaOuEmpresa && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Meta {usuario.role === 'gerente' ? 'da empresa' : 'pessoal'} — referência de {rotuloMes(mes).toLowerCase()}
            </h2>
            <p className="text-xs text-zinc-500">
              A meta é mensal (ainda não existe meta por funil). Realizado é o vendido no funil e período
              selecionados acima ({formatarData(periodo.inicio)} a {formatarData(periodo.fim)}) — nunca o do
              mês inteiro. Atingido só aparece quando o período escolhido é o próprio mês da meta;
              comparar uma janela diferente com a meta mensal seria enganoso.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TIPOS_META.map((tipo) => {
              const valorMeta = metaPessoaOuEmpresa[tipo].valorMeta
              const realizadoNoPeriodo = realizado[tipo]
              const percentual = periodoEhOMesDaMeta ? percentualMeta(realizadoNoPeriodo, valorMeta) : null
              return (
                <div key={tipo}>
                  <CardMeta
                    titulo={`Meta ${ROTULO_TIPO_META[tipo]}`}
                    valorMeta={valorMeta}
                    realizado={realizadoNoPeriodo}
                    percentual={percentual}
                    semMeta="Não definida"
                  />
                  {!periodoEhOMesDaMeta && (
                    <p className="mt-1.5 px-1 text-xs text-zinc-500">
                      Atingido: não aplicável — o período selecionado não é o mês inteiro de{' '}
                      {rotuloMes(mes).toLowerCase()}.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <FunilVisual metricas={metricas} />

      <MetricasFunilPainel metricas={metricas} />
    </div>
  )
}
