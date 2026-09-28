import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { z } from 'zod'

import { EventoItem, ListaEventos } from '@/components/agenda/evento-item'
import { botaoPrimarioClass } from '@/components/ui/estilos'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  DIAS_AGUARDANDO_STATUS,
  contarEventosPorDia,
  listarAguardandoStatus,
  listarEventosNoPeriodo,
  listarResponsaveisAgenda,
  obterEvento,
  type Evento,
} from '@/lib/dal/eventos'
import {
  VISAO_PADRAO,
  hrefAgenda,
  janelaDaVisao,
  navegar,
  tituloPeriodo,
  visaoPadraoInicial,
  visaoValida,
  type ParametrosAgenda,
} from '@/lib/utils/calendario'
import { diaEmSaoPaulo, diaValido, hojeSaoPaulo } from '@/lib/utils/formatacao'

import { CalendarioToolbar, FiltroResponsavel } from './_components/calendario-toolbar'
import { GradeHoras } from './_components/grade-horas'
import { MiniCalendario } from './_components/mini-calendario'
import { ModalEvento } from './_components/modal-evento'
import { VisaoLista } from './_components/visao-lista'
import { VisaoMes } from './_components/visao-mes'

export const metadata: Metadata = {
  title: 'Agenda',
}

const uuid = z.uuid()

export default async function AgendaPage({ searchParams }: PageProps<'/agenda'>) {
  const usuario = await getUsuarioAtual()
  const params = await searchParams
  const gerente = usuario.role === 'gerente'

  const hoje = hojeSaoPaulo()
  const userAgent = (await headers()).get('user-agent') ?? ''
  const visao = visaoValida(params.visao) ? params.visao : visaoPadraoInicial(userAgent)
  const dia = diaValido(params.dia) ? params.dia : hoje
  // Filtro por pessoa: só o gerente vê a agenda de outros.
  const usuarioId =
    gerente && typeof params.usuario === 'string' && params.usuario ? params.usuario : undefined
  const eventoIdParam = typeof params.evento === 'string' && params.evento ? params.evento : undefined
  const eventoId = eventoIdParam && uuid.safeParse(eventoIdParam).success ? eventoIdParam : undefined

  const janela = janelaDaVisao(visao, dia)

  const [eventos, aguardando, responsaveis] = await Promise.all([
    listarEventosNoPeriodo(janela.inicio, janela.fim, usuarioId),
    listarAguardandoStatus(usuarioId),
    listarResponsaveisAgenda(),
  ])

  // Mini calendário: no mês (visão Mês) os pontinhos vêm dos eventos já
  // carregados; nas outras visões, uma consulta leve só para o mês do
  // calendário lateral (que pode não ser o período mostrado na grade).
  const janelaMes = visao === 'mes' ? janela : janelaDaVisao('mes', dia)
  const diasComEvento =
    visao === 'mes'
      ? new Set(eventos.map((e) => diaEmSaoPaulo(e.inicio)))
      : await contarEventosPorDia(janelaMes.inicio, janelaMes.fim, usuarioId)

  // Deep link do evento: reaproveita o que já veio na janela; fora dela,
  // busca à parte (RLS decide o acesso — sem permissão ou inexistente vira
  // "não encontrado" no modal, não erro de página).
  let eventoSelecionado: Evento | null = null
  if (eventoId) {
    eventoSelecionado = eventos.find((e) => e.id === eventoId) ?? (await obterEvento(eventoId))
  }

  const base: Omit<ParametrosAgenda, 'evento'> = { visao, dia, usuario: usuarioId }
  const padrao = { visao: VISAO_PADRAO, hoje }
  const link = (p: Partial<ParametrosAgenda>) => hrefAgenda({ ...base, ...p }, padrao)

  // Aguardando status do próprio período já aparece na visão principal.
  const aguardandoForaDaJanela = aguardando.filter((e) => !eventos.some((d) => d.id === e.id))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {gerente ? 'Compromissos da equipe.' : 'Seus compromissos.'}
          </p>
        </div>
        <Link href={`/agenda/novo?dia=${dia}`} className={botaoPrimarioClass}>
          Novo evento
        </Link>
      </div>

      {aguardandoForaDaJanela.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Aguardando status</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Já passaram e ainda estão como agendados (últimos {DIAS_AGUARDANDO_STATUS} dias). Marque se
              aconteceram — o resultado vai para a timeline do cliente.
            </p>
          </div>
          <ListaEventos>
            {aguardandoForaDaJanela.map((e) => (
              <EventoItem key={e.id} evento={e} mostrarData mostrarResponsavel={gerente} />
            ))}
          </ListaEventos>
        </section>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="space-y-4 lg:w-64 lg:shrink-0">
          <MiniCalendario dia={dia} hoje={hoje} diasComEvento={diasComEvento} link={link} />

          {gerente && (
            <FiltroResponsavel visao={visao} dia={dia} usuarioId={usuarioId} responsaveis={responsaveis} />
          )}

          {gerente && !usuarioId && responsaveis.length > 1 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
              <p className="mb-1.5 font-medium text-zinc-700 dark:text-zinc-300">Responsáveis</p>
              <ul className="space-y-1">
                {responsaveis.map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                    {r.cor && <PontoEtapa cor={r.cor} />}
                    {r.nome}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <CalendarioToolbar
            visao={visao}
            titulo={tituloPeriodo(visao, dia, janela)}
            anteriorDia={navegar(visao, dia, -1)}
            proximoDia={navegar(visao, dia, 1)}
            hoje={hoje}
            link={link}
          />

          {visao === 'mes' ? (
            <VisaoMes dias={janela.dias} eventos={eventos} dia={dia} hoje={hoje} gerente={gerente} link={link} />
          ) : visao === 'lista' ? (
            <VisaoLista eventos={eventos} hoje={hoje} gerente={gerente} />
          ) : (
            <GradeHoras dias={janela.dias} eventos={eventos} hoje={hoje} gerente={gerente} link={link} base={base} />
          )}
        </div>
      </div>

      <ModalEvento aberto={Boolean(eventoId)} evento={eventoSelecionado} fecharHref={link({ evento: undefined })} />
    </div>
  )
}
