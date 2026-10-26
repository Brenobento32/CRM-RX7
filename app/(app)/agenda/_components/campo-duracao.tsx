'use client'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass, opcaoClass } from '@/components/ui/estilos'
import { horaFimDoFormulario } from '@/lib/utils/agenda'
import { DURACOES, ROTULO_DURACAO, type Duracao } from '@/lib/validations/evento'

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const chipClass =
  opcaoClass

/**
 * Duração em botões (15 min … 2h) ou término livre ("Personalizada"). Os
 * valores ficam no formulário da reunião (que também usa o término para o
 * aviso de conflito); o término de fato é recalculado no servidor.
 */
export function CampoDuracao({
  horaInicio,
  duracao,
  onDuracao,
  horaFim,
  onHoraFim,
  erroDuracao,
  erroHoraFim,
}: {
  horaInicio: string
  duracao: Duracao
  onDuracao: (d: Duracao) => void
  horaFim: string
  onHoraFim: (h: string) => void
  erroDuracao?: string
  erroHoraFim?: string
}) {
  const fim = horaFimDoFormulario(horaInicio, duracao, horaFim)
  const resumo =
    HORA.test(horaInicio) && fim && fim > horaInicio
      ? `${horaInicio} – ${fim}`
      : duracao !== 'personalizado' && HORA.test(horaInicio)
        ? 'Passaria da meia-noite'
        : null

  return (
    <div className="space-y-2">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Duração</legend>
        <div className="flex flex-wrap items-center gap-2">
          {DURACOES.map((d) => (
            <label key={d} className={chipClass}>
              <input
                type="radio"
                name="duracao"
                value={d}
                checked={duracao === d}
                onChange={() => onDuracao(d)}
                className="sr-only"
              />
              {ROTULO_DURACAO[d]}
            </label>
          ))}
          {resumo && <span className="text-sm text-premium-mudo">{resumo}</span>}
        </div>
        <ErroCampo mensagem={erroDuracao} />
      </fieldset>

      {duracao === 'personalizado' && (
        <div className="max-w-40">
          <label htmlFor="hora_fim" className="mb-1.5 block text-sm font-medium">
            Término
          </label>
          <input
            id="hora_fim"
            name="hora_fim"
            type="time"
            step={900}
            value={horaFim}
            onChange={(e) => onHoraFim(e.target.value)}
            aria-invalid={erroHoraFim ? true : undefined}
            className={inputClass}
          />
          <ErroCampo mensagem={erroHoraFim} />
        </div>
      )}
    </div>
  )
}
