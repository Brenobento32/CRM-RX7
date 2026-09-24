import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { BotaoConfirmar } from '@/components/ui/botao-confirmar'
import { botaoSecundarioClass } from '@/components/ui/estilos'
import { atualizarEventoAction, cancelarEventoAction, excluirEventoAction } from '@/lib/actions/eventos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import {
  listarOpcoesClientes,
  listarResponsaveisAgenda,
  obterEvento,
  obterSerie,
  type Evento,
} from '@/lib/dal/eventos'
import { duracaoDoFormulario } from '@/lib/utils/agenda'
import { diaEmSaoPaulo, formatarHora } from '@/lib/utils/formatacao'
import { descreverRecorrencia } from '@/lib/utils/recorrencia'
import { ESCOPOS, ROTULO_ESCOPO, statusEmAberto } from '@/lib/validations/evento'

import { EventoForm } from '../../_components/evento-form'

export const metadata: Metadata = {
  title: 'Editar evento',
}

export default async function EditarEventoPage({ params, searchParams }: PageProps<'/agenda/[id]/editar'>) {
  const usuario = await getUsuarioAtual()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const [evento, clientes, responsaveis, { erro }] = await Promise.all([
    obterEvento(id),
    listarOpcoesClientes(),
    listarResponsaveisAgenda(),
    searchParams,
  ])
  if (!evento) notFound()

  const serie = evento.serieId ? await obterSerie(evento.serieId) : null
  const dia = diaEmSaoPaulo(evento.inicio)
  const minutos = Math.round((Date.parse(evento.fim) - Date.parse(evento.inicio)) / 60_000)
  const duracao = duracaoDoFormulario(minutos)
  const gerente = usuario.role === 'gerente'
  const eu = responsaveis.find((r) => r.id === usuario.id) ?? {
    id: usuario.id,
    nome: usuario.nome,
    role: usuario.role,
    cor: null,
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Editar evento</h1>

      {typeof erro === 'string' && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      <EventoForm
        modo="editar"
        action={atualizarEventoAction.bind(null, evento.id)}
        valoresIniciais={{
          cliente_id: evento.clienteId,
          negociacao_id: evento.negociacaoId ?? '',
          usuario_id: evento.usuarioId,
          tipo: evento.tipo,
          tipo_original: evento.tipo,
          titulo: evento.titulo,
          descricao: evento.descricao ?? '',
          data: dia,
          hora_inicio: formatarHora(evento.inicio),
          duracao,
          hora_fim: duracao === 'personalizado' ? formatarHora(evento.fim) : '',
          escopo: 'este',
        }}
        clientes={clientes}
        responsaveis={responsaveis}
        eu={{ ...eu, gerente }}
        statusAtual={evento.status}
        serie={serie ? { descricao: descreverRecorrencia(serie), total: serie.total } : null}
        rotuloEnviar="Salvar alterações"
        cancelarHref={`/agenda?dia=${dia}`}
      />

      {statusEmAberto(evento.status) && <AcoesEvento evento={evento} dia={dia} emSerie={Boolean(serie)} />}
    </div>
  )
}

/**
 * Cancelar (sempre disponível para compromisso em aberto; em série, com
 * escopo) e excluir (só evento único em aberto — série se cancela).
 */
function AcoesEvento({ evento, dia, emSerie }: { evento: Evento; dia: string; emSerie: boolean }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-base font-semibold">Outras ações</h2>

      <form action={cancelarEventoAction.bind(null, evento.id, evento.clienteId, dia)} className="space-y-3">
        {emSerie && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Cancelar</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {ESCOPOS.map((e) => (
                <label key={e} className="flex items-center gap-2">
                  <input type="radio" name="escopo" value={e} defaultChecked={e === 'este'} />
                  {ROTULO_ESCOPO[e]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <BotaoConfirmar
          pergunta={emSerie ? 'Cancelar os compromissos escolhidos?' : 'Cancelar este compromisso?'}
          className={botaoSecundarioClass}
        >
          Cancelar compromisso
        </BotaoConfirmar>
        <p className="text-xs text-zinc-500">Cancelado continua no histórico da agenda.</p>
      </form>

      {!emSerie && (
        <form
          action={excluirEventoAction.bind(null, evento.id, evento.clienteId, dia)}
          className="space-y-1 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <BotaoConfirmar
            pergunta="Excluir este compromisso? Isso não pode ser desfeito."
            className={`${botaoSecundarioClass} text-red-700 dark:text-red-400`}
          >
            Excluir
          </BotaoConfirmar>
          <p className="text-xs text-zinc-500">
            Só para compromisso criado por engano. Realizados e cancelados ficam no histórico.
          </p>
        </form>
      )}
    </section>
  )
}
