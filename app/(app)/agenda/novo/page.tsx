import type { Metadata } from 'next'

import { criarEventoAction } from '@/lib/actions/eventos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarOpcoesClientes, listarResponsaveisAgenda } from '@/lib/dal/eventos'
import { responsaveisElegiveis } from '@/lib/utils/agenda'
import { diaValido, hojeSaoPaulo } from '@/lib/utils/formatacao'

import { EventoForm } from '../_components/evento-form'

export const metadata: Metadata = {
  title: 'Novo evento',
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Pode chegar com ?cliente= (ficha do cliente), ?dia= e ?hora= (um horário
 * da agenda) e ?responsavel= (agenda filtrada por pessoa).
 */
export default async function NovoEventoPage({ searchParams }: PageProps<'/agenda/novo'>) {
  const usuario = await getUsuarioAtual()
  const params = await searchParams

  const [clientes, responsaveis] = await Promise.all([listarOpcoesClientes(), listarResponsaveisAgenda()])

  const cliente = typeof params.cliente === 'string' ? clientes.find((c) => c.id === params.cliente) : undefined
  const dia = diaValido(params.dia) && params.dia >= hojeSaoPaulo() ? params.dia : hojeSaoPaulo()
  const hora = typeof params.hora === 'string' && HORA.test(params.hora) ? params.hora : '09:00'

  // Responsável inicial: o pedido na URL (se puder), o dono do cliente ou eu.
  const gerente = usuario.role === 'gerente'
  const elegiveis = cliente ? responsaveisElegiveis(responsaveis, cliente.ownerId) : []
  const pedido = typeof params.responsavel === 'string' ? params.responsavel : ''
  const responsavel = !gerente
    ? usuario.id
    : (elegiveis.find((r) => r.id === pedido) ?? elegiveis.find((r) => r.id === cliente?.ownerId))?.id ?? usuario.id

  const eu = responsaveis.find((r) => r.id === usuario.id) ?? {
    id: usuario.id,
    nome: usuario.nome,
    role: usuario.role,
    cor: null,
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Novo evento</h1>

      <EventoForm
        modo="criar"
        action={criarEventoAction}
        valoresIniciais={{
          cliente_id: cliente?.id ?? '',
          usuario_id: responsavel,
          tipo: 'reuniao',
          status: 'agendado',
          data: dia,
          hora_inicio: hora,
          duracao: '60',
          recorrencia: 'nenhuma',
        }}
        clientes={clientes}
        responsaveis={responsaveis}
        eu={{ ...eu, gerente }}
        rotuloEnviar="Agendar"
        cancelarHref={cliente ? `/clientes/${cliente.id}` : `/agenda?dia=${dia}`}
      />
    </div>
  )
}
