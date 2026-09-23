import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { atualizarEventoAction } from '@/lib/actions/eventos'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { listarOpcoesClientes, obterEvento } from '@/lib/dal/eventos'
import { diaEmSaoPaulo, formatarHora } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_EVENTO } from '@/lib/validations/evento'

import { EventoForm } from '../../_components/evento-form'

export const metadata: Metadata = {
  title: 'Editar evento',
}

export default async function EditarEventoPage({ params }: PageProps<'/agenda/[id]/editar'>) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const [evento, clientes, responsaveis] = await Promise.all([
    obterEvento(id),
    listarOpcoesClientes(),
    listarResponsaveis(),
  ])
  if (!evento) notFound()

  const dia = diaEmSaoPaulo(evento.inicio)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Editar evento</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Status atual: {ROTULO_STATUS_EVENTO[evento.status]}. O status muda pelos botões da
          agenda, que também registram o resultado na timeline do cliente.
        </p>
      </div>

      <EventoForm
        action={atualizarEventoAction.bind(null, evento.id)}
        valoresIniciais={{
          cliente_id: evento.clienteId,
          negociacao_id: evento.negociacaoId ?? '',
          usuario_id: evento.usuarioId,
          tipo: evento.tipo,
          titulo: evento.titulo,
          descricao: evento.descricao ?? '',
          data: dia,
          hora_inicio: formatarHora(evento.inicio),
          hora_fim: formatarHora(evento.fim),
        }}
        clientes={clientes}
        responsaveis={responsaveis}
        rotuloEnviar="Salvar alterações"
        cancelarHref={`/agenda?dia=${dia}`}
      />
    </div>
  )
}
