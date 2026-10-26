'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { COR_STATUS } from '@/components/agenda/evento-item'
import { PontoEtapa } from '@/components/ui/ponto-etapa'
import { alterarStatusEventoAction } from '@/lib/actions/eventos'
import type { Evento } from '@/lib/dal/eventos'
import { diaEmSaoPaulo, formatarDiaExtenso, formatarHora } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_EVENTO, ROTULO_TIPO_EVENTO, statusEmAberto, type StatusEvento } from '@/lib/validations/evento'
import { botaoFantasmaClass, botaoCompactoClass } from '@/components/ui/estilos'

const botaoStatus =
  botaoCompactoClass

/**
 * Detalhes do evento por deep link (`?evento=<id>`). `evento` já vem resolvido
 * pela página: reaproveitado da janela carregada ou buscado à parte via
 * `obterEvento` — aqui só se decide entre mostrar e "não encontrado".
 */
export function ModalEvento({
  aberto,
  evento,
  fecharHref,
  editarHref,
}: {
  aberto: boolean
  evento: Evento | null
  fecharHref: string
  /** Abre o modal de edição da reunião (mesma página). */
  editarHref?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (aberto && !dialog.open) dialog.showModal()
    else if (!aberto && dialog.open) dialog.close()
  }, [aberto])

  function fechar() {
    router.push(fecharHref)
  }

  if (!aberto) return null

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-evento-titulo"
      onCancel={(e) => {
        e.preventDefault()
        fechar()
      }}
      onClick={(e) => {
        if (e.target === ref.current) fechar()
      }}
      className="m-auto w-full max-w-lg rounded-2xl border border-premium-borda bg-premium-card p-0 text-premium-texto shadow-premium-alta backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="max-h-[85vh] overflow-y-auto p-6">
        {evento ? (
          <ConteudoEvento evento={evento} fechar={fechar} editarHref={editarHref ?? `/agenda?editar=${evento.id}`} />
        ) : (
          <NaoEncontrado fechar={fechar} />
        )}
      </div>
    </dialog>
  )
}

function NaoEncontrado({ fechar }: { fechar: () => void }) {
  return (
    <>
      <h2 id="modal-evento-titulo" className="text-lg font-semibold">
        Evento não encontrado
      </h2>
      <p className="mt-2 text-sm text-premium-secundario">
        Esse compromisso não existe mais ou você não tem acesso a ele.
      </p>
      <button
        type="button"
        onClick={fechar}
        className={`${botaoFantasmaClass} mt-5`}
      >
        Fechar
      </button>
    </>
  )
}

function ConteudoEvento({ evento, fechar, editarHref }: { evento: Evento; fechar: () => void; editarHref: string }) {
  const dia = diaEmSaoPaulo(evento.inicio)
  const cancelado = evento.status === 'cancelado'
  const acao = (status: StatusEvento) => alterarStatusEventoAction.bind(null, evento.id, evento.clienteId, status)

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2
          id="modal-evento-titulo"
          className={`text-lg font-semibold ${cancelado ? 'text-zinc-400 line-through' : ''}`}
        >
          {evento.titulo}
        </h2>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${COR_STATUS[evento.status]}`}>
          {ROTULO_STATUS_EVENTO[evento.status]}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-premium-mudo">Quando</dt>
          <dd>
            {formatarDiaExtenso(dia)}, {formatarHora(evento.inicio)}–{formatarHora(evento.fim)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-premium-mudo">Tipo</dt>
          <dd>{ROTULO_TIPO_EVENTO[evento.tipo]}</dd>
        </div>
        {evento.usuario && (
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-premium-mudo">Responsável</dt>
            <dd className="flex items-center gap-1.5">
              {evento.usuarioCor && <PontoEtapa cor={evento.usuarioCor} />}
              {evento.usuario}
            </dd>
          </div>
        )}
        {evento.criadoPor && evento.criadoPor !== evento.usuarioId && evento.criadoPorNome && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-premium-mudo">Agendada por</dt>
            <dd>{evento.criadoPorNome}</dd>
          </div>
        )}
        {evento.clienteId && (
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-premium-mudo">Cliente</dt>
          <dd>
            {evento.clienteNome ? (
              <Link href={`/clientes/${evento.clienteId}`} className="hover:underline" onClick={fechar}>
                {evento.clienteNome}
                {evento.clienteEmpresa && ` · ${evento.clienteEmpresa}`}
              </Link>
            ) : (
              'Cliente fora da sua carteira'
            )}
          </dd>
        </div>
        )}
        {evento.etapa && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-premium-mudo">Negociação</dt>
            <dd>{evento.etapa.nome}</dd>
          </div>
        )}
        {evento.descricao && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-premium-mudo">Descrição</dt>
            <dd className="whitespace-pre-wrap">{evento.descricao}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-premium-borda pt-4">
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
        <Link href={editarHref} className={botaoStatus}>
          Editar
        </Link>
        <button
          type="button"
          onClick={fechar}
          className="ml-auto rounded-md px-3 py-1.5 text-xs text-premium-mudo transition hover:bg-premium-bg"
        >
          Fechar
        </button>
      </div>
    </>
  )
}
