import Link from 'next/link'

import type { Evento } from '@/lib/dal/eventos'
import { classeTextoAgenda, corDeFundoAgenda } from '@/lib/utils/etapas'
import { formatarHora } from '@/lib/utils/formatacao'
import { ROTULO_STATUS_EVENTO } from '@/lib/validations/evento'

/** Cor de fundo do bloco do evento: a cor do responsável, ou o neutro padrão. */
export function corDoResponsavel(evento: Evento): string {
  return corDeFundoAgenda(evento.usuarioCor)
}

/** Classe de texto com mais contraste contra `corDoResponsavel(evento)`. */
export function classeTextoSobreCor(evento: Evento): string {
  return classeTextoAgenda(evento.usuarioCor)
}

/**
 * `cor_agenda` nula (responsável sem cor configurada) e a cor "Cinza" da
 * paleta rendem o mesmo tom — sem isso, um evento sem cor definida e um
 * deliberadamente cinza ficariam visualmente idênticos.
 */
export function semCorDefinida(evento: Evento): boolean {
  return evento.usuarioCor === null
}

/** Nome acessível do bloco do evento — a cor nunca é o único sinal. */
export function rotuloAcessivel(evento: Evento, mostrarResponsavel: boolean): string {
  const partes = [
    `${formatarHora(evento.inicio)} às ${formatarHora(evento.fim)}`,
    evento.titulo,
    ROTULO_STATUS_EVENTO[evento.status],
  ]
  if (mostrarResponsavel && evento.usuario) partes.push(evento.usuario)
  if (evento.clienteNome) partes.push(evento.clienteNome)
  return partes.join(', ')
}

/** Pílula de uma linha, para as células da visão Mês (sem arraste). */
export function EventoChipMes({
  evento,
  mostrarResponsavel,
  href,
}: {
  evento: Evento
  mostrarResponsavel: boolean
  href: string
}) {
  const cancelado = evento.status === 'cancelado'

  return (
    <Link
      href={href}
      style={{ backgroundColor: corDoResponsavel(evento) }}
      className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-xs ${classeTextoSobreCor(evento)} transition hover:brightness-95 ${cancelado ? 'opacity-60' : ''} ${semCorDefinida(evento) ? 'border border-dashed border-white/60' : ''}`}
    >
      <span className="sr-only">{rotuloAcessivel(evento, mostrarResponsavel)}</span>
      <span aria-hidden className={`truncate ${cancelado ? 'line-through' : ''}`}>
        {formatarHora(evento.inicio)} {evento.titulo}
      </span>
    </Link>
  )
}
