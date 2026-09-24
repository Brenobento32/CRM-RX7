'use client'

import { useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass } from '@/components/ui/estilos'
import { DURACOES, ROTULO_DURACAO, type Duracao } from '@/lib/validations/evento'

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

function somarMinutos(hora: string, minutos: number): string | null {
  if (!HORA.test(hora)) return null
  const [h, m] = hora.split(':').map(Number)
  const total = h * 60 + m + minutos
  if (total > 24 * 60) return null
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const chipClass =
  'cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900'

/**
 * Duração em botões (15 min, 30 min, 1 hora) ou término livre
 * ("Personalizado"). O término de fato é calculado no servidor; aqui só o
 * resumo "10:00 – 11:00".
 */
export function CampoDuracao({
  horaInicio,
  duracaoInicial,
  horaFimInicial,
  erroDuracao,
  erroHoraFim,
}: {
  horaInicio: string
  duracaoInicial: Duracao
  horaFimInicial: string
  erroDuracao?: string
  erroHoraFim?: string
}) {
  const [duracao, setDuracao] = useState<Duracao>(duracaoInicial)
  const [horaFim, setHoraFim] = useState(horaFimInicial)

  const fim = duracao === 'personalizado' ? (HORA.test(horaFim) ? horaFim : null) : somarMinutos(horaInicio, Number(duracao))
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
                onChange={() => setDuracao(d)}
                className="sr-only"
              />
              {ROTULO_DURACAO[d]}
            </label>
          ))}
          {resumo && <span className="text-sm text-zinc-500">{resumo}</span>}
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
            value={horaFim}
            onChange={(e) => setHoraFim(e.target.value)}
            aria-invalid={erroHoraFim ? true : undefined}
            className={inputClass}
          />
          <ErroCampo mensagem={erroHoraFim} />
        </div>
      )}
    </div>
  )
}
