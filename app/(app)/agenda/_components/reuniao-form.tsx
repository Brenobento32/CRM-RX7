'use client'

import { useActionState, useState } from 'react'

import { ErroCampo } from '@/components/ui/erro-campo'
import { botaoPrimarioClass, inputClass, caixaErroClass, caixaAlertaClass } from '@/components/ui/estilos'
import type { EstadoFormEvento } from '@/lib/actions/eventos'
import type { ResponsavelAgenda } from '@/lib/dal/eventos'
import { conflitosDeHorario, horaFimDoFormulario, type Ocupado } from '@/lib/utils/agenda'
import { formatarData, formatarHora, instanteSaoPaulo } from '@/lib/utils/formatacao'
import {
  DURACOES,
  ESCOPOS,
  ROTULO_ESCOPO,
  type CampoEvento,
  type Duracao,
  type Escopo,
  type ValoresEvento,
} from '@/lib/validations/evento'

import { CampoDuracao } from './campo-duracao'
import { CampoRecorrencia } from './campo-recorrencia'
import { CampoResponsavel } from './campo-responsavel'

type Props = {
  modo: 'criar' | 'editar'
  action: (estado: EstadoFormEvento | undefined, formData: FormData) => Promise<EstadoFormEvento>
  valoresIniciais: ValoresEvento
  responsaveis: ResponsavelAgenda[]
  eu: ResponsavelAgenda & { gerente: boolean }
  /** Reunião aberta pela ficha de um cliente (ou reunião antiga com cliente): vínculo mantido, só leitura. */
  vinculo?: { clienteNome: string; ownerId: string | undefined } | null
  /** Edição de reunião de série: a regra, em texto, e quantas ocorrências tem. */
  serie?: { descricao: string; total: number } | null
  /** Reuniões já carregadas na agenda (período na tela), para o aviso de conflito. */
  ocupados?: Ocupado[]
  /** Em edição: a própria reunião não conta como conflito. */
  eventoId?: string
  onCancelar: () => void
}

/**
 * Formulário da reunião (agenda nativa), usado dentro do modal tanto para
 * criar quanto para editar. Campos: nome, data, início, duração, responsável
 * e repetição. Cliente e negociação NÃO são escolhidos aqui; quando a reunião
 * já tem um (aberta pela ficha do cliente, ou reunião antiga), o vínculo segue
 * em campos ocultos para não se perder na edição.
 */
export function ReuniaoForm({ modo, action, valoresIniciais, responsaveis, eu, vinculo = null, serie = null, ocupados = [], eventoId, onCancelar }: Props) {
  const [estado, formAction, pendente] = useActionState(action, undefined)
  const valores = estado?.valores ?? valoresIniciais
  const erro = (campo: CampoEvento) => estado?.campos?.[campo]?.[0]
  const invalido = (campo: CampoEvento) => (erro(campo) ? true : undefined)

  const [usuarioId, setUsuarioId] = useState(valores.usuario_id || eu.id)
  const [data, setData] = useState(valores.data ?? '')
  const [horaInicio, setHoraInicio] = useState(valores.hora_inicio ?? '')
  const [escopo, setEscopo] = useState<Escopo>((valores.escopo as Escopo) || 'este')

  const [duracao, setDuracao] = useState<Duracao>(
    (DURACOES as readonly string[]).includes(valores.duracao ?? '') ? (valores.duracao as Duracao) : '60',
  )
  const [horaFim, setHoraFim] = useState(valores.hora_fim ?? '')

  // Aviso (não bloqueia): o responsável já tem reunião nesse horário.
  const fim = horaFimDoFormulario(horaInicio, duracao, horaFim)
  const conflitos =
    data && horaInicio && fim && fim > horaInicio
      ? conflitosDeHorario(ocupados, {
          usuarioId,
          inicio: instanteSaoPaulo(data, horaInicio),
          fim: instanteSaoPaulo(data, fim),
          excetoId: eventoId,
        })
      : []
  const nomeResponsavel = usuarioId === eu.id ? 'Você' : (responsaveis.find((r) => r.id === usuarioId)?.nome ?? 'O responsável')
  const dataTravada = modo === 'editar' && serie !== null && escopo !== 'este'

  return (
    <form action={formAction} noValidate className="space-y-5">
      {estado?.erro && (
        <div
          role="alert"
          className={caixaErroClass}
        >
          {estado.erro}
        </div>
      )}

      {/* Mantidos sem campo visível: tipo, vínculo e descrição já existentes. */}
      <input type="hidden" name="tipo" value={valores.tipo || 'reuniao'} />
      <input type="hidden" name="tipo_original" value={valores.tipo_original ?? ''} />
      <input type="hidden" name="cliente_id" value={valores.cliente_id ?? ''} />
      <input type="hidden" name="negociacao_id" value={valores.negociacao_id ?? ''} />
      <input type="hidden" name="descricao" value={valores.descricao ?? ''} />
      {modo === 'criar' && <input type="hidden" name="status" value={valores.status || 'agendado'} />}

      <div>
        <label htmlFor="titulo" className="mb-1.5 block text-sm font-medium">
          Nome da reunião <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
        </label>
        <input
          id="titulo"
          name="titulo"
          required
          maxLength={200}
          autoFocus
          defaultValue={valores.titulo ?? ''}
          aria-invalid={invalido('titulo')}
          className={inputClass}
          placeholder="Ex.: Apresentação da proposta"
        />
        <ErroCampo mensagem={erro('titulo')} />
      </div>

      {vinculo && (
        <p className="rounded-md border border-premium-borda bg-premium-bg px-3 py-2 text-xs text-premium-mudo">
          Ligada ao cliente <strong>{vinculo.clienteNome}</strong>. O resultado da reunião aparece na ficha dele.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="data" className="mb-1.5 block text-sm font-medium">
            Data
          </label>
          <input
            id="data"
            name="data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            readOnly={dataTravada}
            aria-invalid={invalido('data')}
            className={inputClass}
          />
          {dataTravada && <p className="mt-1 text-xs text-premium-mudo">Cada ocorrência mantém a própria data.</p>}
          <ErroCampo mensagem={erro('data')} />
        </div>
        <div>
          <label htmlFor="hora_inicio" className="mb-1.5 block text-sm font-medium">
            Horário de início
          </label>
          <input
            id="hora_inicio"
            name="hora_inicio"
            type="time"
            step={900}
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
            aria-invalid={invalido('hora_inicio')}
            className={inputClass}
          />
          <ErroCampo mensagem={erro('hora_inicio')} />
        </div>
      </div>

      <CampoDuracao
        horaInicio={horaInicio}
        duracao={duracao}
        onDuracao={setDuracao}
        horaFim={horaFim}
        onHoraFim={setHoraFim}
        erroDuracao={erro('duracao')}
        erroHoraFim={erro('hora_fim')}
      />

      <CampoResponsavel
        souGerente={eu.gerente}
        eu={eu}
        responsaveis={responsaveis}
        ownerId={vinculo?.ownerId}
        valor={usuarioId}
        onChange={setUsuarioId}
        erro={erro('usuario_id')}
      />

      {conflitos.length > 0 && (
        <div
          role="status"
          className={caixaAlertaClass}
        >
          <p className="font-medium">
            {nomeResponsavel} já tem {conflitos.length === 1 ? 'uma reunião' : `${conflitos.length} reuniões`} nesse horário:
          </p>
          <ul className="mt-1 space-y-0.5">
            {conflitos.slice(0, 3).map((c) => (
              <li key={c.id}>
                {formatarHora(c.inicio)}–{formatarHora(c.fim)} · {c.titulo}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Dá para salvar mesmo assim: as reuniões aparecem lado a lado na agenda.</p>
        </div>
      )}

      {modo === 'criar' ? (
        <CampoRecorrencia data={data} valores={valores} erro={erro} />
      ) : (
        serie && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Repetição</legend>
            <p className="text-sm text-premium-mudo">
              {serie.descricao} · {serie.total} ocorrência{serie.total === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {ESCOPOS.map((e) => (
                <label key={e} className="flex items-center gap-2">
                  <input type="radio" name="escopo" value={e} checked={escopo === e} onChange={() => setEscopo(e)} />
                  {ROTULO_ESCOPO[e]}
                </label>
              ))}
            </div>
            <ErroCampo mensagem={erro('escopo')} />
          </fieldset>
        )
      )}

      {data && (
        <p className="text-xs text-premium-mudo" aria-live="polite">
          {formatarData(data)}
          {horaInicio ? ` às ${horaInicio}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-premium-borda pt-4">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md px-4 py-2 text-sm text-premium-mudo transition hover:bg-premium-elevado hover:text-premium-texto"
        >
          Cancelar
        </button>
        <button type="submit" disabled={pendente} className={botaoPrimarioClass}>
          {pendente ? 'Salvando…' : modo === 'criar' ? 'Agendar reunião' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  )
}
