import { EventoItem, ListaEventos } from '@/components/agenda/evento-item'
import type { Evento } from '@/lib/dal/eventos'
import { agruparPorDia } from '@/lib/utils/calendario'
import { formatarDiaExtenso } from '@/lib/utils/formatacao'

/** Agenda contínua agrupada por dia — generaliza a antiga seção "Próximos eventos". */
export function VisaoLista({ eventos, hoje, gerente }: { eventos: Evento[]; hoje: string; gerente: boolean }) {
  const porDia = agruparPorDia(eventos)
  const dias = [...porDia.keys()].sort()

  if (dias.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-premium-borda px-4 py-8 text-center text-sm text-premium-mudo">
        Nenhum compromisso neste período.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {dias.map((d) => (
        <section key={d} className="space-y-2">
          <h3 className="text-sm font-semibold text-premium-secundario first-letter:uppercase">
            {d === hoje ? 'Hoje' : formatarDiaExtenso(d)}
          </h3>
          <ListaEventos>
            {porDia.get(d)!.map((e) => (
              <EventoItem key={e.id} evento={e} mostrarResponsavel={gerente} />
            ))}
          </ListaEventos>
        </section>
      ))}
    </div>
  )
}
