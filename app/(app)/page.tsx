import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeaderPremium } from '@/components/layout/page-header-premium'
import { Aviso } from '@/components/ui/aviso'
import { botaoPrimarioClass, botaoSecundarioClass } from '@/components/ui/estilos'
import { Secao } from '@/components/ui/secao'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { MESES_EVOLUCAO, obterDashboard } from '@/lib/dal/dashboard'
import { listarAguardandoStatus, listarEventosDoDia, listarProximosEventos } from '@/lib/dal/eventos'
import { formatarDia, formatarDiaExtenso, hojeSaoPaulo } from '@/lib/utils/formatacao'
import { chavePeriodo, resolverPeriodo } from '@/lib/utils/periodo'

import { ListaCompromissos } from './_components/dashboard/compromissos'
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

function saudacao() {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
}

/**
 * Início: primeiro o trabalho do dia (agenda de hoje, próximas reuniões e o
 * que espera um retorno), depois os números do período e, por fim, o
 * histórico recente. Os dados de cada cargo já vêm restritos pelo banco.
 */
export default async function InicioPage({ searchParams }: PageProps<'/'>) {
  const usuario = await getUsuarioAtual()
  const { periodo: param } = await searchParams
  const periodo = resolverPeriodo(chavePeriodo(param))
  const hoje = hojeSaoPaulo()

  const [dashboard, deHoje, proximos, aguardando] = await Promise.all([
    obterDashboard(periodo),
    listarEventosDoDia(hoje, usuario.id),
    listarProximosEventos(usuario.id),
    listarAguardandoStatus(usuario.id),
  ])

  const gerente = usuario.role === 'gerente'
  const primeiroNome = usuario.nome.split(' ')[0]

  return (
    <div className="space-y-6">
      <PageHeaderPremium
        titulo={`${saudacao()}, ${primeiroNome}`}
        subtitulo={<span className="inline-block first-letter:uppercase">{formatarDiaExtenso(hoje)}</span>}
        acoes={
          <>
            <Link href="/clientes/novo" className={botaoSecundarioClass}>
              Novo cliente
            </Link>
            <Link href="/agenda?nova=1" className={botaoPrimarioClass}>
              Nova reunião
            </Link>
          </>
        }
      />

      {aguardando.length > 0 && (
        <Aviso tom="alerta" titulo={`${aguardando.length} ${aguardando.length === 1 ? 'reunião aguarda' : 'reuniões aguardam'} um status`}>
          Já passaram e continuam como agendadas.{' '}
          <Link href="/agenda" className="font-medium underline underline-offset-2">
            Marcar na agenda
          </Link>
        </Aviso>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Secao
          className="lg:col-span-3"
          titulo="Sua agenda de hoje"
          descricao={`${deHoje.length} ${deHoje.length === 1 ? 'compromisso' : 'compromissos'}`}
          acoes={
            <Link href="/agenda" className="text-sm font-medium text-premium-acento hover:underline">
              Abrir agenda
            </Link>
          }
        >
          <ListaCompromissos
            eventos={deHoje}
            vazio={{
              titulo: 'Nenhum compromisso hoje',
              descricao: 'Bom momento para prospectar ou retomar negociações paradas.',
              acao: { href: '/agenda?nova=1', rotulo: 'Agendar reunião' },
            }}
          />
        </Secao>
        <Secao className="lg:col-span-2" titulo="Próximos compromissos" descricao="A partir de amanhã">
          <ListaCompromissos
            mostrarDia
            eventos={proximos.slice(0, 5)}
            vazio={{ titulo: 'Agenda livre nos próximos dias', descricao: 'As reuniões marcadas aparecem aqui.' }}
          />
        </Secao>
      </div>

      <section aria-labelledby="titulo-resultados" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="titulo-resultados" className="text-[15px] font-semibold tracking-tight text-premium-texto">
              {gerente ? 'Resultados da equipe' : 'Seus resultados'}
            </h2>
            <p className="text-xs text-premium-mudo">
              {formatarDia(periodo.inicio)} a {formatarDia(periodo.fim)}
            </p>
          </div>
          <SeletorPeriodo atual={periodo.chave} />
        </div>
        <CardsKpi kpis={dashboard.kpis} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Funil" descricao="Negociações por etapa. Fechado e perdido contam só as encerradas no período.">
          <FunilVisual etapas={dashboard.etapas} />
        </Secao>
        <Secao titulo="Valor por etapa" descricao="Estimado nas etapas abertas; vendido em fechado (no período).">
          <GraficoEtapas dados={dashboard.etapas} />
        </Secao>
      </div>

      <Secao titulo="Evolução de vendas" descricao={`Valor vendido por mês de fechamento, últimos ${MESES_EVOLUCAO} meses.`}>
        <GraficoVendas dados={dashboard.vendasMensais} />
      </Secao>

      {gerente && (
        <Secao
          semPadding
          titulo="Desempenho da equipe"
          descricao="Pipeline e abertas: situação atual. Demais colunas: no período. Próximas reuniões: próximos 7 dias."
        >
          <TabelaPerformance pessoas={dashboard.porUsuario} />
        </Secao>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Últimas atividades">
          <AtividadesRecentes itens={dashboard.atividadesRecentes} />
        </Secao>
        <Secao titulo="Últimas movimentações no funil">
          <UltimasMovimentacoes itens={dashboard.movimentacoes} />
        </Secao>
      </div>
    </div>
  )
}
