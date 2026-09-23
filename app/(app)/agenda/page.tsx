import type { Metadata } from 'next'
import Link from 'next/link'

import { EventoItem, ListaEventos } from '@/components/agenda/evento-item'
import { botaoPrimarioClass, inputClass } from '@/components/ui/estilos'
import { getUsuarioAtual } from '@/lib/dal/auth'
import { listarResponsaveis } from '@/lib/dal/clientes'
import {
  DIAS_AGUARDANDO_STATUS,
  listarAguardandoStatus,
  listarEventosDoDia,
  listarProximosEventos,
} from '@/lib/dal/eventos'
import {
  diaValido,
  formatarDiaExtenso,
  hojeSaoPaulo,
  somarDias,
} from '@/lib/utils/formatacao'

export const metadata: Metadata = {
  title: 'Agenda',
}

const navClass =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'

export default async function AgendaPage({ searchParams }: PageProps<'/agenda'>) {
  const usuario = await getUsuarioAtual()
  const params = await searchParams
  const gerente = usuario.role === 'gerente'

  const hoje = hojeSaoPaulo()
  const dia = diaValido(params.dia) ? params.dia : hoje
  // Filtro por pessoa: só o gerente vê a agenda de outros.
  const usuarioId =
    gerente && typeof params.usuario === 'string' && params.usuario ? params.usuario : undefined

  const [doDia, aguardando, proximos, responsaveis] = await Promise.all([
    listarEventosDoDia(dia, usuarioId),
    listarAguardandoStatus(usuarioId),
    listarProximosEventos(usuarioId),
    listarResponsaveis(),
  ])

  const hrefDia = (d: string) => {
    const qs = new URLSearchParams()
    if (d !== hoje) qs.set('dia', d)
    if (usuarioId) qs.set('usuario', usuarioId)
    const s = qs.toString()
    return s ? `/agenda?${s}` : '/agenda'
  }

  // Aguardando status do próprio dia já aparece na lista do dia.
  const aguardandoForaDoDia = aguardando.filter((e) => !doDia.some((d) => d.id === e.id))

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {gerente ? 'Compromissos da equipe.' : 'Seus compromissos.'}
          </p>
        </div>
        <Link href={`/agenda/novo?dia=${dia}`} className={botaoPrimarioClass}>
          Novo evento
        </Link>
      </div>

      {gerente && (
        <form action="/agenda" className="flex max-w-md items-end gap-2">
          {dia !== hoje && <input type="hidden" name="dia" value={dia} />}
          <div className="flex-1">
            <label htmlFor="filtro-usuario" className="mb-1.5 block text-sm font-medium">
              Responsável
            </label>
            <select
              id="filtro-usuario"
              name="usuario"
              defaultValue={usuarioId ?? ''}
              className={inputClass}
            >
              <option value="">Toda a equipe</option>
              {responsaveis.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={navClass}>
            Filtrar
          </button>
        </form>
      )}

      {aguardandoForaDoDia.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Aguardando status</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Já passaram e ainda estão como agendados (últimos {DIAS_AGUARDANDO_STATUS} dias).
              Marque se aconteceram — o resultado vai para a timeline do cliente.
            </p>
          </div>
          <ListaEventos>
            {aguardandoForaDoDia.map((e) => (
              <EventoItem key={e.id} evento={e} mostrarData mostrarResponsavel={gerente} />
            ))}
          </ListaEventos>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold first-letter:uppercase">
            {dia === hoje ? 'Hoje' : formatarDiaExtenso(dia)}
            {dia === hoje && (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                {formatarDiaExtenso(dia)}
              </span>
            )}
          </h2>
          <nav aria-label="Navegar entre dias" className="flex items-center gap-2">
            <Link href={hrefDia(somarDias(dia, -1))} className={navClass} aria-label="Dia anterior">
              ←
            </Link>
            {dia !== hoje && (
              <Link href={hrefDia(hoje)} className={navClass}>
                Hoje
              </Link>
            )}
            <Link href={hrefDia(somarDias(dia, 1))} className={navClass} aria-label="Próximo dia">
              →
            </Link>
          </nav>
        </div>

        {doDia.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nenhum compromisso neste dia.
          </p>
        ) : (
          <ListaEventos>
            {doDia.map((e) => (
              <EventoItem key={e.id} evento={e} mostrarResponsavel={gerente} />
            ))}
          </ListaEventos>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Próximos eventos</h2>
        {proximos.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum evento agendado a partir de amanhã.</p>
        ) : (
          <ListaEventos>
            {proximos.map((e) => (
              <EventoItem key={e.id} evento={e} mostrarData mostrarResponsavel={gerente} />
            ))}
          </ListaEventos>
        )}
      </section>
    </div>
  )
}
