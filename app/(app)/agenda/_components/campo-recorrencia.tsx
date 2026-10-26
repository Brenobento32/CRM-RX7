'use client'

import { useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { inputClass, cartaoClass } from '@/components/ui/estilos'
import { formatarDia } from '@/lib/utils/formatacao'
import {
  DIAS_SEMANA,
  descreverRecorrencia,
  diaDaSemanaIso,
  diaDoMes,
  expandirRecorrencia,
  limiteDoTermino,
  MAX_OCORRENCIAS,
  MESES_TERMINO_PADRAO,
  somarMeses,
  type Frequencia,
  type RegraRecorrencia,
} from '@/lib/utils/recorrencia'
import {
  RECORRENCIAS,
  ROTULO_RECORRENCIA,
  UNIDADES,
  type CampoEvento,
  type Recorrencia,
  type Unidade,
  type ValoresEvento,
} from '@/lib/validations/evento'

const DATA = /^\d{4}-\d{2}-\d{2}$/
/** `inputClass` sem o `w-full`, para campos compactos com largura própria. */
const semLargura = inputClass.replace('w-full ', '')
const FREQUENCIA: Record<Unidade, Frequencia> = { dias: 'diaria', semanas: 'semanal', meses: 'mensal' }
const ROTULO_UNIDADE: Record<Unidade, string> = { dias: 'dias', semanas: 'semanas', meses: 'meses' }

const diaClass =
  'flex size-9 cursor-pointer items-center justify-center rounded-full border border-premium-borda text-sm text-premium-texto transition hover:border-premium-mudo/60 has-checked:border-premium-acento has-checked:bg-premium-acento has-checked:font-medium has-checked:text-premium-acento-texto has-focus-visible:ring-3 has-focus-visible:ring-premium-acento/25'

/**
 * Repetição do evento (só na criação). Os atalhos usam o dia da data
 * escolhida; "Personalizada" libera intervalo, dias e dia do mês. Término
 * obrigatório — padrão: em 3 meses. A prévia usa a mesma regra do banco,
 * que é quem gera as ocorrências de verdade.
 *
 * Valores "automáticos" (término, dias da semana, dia do mês) seguem a data
 * até a pessoa mexer neles.
 */
export function CampoRecorrencia({
  data,
  valores,
  erro,
}: {
  data: string
  valores: ValoresEvento
  erro: (campo: CampoEvento) => string | undefined
}) {
  const [recorrencia, setRecorrencia] = useState<Recorrencia>(
    (RECORRENCIAS as readonly string[]).includes(valores.recorrencia ?? '') ? (valores.recorrencia as Recorrencia) : 'nenhuma',
  )
  const [intervalo, setIntervalo] = useState(valores.intervalo || '1')
  const [unidade, setUnidade] = useState<Unidade>(
    (UNIDADES as readonly string[]).includes(valores.unidade ?? '') ? (valores.unidade as Unidade) : 'semanas',
  )
  const [diasSemana, setDiasSemana] = useState<number[] | null>(
    valores.dias_semana?.length ? valores.dias_semana.map(Number) : null,
  )
  const [diaMes, setDiaMes] = useState<string | null>(valores.dia_mes || null)
  const [termino, setTermino] = useState<'data' | 'ocorrencias'>(valores.termino === 'ocorrencias' ? 'ocorrencias' : 'data')
  const [terminaEm, setTerminaEm] = useState<string | null>(valores.termina_em || null)
  const [ocorrencias, setOcorrencias] = useState(valores.ocorrencias || '10')

  const dataValida = DATA.test(data)
  const diasEfetivos = diasSemana ?? (dataValida ? [diaDaSemanaIso(data)] : [])
  const diaMesEfetivo = diaMes ?? (dataValida ? String(diaDoMes(data)) : '')
  const terminaEfetivo = terminaEm ?? (dataValida ? somarMeses(data, MESES_TERMINO_PADRAO) : '')

  if (recorrencia === 'nenhuma') {
    return <SeletorRecorrencia valor={recorrencia} onChange={setRecorrencia} erro={erro('recorrencia')} />
  }

  const personalizada = recorrencia === 'personalizada'
  const regra: RegraRecorrencia | null = dataValida
    ? {
        dataInicio: data,
        frequencia: personalizada ? FREQUENCIA[unidade] : (recorrencia as Frequencia),
        intervalo: personalizada ? Number(intervalo) || 1 : 1,
        diasSemana: (personalizada ? unidade === 'semanas' : recorrencia === 'semanal') ? diasEfetivos : null,
        diaMes: (personalizada ? unidade === 'meses' : recorrencia === 'mensal') ? Number(diaMesEfetivo) || null : null,
        terminaEm: termino === 'data' ? terminaEfetivo || null : null,
        ocorrencias: termino === 'ocorrencias' ? Number(ocorrencias) || null : null,
      }
    : null
  const datas = regra && (regra.terminaEm || regra.ocorrencias) ? expandirRecorrencia(regra) : []

  function alternarDia(dia: number) {
    const atuais = new Set(diasEfetivos)
    if (atuais.has(dia)) atuais.delete(dia)
    else atuais.add(dia)
    setDiasSemana([...atuais].sort((a, b) => a - b))
  }

  return (
    <div className="space-y-4">
      <SeletorRecorrencia valor={recorrencia} onChange={setRecorrencia} erro={erro('recorrencia')} />

      {personalizada && (
        <div className={`${cartaoClass} space-y-3 p-5`}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">A cada</span>
              <input
                name="intervalo"
                type="number"
                min={1}
                max={99}
                value={intervalo}
                onChange={(e) => setIntervalo(e.target.value)}
                aria-invalid={erro('intervalo') ? true : undefined}
                className={`${semLargura} w-20`}
              />
            </label>
            <label className="text-sm">
              <span className="sr-only">Unidade</span>
              <select
                name="unidade"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value as Unidade)}
                className={inputClass}
              >
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>
                    {ROTULO_UNIDADE[u]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ErroCampo mensagem={erro('intervalo') ?? erro('unidade')} />

          {unidade === 'semanas' && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Nos dias</legend>
              <div className="flex gap-1.5">
                {DIAS_SEMANA.map((d) => (
                  <label key={d.valor} className={diaClass} title={d.nome}>
                    <input
                      type="checkbox"
                      name="dias_semana"
                      value={d.valor}
                      checked={diasEfetivos.includes(d.valor)}
                      onChange={() => alternarDia(d.valor)}
                      aria-label={d.nome}
                      className="sr-only"
                    />
                    <span aria-hidden>{d.curto}</span>
                  </label>
                ))}
              </div>
              <ErroCampo mensagem={erro('dias_semana')} />
            </fieldset>
          )}

          {unidade === 'meses' && (
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">No dia do mês</span>
              <input
                name="dia_mes"
                type="number"
                min={1}
                max={31}
                value={diaMesEfetivo}
                onChange={(e) => setDiaMes(e.target.value)}
                aria-invalid={erro('dia_mes') ? true : undefined}
                className={`${semLargura} w-24`}
              />
              <span className="mt-1 block text-xs text-premium-mudo">
                29, 30 ou 31 caem no último dia dos meses mais curtos.
              </span>
              <ErroCampo mensagem={erro('dia_mes')} />
            </label>
          )}
        </div>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Termina</legend>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="termino"
              value="data"
              checked={termino === 'data'}
              onChange={() => setTermino('data')}
            />
            em
            <input
              name="termina_em"
              type="date"
              value={terminaEfetivo}
              min={dataValida ? data : undefined}
              max={dataValida ? limiteDoTermino(data) : undefined}
              onChange={(e) => {
                setTerminaEm(e.target.value)
                setTermino('data')
              }}
              aria-label="Data do término"
              aria-invalid={erro('termina_em') ? true : undefined}
              className={`${semLargura} w-auto`}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="termino"
              value="ocorrencias"
              checked={termino === 'ocorrencias'}
              onChange={() => setTermino('ocorrencias')}
            />
            após
            <input
              name="ocorrencias"
              type="number"
              min={1}
              max={MAX_OCORRENCIAS}
              value={ocorrencias}
              onChange={(e) => {
                setOcorrencias(e.target.value)
                setTermino('ocorrencias')
              }}
              aria-label="Número de ocorrências"
              aria-invalid={erro('ocorrencias') ? true : undefined}
              className={`${semLargura} w-20`}
            />
            ocorrências
          </label>
        </div>
        <p className="mt-1 text-xs text-premium-mudo">No máximo 12 meses ou {MAX_OCORRENCIAS} ocorrências.</p>
        <ErroCampo mensagem={erro('termino') ?? erro('termina_em') ?? erro('ocorrencias')} />
      </fieldset>

      {regra && datas.length > 0 && (
        <p
          role="status"
          className="rounded-md border border-premium-borda bg-premium-bg px-3 py-2 text-sm"
        >
          <span aria-hidden>↻ </span>
          {descreverRecorrencia(regra)} · <span className="font-medium">{datas.length}</span>{' '}
          {datas.length === 1 ? 'compromisso' : 'compromissos'}
          <span className="text-premium-mudo">
            {' '}
            (de {formatarDia(datas[0])} a {formatarDia(datas.at(-1)!)})
          </span>
        </p>
      )}
      {regra && datas.length === 0 && (regra.terminaEm || regra.ocorrencias) && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          Com essas escolhas nenhum compromisso seria criado.
        </p>
      )}
    </div>
  )
}

function SeletorRecorrencia({
  valor,
  onChange,
  erro,
}: {
  valor: Recorrencia
  onChange: (r: Recorrencia) => void
  erro?: string
}) {
  return (
    <div className="max-w-xs">
      <label htmlFor="recorrencia" className="mb-1.5 block text-sm font-medium">
        Repetição
      </label>
      <select
        id="recorrencia"
        name="recorrencia"
        value={valor}
        onChange={(e) => onChange(e.target.value as Recorrencia)}
        className={inputClass}
      >
        {RECORRENCIAS.map((r) => (
          <option key={r} value={r}>
            {ROTULO_RECORRENCIA[r]}
          </option>
        ))}
      </select>
      <ErroCampo mensagem={erro} />
    </div>
  )
}
