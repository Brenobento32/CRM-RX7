import type { Metadata } from 'next'

import { criarEventoAction } from '@/lib/actions/eventos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import { listarOpcoesClientes } from '@/lib/dal/eventos'
import { diaValido, hojeSaoPaulo } from '@/lib/utils/formatacao'

import { EventoForm } from '../_components/evento-form'

export const metadata: Metadata = {
  title: 'Novo evento',
}

export default async function NovoEventoPage({ searchParams }: PageProps<'/agenda/novo'>) {
  const usuario = await getUsuarioAtual()
  const params = await searchParams

  const [clientes, responsaveis] = await Promise.all([
    listarOpcoesClientes(),
    listarResponsaveis(),
  ])

  // Vindo da ficha do cliente (?cliente=) ou de um dia da agenda (?dia=).
  const clienteId =
    typeof params.cliente === 'string' && clientes.some((c) => c.id === params.cliente)
      ? params.cliente
      : ''
  const dia = diaValido(params.dia) && params.dia >= hojeSaoPaulo() ? params.dia : hojeSaoPaulo()

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Novo evento</h1>

      <EventoForm
        action={criarEventoAction}
        valoresIniciais={{
          cliente_id: clienteId,
          usuario_id: usuario.id,
          tipo: 'reuniao',
          data: dia,
          hora_inicio: '09:00',
          hora_fim: '10:00',
        }}
        clientes={clientes}
        responsaveis={responsaveis}
        rotuloEnviar="Agendar"
        cancelarHref={clienteId ? `/clientes/${clienteId}` : `/agenda?dia=${dia}`}
      />
    </div>
  )
}
