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
  listarOpcoesClientes,
  listarOcupacao,
  listarResponsaveisAgenda,
  obterEvento,
  obterSerie,
  type Evento,
} from '@/lib/dal/eventos'
import { duracaoDoFormulario, type Ocupado } from '@/lib/utils/agenda'
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
import { diaEmSaoPaulo, diaValido, formatarHora, hojeSaoPaulo } from '@/lib/utils/formatacao'
import { descreverRecorrencia } from '@/lib/utils/recorrencia'
import { statusEmAberto } from '@/lib/validations/evento'
import { CARGOS_QUE_AGENDAM_PARA_CLOSER } from '@/lib/validations/usuario'

import { CalendarioToolbar, FiltroResponsavel } from './_components/calendario-toolbar'
import { GradeHoras } from './_components/grade-horas'
import { MiniCalendario } from './_components/mini-calendario'
import { ModalEvento } from './_components/modal-evento'
import { ModalReuniao, type DadosModalReuniao } from './_components/modal-reuniao'
import { VisaoLista } from './_components/visao-lista'
import { VisaoMes } from './_components/visao-mes'

export const metadata: Metadata = {
  title: 'Agenda',
}

const uuid = z.uuid()
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

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
  // Modal de reunião: ?nova=1 (botão ou horário vazio) ou ?editar=<id>.
  const nova = params.nova === '1'
  const editarParam = typeof params.editar === 'string' ? params.editar : undefined
  const editarId = editarParam && uuid.safeParse(editarParam).success ? editarParam : undefined
  // Recusa de uma action (cancelar/excluir ou integração desligada): só texto, o React escapa.
  const erroAcao = typeof params.erro === 'string' && params.erro ? params.erro.slice(0, 300) : undefined

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

  const eu = responsaveis.find((r) => r.id === usuario.id) ?? { id: usuario.id, nome: usuario.nome, role: usuario.role, cor: null }
  const modalReuniao = nova || editarId ? await dadosDoModal() : null

  // Aviso de conflito: as reuniões que eu vejo + (SDR/Atendente) a ocupação
  // dos Closers no período, só horários — sem título nem cliente de ninguém.
  const ocupados: Ocupado[] = eventos.map((e) => ({
    id: e.id,
    usuarioId: e.usuarioId,
    titulo: e.titulo,
    inicio: e.inicio,
    fim: e.fim,
    status: e.status,
  }))
  if (modalReuniao && CARGOS_QUE_AGENDAM_PARA_CLOSER.includes(usuario.role)) {
    const vistos = new Set(ocupados.map((o) => `${o.usuarioId}|${o.inicio}|${o.fim}`))
    for (const [i, o] of (await listarOcupacao(janela.inicio, janela.fim)).entries()) {
      const chave = `${o.usuarioId}|${o.inicio}|${o.fim}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      ocupados.push({ id: `ocupado-${i}`, usuarioId: o.usuarioId, titulo: 'Horário ocupado', inicio: o.inicio, fim: o.fim, status: 'agendado' })
    }
  }

  async function dadosDoModal(): Promise<DadosModalReuniao> {
    if (editarId) {
      const ev = eventos.find((e) => e.id === editarId) ?? (await obterEvento(editarId))
      if (!ev) return { modo: 'nao-encontrada' }
      const serie = ev.serieId ? await obterSerie(ev.serieId) : null
      const diaEv = diaEmSaoPaulo(ev.inicio)
      const minutos = Math.round((Date.parse(ev.fim) - Date.parse(ev.inicio)) / 60_000)
      const duracao = duracaoDoFormulario(minutos)
      return {
        modo: 'editar',
        eventoId: ev.id,
        clienteId: ev.clienteId,
        dia: diaEv,
        emAberto: statusEmAberto(ev.status),
        vinculo: ev.clienteId ? { clienteNome: ev.clienteNome ?? 'cliente', ownerId: undefined } : null,
        serie: serie ? { descricao: descreverRecorrencia(serie), total: serie.total } : null,
        valores: {
          cliente_id: ev.clienteId ?? '',
          negociacao_id: ev.negociacaoId ?? '',
          usuario_id: ev.usuarioId,
          tipo: ev.tipo,
          tipo_original: ev.tipo,
          titulo: ev.titulo,
          descricao: ev.descricao ?? '',
          data: diaEv,
          hora_inicio: formatarHora(ev.inicio),
          duracao,
          hora_fim: duracao === 'personalizado' ? formatarHora(ev.fim) : '',
          escopo: 'este',
        },
      }
    }
    // Nova reunião. ?cliente= (ficha do cliente) mantém o vínculo, sem campo.
    const clienteParam = typeof params.cliente === 'string' && uuid.safeParse(params.cliente).success ? params.cliente : undefined
    const cliente = clienteParam ? (await listarOpcoesClientes()).find((c) => c.id === clienteParam) : undefined
    const hora = typeof params.hora === 'string' && HORA.test(params.hora) ? params.hora : '09:00'
    const pedido = gerente ? usuarioId : undefined
    return {
      modo: 'criar',
      vinculo: cliente ? { clienteNome: cliente.nome, ownerId: cliente.ownerId } : null,
      valores: {
        cliente_id: cliente?.id ?? '',
        usuario_id: (pedido && responsaveis.some((r) => r.id === pedido) ? pedido : cliente && gerente ? cliente.ownerId : usuario.id) ?? usuario.id,
        tipo: 'reuniao',
        status: 'agendado',
        data: dia,
        hora_inicio: hora,
        duracao: '60',
        recorrencia: 'nenhuma',
      },
    }
  }

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
        <Link href={link({ nova: true })} className={botaoPrimarioClass}>
          Nova reunião
        </Link>
      </div>

      {erroAcao && !modalReuniao && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erroAcao}
        </div>
      )}

      {aguardandoForaDaJanela.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Aguardando status</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Já passaram e ainda estão como agendados (últimos {DIAS_AGUARDANDO_STATUS} dias). Marque se
              aconteceram. Quando há cliente, o resultado também vai para a timeline dele.
            </p>
          </div>
          <ListaEventos>
            {aguardandoForaDaJanela.map((e) => (
              <EventoItem key={e.id} evento={e} mostrarData mostrarResponsavel={gerente} />
            ))}
          </ListaEventos>
        </section>
      )}

      {/* Abaixo de 1280px a grade fica com a largura toda; calendário e filtros vão para baixo. */}
      <div className="flex flex-col gap-6 xl:flex-row">
        <aside className="order-last grid content-start gap-4 sm:grid-cols-2 xl:order-first xl:block xl:w-64 xl:shrink-0 xl:space-y-4">
          <MiniCalendario dia={dia} hoje={hoje} diasComEvento={diasComEvento} link={link} />

          {gerente && (
            <FiltroResponsavel visao={visao} dia={dia} usuarioId={usuarioId} responsaveis={responsaveis} />
          )}

          {gerente && !usuarioId && responsaveis.length > 1 && (
            <div className="rounded-lg border border-premium-borda bg-premium-card p-3 text-xs">
              <p className="mb-1.5 font-medium text-premium-texto">Responsáveis</p>
              <ul className="space-y-1">
                {responsaveis.map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 text-premium-mudo">
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

      <ModalEvento
        aberto={Boolean(eventoId) && !modalReuniao}
        evento={eventoSelecionado}
        fecharHref={link({ evento: undefined })}
        editarHref={eventoId ? link({ evento: undefined, editar: eventoId }) : undefined}
      />
      {modalReuniao && (
        <ModalReuniao
          key={editarId ?? `nova-${dia}-${String(params.hora ?? '')}`}
          dados={modalReuniao}
          responsaveis={responsaveis}
          eu={{ ...eu, gerente }}
          erro={erroAcao}
          ocupados={ocupados}
          fecharHref={link({ evento: undefined, editar: undefined, nova: false })}
        />
      )}
    </div>
  )
}
