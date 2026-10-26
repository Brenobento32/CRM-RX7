'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoSecundarioClass, botaoPerigoClass, caixaErroClass } from '@/components/ui/estilos'
import { atualizarEventoAction, cancelarEventoAction, criarEventoAction, excluirEventoAction } from '@/lib/actions/eventos'
import type { ResponsavelAgenda } from '@/lib/dal/eventos'
import type { Ocupado } from '@/lib/utils/agenda'
import { ESCOPOS, ROTULO_ESCOPO, type ValoresEvento } from '@/lib/validations/evento'

import { ReuniaoForm } from './reuniao-form'

export type DadosModalReuniao =
  | { modo: 'criar'; valores: ValoresEvento; vinculo: { clienteNome: string; ownerId: string | undefined } | null }
  | {
      modo: 'editar'
      eventoId: string
      clienteId: string | null
      dia: string
      emAberto: boolean
      valores: ValoresEvento
      vinculo: { clienteNome: string; ownerId: string | undefined } | null
      serie: { descricao: string; total: number } | null
    }
  | { modo: 'nao-encontrada' }

/**
 * Modal único de reunião: "Nova reunião" (botão ou clique num horário vazio)
 * e "Editar reunião" (a partir dos detalhes). Aberto pela URL
 * (`?nova=1&dia=&hora=` / `?editar=<id>`), como o modal de detalhes, então
 * funciona com voltar/avançar e link direto. Ao salvar, a action redireciona
 * para a agenda do dia — sem o parâmetro, o modal fecha sozinho.
 */
export function ModalReuniao({
  dados,
  responsaveis,
  eu,
  fecharHref,
  erro,
  ocupados,
}: {
  dados: DadosModalReuniao
  responsaveis: ResponsavelAgenda[]
  eu: ResponsavelAgenda & { gerente: boolean }
  fecharHref: string
  /** Recusa de cancelar/excluir, vinda na URL (`?erro=`). */
  erro?: string
  /** Reuniões do período na tela, para o aviso de conflito de horário. */
  ocupados: Ocupado[]
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      // O <dialog> foca o primeiro botão (Fechar); para digitar direto, vai ao nome.
      dialog.querySelector<HTMLInputElement>('#titulo')?.focus()
    }
  }, [])

  function fechar() {
    router.push(fecharHref)
  }

  const titulo = dados.modo === 'criar' ? 'Nova reunião' : dados.modo === 'editar' ? 'Editar reunião' : 'Reunião não encontrada'

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-reuniao-titulo"
      onCancel={(e) => {
        e.preventDefault()
        fechar()
      }}
      onClick={(e) => {
        if (e.target === ref.current) fechar()
      }}
      className={'m-auto w-[calc(100%-2rem)] max-w-xl rounded-xl border border-premium-borda bg-premium-card p-0 text-premium-texto shadow-premium-alta backdrop:bg-black/50 backdrop:backdrop-blur-[2px]'}
    >
      <div className="max-h-[90vh] overflow-y-auto p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="modal-reuniao-titulo" className="text-lg font-semibold">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-premium-mudo transition hover:bg-premium-elevado hover:text-premium-texto"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        {erro && (
          <div
            role="alert"
            className={`${caixaErroClass} mb-4`}
          >
            {erro}
          </div>
        )}

        {dados.modo === 'nao-encontrada' ? (
          <p className="text-sm text-premium-mudo">
            Essa reunião não existe mais ou você não tem acesso a ela.
          </p>
        ) : dados.modo === 'criar' ? (
          <ReuniaoForm
            modo="criar"
            action={criarEventoAction}
            valoresIniciais={dados.valores}
            responsaveis={responsaveis}
            eu={eu}
            vinculo={dados.vinculo}
            ocupados={ocupados}
            onCancelar={fechar}
          />
        ) : (
          <>
            <ReuniaoForm
              modo="editar"
              action={atualizarEventoAction.bind(null, dados.eventoId)}
              valoresIniciais={dados.valores}
              responsaveis={responsaveis}
              eu={eu}
              vinculo={dados.vinculo}
              serie={dados.serie}
              ocupados={ocupados}
              eventoId={dados.eventoId}
              onCancelar={fechar}
            />
            {dados.emAberto && (
              <OutrasAcoes eventoId={dados.eventoId} clienteId={dados.clienteId} dia={dados.dia} emSerie={dados.serie !== null} />
            )}
          </>
        )}
      </div>
    </dialog>
  )
}

/** Cancelar (com escopo, em série) e excluir (só reunião única em aberto). */
function OutrasAcoes({
  eventoId,
  clienteId,
  dia,
  emSerie,
}: {
  eventoId: string
  clienteId: string | null
  dia: string
  emSerie: boolean
}) {
  return (
    <section className="mt-5 space-y-3 border-t border-premium-borda pt-4">
      <form action={cancelarEventoAction.bind(null, eventoId, clienteId, dia)} className="space-y-2">
        {emSerie && (
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <legend className="sr-only">Cancelar quais</legend>
            {ESCOPOS.map((e) => (
              <label key={e} className="flex items-center gap-2">
                <input type="radio" name="escopo" value={e} defaultChecked={e === 'este'} />
                {ROTULO_ESCOPO[e]}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <BotaoConfirmar
            pergunta={emSerie ? 'Cancelar as reuniões escolhidas?' : 'Cancelar esta reunião?'}
            className={botaoSecundarioClass}
          >
            Cancelar reunião
          </BotaoConfirmar>
          <span className="text-xs text-premium-mudo">Cancelada continua no histórico da agenda.</span>
        </div>
      </form>

      {!emSerie && (
        <form action={excluirEventoAction.bind(null, eventoId, clienteId, dia)}>
          <BotaoConfirmar
            pergunta="Excluir esta reunião? Isso não pode ser desfeito."
            className={botaoPerigoClass}
          >
            Excluir
          </BotaoConfirmar>
        </form>
      )}
    </section>
  )
}
