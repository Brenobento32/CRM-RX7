import Link from 'next/link'

import { EstadoVazio } from '@/components/ui/estado-vazio'
import { Selo, type TomSelo } from '@/components/ui/selo'
import type { Evento } from '@/lib/dal/eventos'
import { diaEmSaoPaulo, formatarDia, formatarHora } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_EVENTO, ROTULO_TIPO_EVENTO, type StatusEvento } from '@/lib/validations/evento'

const TOM_STATUS: Record<StatusEvento, TomSelo> = {
  agendado: 'azul',
  confirmado: 'verde',
  realizado: 'neutro',
  nao_compareceu: 'ambar',
  cancelado: 'vermelho',
}

/**
 * Lista compacta de compromissos do Início (hoje / próximos). Cada linha abre
 * o compromisso na agenda; a hora fica numa coluna fixa para leitura rápida.
 */
export function ListaCompromissos({
  eventos,
  mostrarDia = false,
  vazio,
}: {
  eventos: Evento[]
  mostrarDia?: boolean
  vazio: { titulo: string; descricao?: string; acao?: { href: string; rotulo: string } }
}) {
  if (eventos.length === 0) return <EstadoVazio compacto {...vazio} />

  return (
    <ul className="-mx-2 divide-y divide-premium-borda-suave">
      {eventos.map((e) => {
        const dia = diaEmSaoPaulo(e.inicio)
        return (
          <li key={e.id}>
            <Link
              href={`/agenda?dia=${dia}&evento=${e.id}`}
              className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-premium-bg"
            >
              <span className="w-14 shrink-0 pt-0.5 text-right tabular-nums">
                {mostrarDia && <span className="block text-[11px] text-premium-mudo">{formatarDia(dia, false)}</span>}
                <span className="block text-sm font-medium text-premium-texto">{formatarHora(e.inicio)}</span>
              </span>
              <span aria-hidden className="mt-1 h-8 w-0.5 shrink-0 rounded-full bg-premium-acento/60" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-medium text-premium-texto ${e.status === 'cancelado' ? 'line-through opacity-60' : ''}`}>
                  {e.titulo}
                </span>
                <span className="block truncate text-xs text-premium-mudo">
                  {ROTULO_TIPO_EVENTO[e.tipo]} · até {formatarHora(e.fim)}
                  {e.clienteNome ? ` · ${e.clienteNome}` : ''}
                </span>
              </span>
              <Selo tom={TOM_STATUS[e.status]}>{ROTULO_STATUS_EVENTO[e.status]}</Selo>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
