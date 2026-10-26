import Link from 'next/link'

import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { alterarStatusEventoAction } from '@/lib/actions/eventos'
import type { Evento } from '@/lib/dal/eventos'
import { diaEmSaoPaulo, formatarDia, formatarHora } from '@/lib/utils/formatacao'
import {
  ROTULO_STATUS_EVENTO,
  ROTULO_TIPO_EVENTO,
  statusEmAberto,
  type StatusEvento,
} from '@/lib/validations/evento'
import { botaoCompactoClass, cartaoClass } from '@/components/ui/estilos'

export const COR_STATUS: Record<StatusEvento, string> = {
  agendado: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  confirmado: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  realizado: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  nao_compareceu: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  cancelado: 'bg-premium-bg text-premium-secundario',
}

const botaoStatus =
  botaoCompactoClass

/**
 * Um compromisso da agenda com as ações de status. Os botões são formulários
 * com a action amarrada ao evento: funcionam sem JavaScript no cliente.
 */
export function EventoItem({
  evento,
  mostrarData = false,
  mostrarResponsavel = false,
}: {
  evento: Evento
  mostrarData?: boolean
  mostrarResponsavel?: boolean
}) {
  const acao = (status: StatusEvento) =>
    alterarStatusEventoAction.bind(null, evento.id, evento.clienteId, status)

  const cancelado = evento.status === 'cancelado'

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
      <div className="w-24 shrink-0 text-sm tabular-nums">
        {mostrarData && (
          <p className="font-medium">{formatarDia(diaEmSaoPaulo(evento.inicio), false)}</p>
        )}
        <p className={mostrarData ? 'text-premium-mudo' : 'font-medium'}>
          {formatarHora(evento.inicio)}–{formatarHora(evento.fim)}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {evento.usuarioCor && (
            <span title={evento.usuario ? `Responsável: ${evento.usuario}` : undefined}>
              <PontoEtapa cor={evento.usuarioCor} />
            </span>
          )}
          <span className={`font-medium ${cancelado ? 'text-zinc-400 line-through' : ''}`}>
            {evento.titulo}
          </span>
          {evento.serieId && (
            <span title="Compromisso que se repete" className="text-xs text-premium-mudo">
              <span aria-hidden>↻</span>
              <span className="sr-only">Repete</span>
            </span>
          )}
          <span className="rounded bg-premium-bg px-1.5 py-0.5 text-xs text-premium-secundario">
            {ROTULO_TIPO_EVENTO[evento.tipo]}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${COR_STATUS[evento.status]}`}>
            {ROTULO_STATUS_EVENTO[evento.status]}
          </span>
        </div>

        <p className="mt-0.5 text-sm text-premium-secundario">
          {/* Sem cliente (agenda nativa): só o responsável. Com cliente que a RLS não mostra: aviso. */}
          {evento.clienteId === null ? null : evento.clienteNome ? (
            <Link href={`/clientes/${evento.clienteId}`} className="hover:underline">
              {evento.clienteNome}
              {evento.clienteEmpresa && ` · ${evento.clienteEmpresa}`}
            </Link>
          ) : (
            'Cliente fora da sua carteira'
          )}
          {evento.etapa && ` · ${evento.etapa.nome}`}
          {mostrarResponsavel && evento.usuario && `${evento.clienteId === null ? '' : ' · '}${evento.usuario}`}
        </p>

        {evento.descricao && (
          <p className="mt-1 line-clamp-2 text-sm whitespace-pre-wrap text-premium-mudo">
            {evento.descricao}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {statusEmAberto(evento.status) ? (
          <>
            {evento.status === 'agendado' && (
              <form action={acao('confirmado')}>
                <button type="submit" className={botaoStatus}>
                  Confirmar
                </button>
              </form>
            )}
            <form action={acao('realizado')}>
              <button type="submit" className={botaoStatus}>
                Realizado
              </button>
            </form>
            <form action={acao('nao_compareceu')}>
              <button type="submit" className={botaoStatus}>
                Não compareceu
              </button>
            </form>
            <form action={acao('cancelado')}>
              <button type="submit" className={botaoStatus}>
                Cancelar
              </button>
            </form>
          </>
        ) : (
          <form action={acao('agendado')}>
            <button type="submit" className={botaoStatus}>
              Voltar para agendado
            </button>
          </form>
        )}
        <Link href={`/agenda?editar=${evento.id}`} className={botaoStatus}>
          Editar
        </Link>
      </div>
    </li>
  )
}

export function ListaEventos({ children }: { children: React.ReactNode }) {
  return (
    <ul className={`${cartaoClass} divide-y divide-premium-borda-suave`}>
      {children}
    </ul>
  )
}
